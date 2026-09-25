import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { getDb } from "../lib/db.ts";
import { isLocalDevelopmentDatabase } from "../lib/tickets.ts";

test("ticket workspace isolation through HTTP", async (t) => {
  assert.ok(isLocalDevelopmentDatabase(), "Tests require local resolve_dev");
  const origin = process.env.BETTER_AUTH_URL;
  assert.equal(origin, "http://127.0.0.1:3000");
  const db = getDb();
  const userIds: number[] = [];
  const workspaceIds: number[] = [];
  const marker = crypto.randomUUID();
  const password = crypto.randomUUID();
  const before = JSON.stringify({
    workspaces: await db.workspace.findMany({ orderBy: { id: "asc" } }),
    memberships: await db.membership.findMany({ orderBy: { id: "asc" } }),
    tickets: await db.ticket.findMany({ orderBy: { id: "asc" } }),
    messages: await db.ticketMessage.findMany({ orderBy: { id: "asc" } }),
    changes: await db.ticketChange.findMany({ orderBy: { id: "asc" } }),
  });

  function request(path: string, cookie = "", method = "GET", body?: unknown, source: string | null = origin!) {
    const headers = new Headers({ Cookie: cookie });
    if (source !== null) headers.set("Origin", source);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    return fetch(`${origin}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual", signal: AbortSignal.timeout(20_000),
    });
  }

  async function fixtureUser(label: string) {
    const email = `${label}-${marker}@example.test`;
    const user = await db.user.create({ data: { email, name: label } });
    userIds.push(user.id);
    await db.account.create({ data: { userId: user.id, providerId: "credential", accountId: String(user.id), password: await hashPassword(password) } });
    let response = await request("/api/auth/sign-in/email", "", "POST", { email, password });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("x-retry-after"));
      assert.ok(seconds > 0 && seconds <= 60);
      await delay(seconds * 1000 + 100);
      response = await request("/api/auth/sign-in/email", "", "POST", { email, password });
    }
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().find((item) => item.startsWith("better-auth.session_token="));
    assert.ok(cookie, "Login must set a cookie");
    return { ...user, cookie: cookie.split(";")[0] };
  }

  async function workspace(name: string, cookie: string) {
    const response = await request("/api/workspaces", cookie, "POST", { name });
    assert.equal(response.status, 201);
    const { workspace } = await response.json();
    workspaceIds.push(workspace.id);
    return workspace.id as number;
  }

  try {
    const alice = await fixtureUser("owner-a");
    const cara = await fixtureUser("owner-b");
    const ben = await fixtureUser("shared-staff");

    await t.test("a user with no memberships has no ticket workspace", async () => {
      const response = await request("/", ben.cookie);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /No ticket workspaces are available/);
    });

    const nameA = `Company A ${marker}`;
    const nameB = `Company B ${marker}`;
    const a = await workspace(nameA, alice.cookie);
    const b = await workspace(nameB, cara.cookie);
    const pathA = `/api/workspaces/${a}/tickets`;
    const pathB = `/api/workspaces/${b}/tickets`;
    const input = { subject: "Private ticket", description: "Only this company's members may read this." };

    await t.test("newly created workspaces appear only in their members' homepages", async () => {
      const htmlA = await (await request("/", alice.cookie)).text();
      assert.match(htmlA, /aria-label="Main navigation"/);
      assert.match(htmlA, /<a[^>]*aria-current="page"[^>]*>Ticket inbox<\/a>/);
      assert.match(htmlA, /Loading tickets/);
      assert.match(htmlA, /Create a ticket/);
      assert.match(htmlA, /Skip to content/);
      assert.ok(htmlA.includes(nameA));
      assert.ok(!htmlA.includes(nameB));
      const htmlB = await (await request("/", cara.cookie)).text();
      assert.ok(htmlB.includes(nameB));
      assert.ok(!htmlB.includes(nameA));
      const response = await request(pathA, alice.cookie);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).tickets, []);
    });

    await t.test("anonymous and forged-session requests cannot list or create", async () => {
      for (const cookie of ["", "better-auth.session_token=forged"]) {
        for (const method of ["GET", "POST"]) {
          const response = await request(pathA, cookie, method, method === "POST" ? input : undefined);
          assert.equal(response.status, 401);
          assert.equal(response.headers.get("cache-control"), "no-store");
        }
      }
      assert.equal(await db.ticket.count({ where: { workspaceId: a } }), 0);
    });

    await t.test("owners create private tickets; body fields cannot override workspace, status, or identity", async () => {
      for (const [path, cookie, ownId, otherId] of [[pathA, alice.cookie, a, b], [pathB, cara.cookie, b, a]] as const) {
        const response = await request(path, cookie, "POST", { ...input, workspaceId: otherId, userId: ben.id, role: "OWNER", status: "RESOLVED" });
        assert.equal(response.status, 201);
        const { ticket } = await response.json();
        const saved = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
        assert.equal(saved.workspaceId, ownId);
        assert.equal(saved.status, "OPEN");
      }
    });

    await t.test("both companies reject direct reads and writes from the other owner", async () => {
      const beforeCount = await db.ticket.count();
      for (const [path, cookie] of [[pathA, cara.cookie], [pathB, alice.cookie], [pathA, ben.cookie]]) {
        for (const method of ["GET", "POST"]) {
          const response = await request(path, cookie, method, method === "POST" ? { ...input, userId: alice.id } : undefined);
          assert.equal(response.status, 403);
          assert.deepEqual(await response.json(), { error: { code: "FORBIDDEN", message: "You do not have access to this workspace." } });
        }
      }
      assert.equal(await db.ticket.count(), beforeCount);
      // Unknown and inaccessible workspace IDs return the same result.
      const response = await request("/api/workspaces/2147483647/tickets", ben.cookie);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, "FORBIDDEN");
    });

    await t.test("agent and admin memberships grant scoped access without mixing ticket lists", async () => {
      for (const [workspaceId, cookie, role] of [[a, alice.cookie, "AGENT"], [b, cara.cookie, "ADMIN"]] as const) {
        const response = await request(`/api/workspaces/${workspaceId}/invitations`, cookie, "POST", { email: ben.email, role });
        assert.equal(response.status, 201);
        const { invitation } = await response.json();
        const token = new URL(invitation.url).hash.slice(1);
        assert.equal((await request("/api/invitations/accept", ben.cookie, "POST", { token })).status, 200);
      }
      for (const [path, workspaceId] of [[pathA, a], [pathB, b]] as const) {
        assert.equal((await request(path, ben.cookie, "POST", input)).status, 201);
        const response = await request(path, ben.cookie);
        assert.equal(response.status, 200);
        const { tickets } = await response.json();
        const expected = await db.ticket.findMany({ where: { workspaceId }, select: { id: true } });
        assert.deepEqual(tickets.map((ticket: { id: number }) => ticket.id).sort(), expected.map((ticket) => ticket.id).sort());
        assert.equal(tickets.length, 2);
      }
    });

    await t.test("workspace URLs preserve navigation and reject inaccessible selections", async () => {
      for (const id of [a, b]) {
        for (const path of ["/", "/workspaces"]) {
          const response = await request(`${path}?workspace=${id}`, ben.cookie);
          assert.equal(response.status, 200);
          const html = await response.text();
          assert.ok(html.includes(`href="/?workspace=${id}"`));
          assert.ok(html.includes(`href="/workspaces?workspace=${id}"`));
          const selectedOption = (html.match(/<option\b[^>]*>/g) ?? []).find((tag) => tag.includes('selected=""'));
          assert.ok(selectedOption?.includes(`value="${id}"`), "The requested workspace must be selected");
          assert.ok(!html.includes("This workspace is unavailable"));
        }
      }
      for (const value of [String(b), "abc", "2147483647", `${a}&workspace=${b}`]) {
        for (const path of ["/", "/workspaces"]) {
          const html = await (await request(`${path}?workspace=${value}`, alice.cookie)).text();
          assert.ok(html.includes("This workspace is unavailable to you"));
          assert.ok(!html.includes(nameB));
          assert.ok(!html.includes("Loading tickets"));
          assert.ok(!html.includes(`href="/workspaces?workspace=${b}"`));
        }
      }
    });

    const ticketA = await db.ticket.findFirstOrThrow({ where: { workspaceId: a } });
    const ticketB = await db.ticket.findFirstOrThrow({ where: { workspaceId: b } });
    const detailA = `${pathA}/${ticketA.id}`;
    const detailB = `${pathB}/${ticketB.id}`;
    const messageInput = { kind: "PUBLIC_REPLY", body: "A reply for this customer" };

    await t.test("detail and messages reject anonymous, foreign and mismatched ticket requests", async () => {
      for (const [path, cookie, expected] of [
        [detailA, "", 401], [detailA, "better-auth.session_token=forged", 401],
        [detailA, cara.cookie, 403], [detailB, alice.cookie, 403],
        [`${pathA}/${ticketB.id}`, alice.cookie, 404],
        [`${pathA}/${ticketB.id}`, ben.cookie, 404],
        [`${pathA}/2147483647`, alice.cookie, 404],
      ] as const) {
        assert.equal((await request(path, cookie)).status, expected);
        assert.equal((await request(`${path}/messages`, cookie, "POST", messageInput)).status, expected);
      }
      const anonymous = await request(`/workspaces/${a}/tickets/${ticketA.id}`);
      // Loading boundaries may stream HTTP 200 before redirect/not-found is resolved.
      if (anonymous.status === 200) {
        const html = await anonymous.text();
        assert.match(html, /<meta[^>]*http-equiv="refresh"[^>]*url=\/sign-in/);
        assert.ok(!html.includes(ticketA.subject));
      } else assert.ok([303, 307].includes(anonymous.status));
      const wrongTicket = await request(`/workspaces/${a}/tickets/${ticketB.id}`, ben.cookie);
      assert.ok([200, 404].includes(wrongTicket.status));
      const deniedHtml = await wrongTicket.text();
      assert.ok(deniedHtml.includes("Ticket unavailable"));
      assert.ok(!deniedHtml.includes(ticketB.description));
    });

    await t.test("message input and origin validation prevent writes", async () => {
      const beforeCount = await db.ticketMessage.count();
      for (const body of [null, {}, { ...messageInput, kind: "UNKNOWN" }, { ...messageInput, body: "  " }, { ...messageInput, body: "x".repeat(10001) }]) {
        assert.equal((await request(`${detailA}/messages`, alice.cookie, "POST", body)).status, 400);
      }
      for (const source of [null, "https://untrusted.example"]) {
        assert.equal((await request(`${detailA}/messages`, alice.cookie, "POST", messageInput, source)).status, 403);
      }
      assert.equal((await request(`${pathA}/abc`, alice.cookie)).status, 400);
      assert.equal(await db.ticketMessage.count(), beforeCount);
    });

    await t.test("public replies and internal notes persist distinctly with session-derived authors", async () => {
      for (const [kind, cookie, authorId] of [["PUBLIC_REPLY", alice.cookie, alice.id], ["INTERNAL_NOTE", ben.cookie, ben.id]] as const) {
        const response = await request(`${detailA}/messages`, cookie, "POST", {
          kind, body: `  ${kind} <script>alert(1)</script>  `, authorId: cara.id, ticketId: ticketB.id, workspaceId: b,
        });
        assert.equal(response.status, 201);
        const { message } = await response.json();
        assert.equal(message.kind, kind);
        assert.equal(message.author.id, authorId);
        assert.equal(message.body, `${kind} <script>alert(1)</script>`);
        const saved = await db.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
        assert.equal(saved.ticketId, ticketA.id);
      }
      // Ben is an admin in B and an agent in A; both staff roles may contribute.
      assert.equal((await request(`${detailB}/messages`, ben.cookie, "POST", messageInput)).status, 201);
      const response = await request(detailA, ben.cookie);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const { ticket } = await response.json();
      assert.equal(ticket.messages.length, 2);
      assert.deepEqual(ticket.messages.map((m: { kind: string }) => m.kind), ["PUBLIC_REPLY", "INTERNAL_NOTE"]);
      const html = await (await request(`/workspaces/${a}/tickets/${ticketA.id}`, alice.cookie)).text();
      assert.ok(html.includes("Public reply"));
      assert.ok(html.includes("Internal note"));
      assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
      assert.ok(!html.includes("<script>alert(1)</script>"));
      assert.ok(html.includes(`href="/?workspace=${a}"`));
      const membersHtml = await (await request(`/workspaces?workspace=${a}`, alice.cookie)).text();
      assert.ok(!membersHtml.includes("View members"));
      assert.ok(membersHtml.includes('id="workspace"'));
    });

    await t.test("workflow denies anonymous, foreign workspace, invalid input and untrusted origins without changes", async () => {
      const snapshot = JSON.stringify(await db.ticket.findUniqueOrThrow({ where: { id: ticketA.id }, include: { changes: true } }));
      for (const [path, cookie, expected] of [
        [detailA, "", 401], [detailA, "better-auth.session_token=forged", 401],
        [detailA, cara.cookie, 403], [detailB, alice.cookie, 403], [`${pathA}/${ticketB.id}`, ben.cookie, 404],
      ] as const) assert.equal((await request(path, cookie, "PATCH", { version: 0, priority: "HIGH" })).status, expected);
      for (const body of [null, {}, { version: 0 }, { priority: "HIGH" }, { version: "0", priority: "HIGH" },
        { version: 0, status: "INVALID" }, { version: 0, priority: null }, { version: 0, assigneeId: "1" },
        { version: 0, assigneeId: 0 }, { version: -1, priority: "HIGH" },
        { version: 0, priority: "HIGH", actorId: cara.id }, { version: 0, workspaceId: b, priority: "HIGH" },
        { version: 0, status: "RESOLVED" }, { version: 0, assigneeId: cara.id, priority: "URGENT", status: "IN_PROGRESS" },
      ]) assert.equal((await request(detailA, alice.cookie, "PATCH", body)).status, 400);
      for (const source of [null, "https://untrusted.example"]) {
        assert.equal((await request(detailA, alice.cookie, "PATCH", { version: 0, priority: "HIGH" }, source)).status, 403);
      }
      assert.equal(JSON.stringify(await db.ticket.findUniqueOrThrow({ where: { id: ticketA.id }, include: { changes: true } })), snapshot);
    });

    await t.test("agent assignment, priority and status save atomically with server-derived history", async () => {
      assert.equal(ticketA.priority, "NORMAL");
      assert.equal(ticketA.assigneeId, null);
      assert.equal(ticketA.version, 0);
      const response = await request(detailA, ben.cookie, "PATCH", { version: 0, assigneeId: ben.id, priority: "HIGH", status: "IN_PROGRESS" });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { changed: true, version: 1 });
      const { ticket } = await (await request(detailA, alice.cookie)).json();
      assert.equal(ticket.assignee.id, ben.id);
      assert.equal(ticket.priority, "HIGH");
      assert.equal(ticket.status, "IN_PROGRESS");
      assert.equal(ticket.changes.length, 3);
      assert.ok(ticket.changes.every((change: { actor: { id: number }; version: number }) => change.actor.id === ben.id && change.version === 1));
      assert.deepEqual(ticket.changes.map((change: { field: string; before: string | null }) => [change.field, change.before]), [["STATUS", "OPEN"], ["PRIORITY", "NORMAL"], ["ASSIGNEE", null]]);
      const assigned = ticket.changes.find((change: { field: string }) => change.field === "ASSIGNEE");
      assert.equal(assigned.after, `${ben.name} (#${ben.id})`);
      const list = await (await request(pathA, alice.cookie)).json();
      assert.equal(list.tickets.find((item: { id: number }) => item.id === ticketA.id).priority, "HIGH");
      const html = await (await request(`/workspaces/${a}/tickets/${ticketA.id}`, alice.cookie)).text();
      assert.ok(html.includes("Change history"));
      assert.ok(html.includes("Save workflow"));
      assert.ok(html.includes(ben.name));
    });

    await t.test("no-op and stale edits do not create history; statuses require controlled transitions", async () => {
      const noop = await request(detailA, alice.cookie, "PATCH", { version: 1, status: "IN_PROGRESS", priority: "HIGH", assigneeId: ben.id });
      assert.deepEqual(await noop.json(), { changed: false, version: 1 });
      assert.equal((await request(detailA, alice.cookie, "PATCH", { version: 0, priority: "LOW" })).status, 409);
      assert.equal(await db.ticketChange.count({ where: { ticketId: ticketA.id } }), 3);
      assert.equal((await request(detailA, alice.cookie, "PATCH", { version: 1, status: "RESOLVED" })).status, 200);
      assert.equal((await request(detailA, alice.cookie, "PATCH", { version: 2, status: "IN_PROGRESS" })).status, 400);
      assert.equal((await request(detailA, alice.cookie, "PATCH", { version: 2, status: "OPEN", assigneeId: null })).status, 200);
      const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketA.id } });
      assert.equal(ticket.version, 3);
      assert.equal(ticket.assigneeId, null);
      assert.equal(ticket.status, "OPEN");
      assert.equal(await db.ticketChange.count({ where: { ticketId: ticketA.id } }), 6);
      // Admin in workspace B can manage its workflow too.
      assert.equal((await request(detailB, ben.cookie, "PATCH", { version: 0, assigneeId: cara.id, priority: "LOW" })).status, 200);
    });

    await t.test("concurrent workflow edits have one winner and one history record", async () => {
      const responses = await Promise.all([
        request(detailA, alice.cookie, "PATCH", { version: 3, priority: "LOW" }),
        request(detailA, ben.cookie, "PATCH", { version: 3, priority: "URGENT" }),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
      const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketA.id }, include: { changes: { where: { version: 4 } } } });
      assert.equal(ticket.version, 4);
      assert.equal(ticket.changes.length, 1);
      assert.equal(ticket.changes[0].after, ticket.priority);
      assert.equal(ticket.changes[0].actorId, responses[0].status === 200 ? alice.id : ben.id);
    });

    await t.test("invalid workspace IDs, invalid input and untrusted write origins fail without writes", async () => {
      const count = await db.ticket.count();
      for (const id of ["0", "abc", "1.5", "2147483648", "01"]) {
        assert.equal((await request(`/api/workspaces/${id}/tickets`, alice.cookie)).status, 400);
      }
      for (const body of [null, {}, { subject: " ", description: " " }, { ...input, subject: "x".repeat(201) }]) {
        assert.equal((await request(pathA, alice.cookie, "POST", body)).status, 400);
      }
      for (const source of [null, "https://untrusted.example"]) {
        assert.equal((await request(pathA, alice.cookie, "POST", input, source)).status, 403);
      }
      assert.equal(await db.ticket.count(), count);
    });

    await t.test("pagination is bounded, ordered, complete and scoped before counting", async () => {
      await db.ticket.createMany({ data: Array.from({ length: 45 }, (_, index) => ({
        workspaceId: a, subject: `${marker} item ${index}${index === 0 ? " 50%" : index === 1 ? " under_score" : index === 2 ? " path\\name" : ""}`,
        description: `description ${marker}`, createdAt: new Date("2020-01-01T00:00:00Z"),
        status: index % 3 === 0 ? "OPEN" as const : "RESOLVED" as const,
        priority: index % 2 === 0 ? "HIGH" as const : "LOW" as const,
        assigneeId: index % 2 === 0 ? ben.id : null,
      })) });
      await db.ticket.create({ data: { workspaceId: b, subject: `Foreign ${marker}`, description: marker } });
      const expected = await db.ticket.findMany({ where: { workspaceId: a, subject: { contains: marker } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
      const ids: number[] = [];
      for (const page of [1, 2, 3]) {
        const response = await request(`${pathA}?q=${marker}&page=${page}`, alice.cookie);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const data = await response.json();
        assert.deepEqual(data.pagination, { page, pageSize: 20, total: 45, totalPages: 3, capped: false });
        assert.equal(data.tickets.length, page === 3 ? 5 : 20);
        ids.push(...data.tickets.map((ticket: { id: number }) => ticket.id));
      }
      assert.deepEqual(ids, expected.map((ticket) => ticket.id));
      assert.equal(new Set(ids).size, 45);
      const last = await (await request(`${pathA}?q=${marker}&page=10000`, alice.cookie)).json();
      assert.equal(last.pagination.page, 3);
      const defaults = await (await request(pathA, alice.cookie)).json();
      assert.equal(defaults.tickets.length, 20);
      assert.equal((await request(`${pathA}?q=${marker}`, cara.cookie)).status, 403);
      assert.equal((await request(`${pathA}?q=${marker}`)).status, 401);
    });

    await t.test("combined filters and literal search return only matching tickets", async () => {
      const filters = new URLSearchParams({ q: marker, status: "OPEN", priority: "HIGH", assignee: String(ben.id) });
      const combined = await (await request(`${pathA}?${filters}`, alice.cookie)).json();
      assert.equal(combined.pagination.total, 8);
      assert.ok(combined.tickets.every((ticket: { status: string; priority: string; assignee: { id: number } }) => ticket.status === "OPEN" && ticket.priority === "HIGH" && ticket.assignee.id === ben.id));
      const unassigned = await (await request(`${pathA}?q=${marker}&assignee=unassigned`, alice.cookie)).json();
      assert.equal(unassigned.pagination.total, 22);
      assert.ok(unassigned.tickets.every((ticket: { assignee: unknown }) => ticket.assignee === null));
      const foreignAssignee = await (await request(`${pathA}?assignee=${cara.id}`, alice.cookie)).json();
      assert.equal(foreignAssignee.pagination.total, 0);
      for (const q of ["%", "_", "\\"]) {
        const data = await (await request(`${pathA}?${new URLSearchParams({ q })}`, alice.cookie)).json();
        assert.equal(data.pagination.total, 1, `Search must treat ${q} literally`);
      }
      const descriptionMatch = await (await request(`${pathA}?${new URLSearchParams({ q: `description ${marker}` })}`, alice.cookie)).json();
      assert.equal(descriptionMatch.pagination.total, 45);
      const caseMatch = await (await request(`${pathA}?q=${marker.toUpperCase()}`, alice.cookie)).json();
      assert.equal(caseMatch.pagination.total, 45);
      for (const q of ["alert(1)", "' OR 1=1 --", "does-not-match-any-ticket"]) {
        const data = await (await request(`${pathA}?${new URLSearchParams({ q })}`, alice.cookie)).json();
        assert.deepEqual(data.tickets, []);
        assert.equal(data.pagination.total, 0);
        assert.equal(data.pagination.totalPages, 1);
      }
      // An empty/whitespace search behaves like no search.
      const blank = await (await request(`${pathA}?q=%20%20`, alice.cookie)).json();
      const all = await (await request(pathA, alice.cookie)).json();
      assert.deepEqual(blank, all);
    });

    await t.test("invalid or repeated list parameters are rejected", async () => {
      for (const query of ["page=0", "page=-1", "page=1.5", "page=01", "page=10001", "page=NaN", "page=1&page=2",
        "status=INVALID", "priority=INVALID", "assignee=0", "assignee=abc", "status=OPEN&status=RESOLVED", "workspaceId=2", `q=${"x".repeat(101)}`]) {
        assert.equal((await request(`${pathA}?${query}`, alice.cookie)).status, 400, query);
      }
      const html = await (await request(`/?workspace=${a}`, alice.cookie)).text();
      assert.ok(html.includes("Apply filters"));
      assert.ok(html.includes("Search subject or description"));
      assert.ok(!html.includes(cara.name));
    });

    await t.test("removing a membership denies the same session while its other workspace remains accessible", async () => {
      // Fixture-only DB mutation: member removal UI is not part of this step.
      await db.membership.delete({ where: { workspaceId_userId: { workspaceId: a, userId: ben.id } } });
      assert.equal((await request(pathA, ben.cookie)).status, 403);
      assert.equal((await request(`${pathA}?q=${marker}&status=OPEN&page=2`, ben.cookie)).status, 403);
      assert.equal((await request(pathA, ben.cookie, "POST", input)).status, 403);
      assert.equal((await request(pathB, ben.cookie)).status, 200);
      assert.equal((await request(detailA, ben.cookie)).status, 403);
      assert.equal((await request(`${detailA}/messages`, ben.cookie, "POST", messageInput)).status, 403);
      assert.equal((await request(detailA, ben.cookie, "PATCH", { version: 4, priority: "NORMAL" })).status, 403);
      assert.equal((await request(detailA, alice.cookie, "PATCH", { version: 4, assigneeId: ben.id })).status, 400);
      assert.equal(await db.ticketChange.count({ where: { ticketId: ticketA.id } }), 7);
      const html = await (await request("/", ben.cookie)).text();
      assert.ok(!html.includes(nameA));
      assert.ok(html.includes(nameB));
      const stale = await (await request(`/?workspace=${a}`, ben.cookie)).text();
      assert.ok(stale.includes("This workspace is unavailable to you"));
      assert.ok(!stale.includes("Loading tickets"));
    });
  } finally {
    // All targets are IDs captured from this run; preserve user-created records.
    await db.ticket.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } }); // Account/session relations cascade.
    const after = JSON.stringify({
      workspaces: await db.workspace.findMany({ orderBy: { id: "asc" } }),
      memberships: await db.membership.findMany({ orderBy: { id: "asc" } }),
      tickets: await db.ticket.findMany({ orderBy: { id: "asc" } }),
      messages: await db.ticketMessage.findMany({ orderBy: { id: "asc" } }),
      changes: await db.ticketChange.findMany({ orderBy: { id: "asc" } }),
    });
    await db.$disconnect();
    assert.equal(after, before, "All pre-existing company records must be preserved");
  }
});
