import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { getDb } from "../lib/db.ts";
import { isLocalDevelopmentDatabase } from "../lib/tickets.ts";

test("customer invitation and protected ticket submission", async (t) => {
  assert.ok(isLocalDevelopmentDatabase());
  const origin = process.env.BETTER_AUTH_URL;
  assert.equal(origin, "http://127.0.0.1:3000");
  const db = getDb();
  const marker = randomUUID();
  const password = randomUUID();
  const emails: string[] = [];
  const workspaceIds: number[] = [];
  const initial = {
    users: await db.user.count(), workspaces: await db.workspace.count(),
    tickets: await db.ticket.count(), customers: await db.customerAccess.count(), invitations: await db.customerInvitation.count(),
  };
  function email(label: string) { const address = `${label}-${marker}@example.test`; emails.push(address); return address; }
  async function request(path: string, body: unknown, cookie = "", source: string | null = origin!) {
    const headers = new Headers({ "Content-Type": "application/json", Cookie: cookie });
    if (source !== null) headers.set("Origin", source);
    const send = () => fetch(`${origin}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    let response = await send();
    if (response.status === 429) {
      const seconds = Number(response.headers.get("x-retry-after"));
      assert.ok(seconds > 0 && seconds <= 60);
      await delay(seconds * 1000 + 100);
      response = await send();
    }
    return response;
  }
  async function login(address: string) {
    const response = await request("/api/auth/sign-in/email", { email: address, password });
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("better-auth.session_token="));
    assert.ok(cookie);
    return cookie.split(";")[0];
  }
  async function user(label: string) {
    const record = await db.user.create({ data: { email: email(label), name: label } });
    await db.account.create({ data: { userId: record.id, providerId: "credential", accountId: String(record.id), password: await hashPassword(password) } });
    return { ...record, cookie: await login(record.email) };
  }
  async function invite(workspaceId: number, address: string, cookie: string) {
    const response = await request(`/api/workspaces/${workspaceId}/customer-invitations`, { email: address }, cookie);
    assert.equal(response.status, 201);
    const { invitation } = await response.json();
    return { ...invitation, token: new URL(invitation.url).hash.slice(1) } as { id: number; token: string; url: string };
  }
  const accept = (token: string, cookie = "", extra = {}, source: string | null = origin!) => request("/api/customer-invitations/accept", { token, ...extra }, cookie, source);

  try {
    const owner = await user("owner");
    const agent = await user("agent");
    const customer = await user("customer");
    const outsider = await user("outsider");
    const a = await db.workspace.create({ data: { name: `Customer A ${marker}`, memberships: { create: [
      { userId: owner.id, role: "OWNER" }, { userId: agent.id, role: "AGENT" },
    ] } } });
    workspaceIds.push(a.id);
    const b = await db.workspace.create({ data: { name: `Customer B ${marker}`, memberships: { create: { userId: outsider.id, role: "OWNER" } } } });
    workspaceIds.push(b.id);

    await t.test("only owner/admin may issue customer links; links store a hash and grant no access yet", async () => {
      const path = `/api/workspaces/${a.id}/customer-invitations`;
      assert.equal((await request(path, { email: customer.email })).status, 401);
      assert.equal((await request(path, { email: customer.email }, agent.cookie)).status, 403);
      assert.equal((await request(path, { email: customer.email }, outsider.cookie)).status, 403);
      assert.equal((await request(path, { email: customer.email }, owner.cookie, "https://foreign.example")).status, 403);
      assert.equal((await request(path, { email: owner.email }, owner.cookie)).status, 409);
    });

    const link = await invite(a.id, customer.email.toUpperCase(), owner.cookie);
    await t.test("existing accounts must authenticate as the invited email and cannot reuse a link", async () => {
      const stored = await db.customerInvitation.findUniqueOrThrow({ where: { id: link.id } });
      assert.equal(stored.tokenHash, createHash("sha256").update(link.token).digest("hex"));
      assert.notEqual(stored.tokenHash, link.token);
      assert.equal(await db.customerAccess.count({ where: { workspaceId: a.id } }), 0);
      assert.equal(new URL(link.url).search, "");
      const preview = await request("/api/customer-invitations/preview", { token: link.token });
      assert.equal(preview.status, 200);
      assert.equal((await preview.json()).invitation.existingAccount, true);
      assert.equal((await accept("bad")).status, 410);
      assert.equal((await accept(link.token)).status, 401);
      assert.equal((await accept(link.token, outsider.cookie)).status, 403);
      assert.equal((await accept(link.token, customer.cookie, {}, "https://foreign.example")).status, 403);
      assert.equal((await accept(link.token, customer.cookie)).status, 200);
      assert.equal((await accept(link.token, customer.cookie)).status, 410);
      assert.equal(await db.membership.count({ where: { workspaceId: a.id, userId: customer.id } }), 0);
      assert.equal(await db.customerAccess.count({ where: { workspaceId: a.id, userId: customer.id } }), 1);
    });

    await t.test("only the authorized customer can submit; server derives customer identity and initial status", async () => {
      const path = "/api/customer/tickets";
      const body = { workspaceId: a.id, subject: " Customer issue ", description: " Please help ", customerId: outsider.id, status: "RESOLVED" };
      assert.equal((await request(path, body)).status, 401);
      assert.equal((await request(path, body, owner.cookie)).status, 403);
      assert.equal((await request(path, body, outsider.cookie)).status, 403);
      assert.equal((await request(path, body, customer.cookie, "https://foreign.example")).status, 403);
      assert.equal((await request(path, { ...body, workspaceId: b.id }, customer.cookie)).status, 403);
      assert.equal((await request(path, { ...body, subject: " " }, customer.cookie)).status, 400);
      const response = await request(path, body, customer.cookie);
      assert.equal(response.status, 201);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const { ticket } = await response.json();
      const saved = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      assert.equal(saved.workspaceId, a.id);
      assert.equal(saved.customerId, customer.id);
      assert.equal(saved.status, "OPEN");
      assert.equal(saved.subject, "Customer issue");
      assert.equal(saved.description, "Please help");
      assert.equal((await fetch(`${origin}/api/workspaces/${a.id}/tickets/${ticket.id}`, { headers: { Cookie: customer.cookie } })).status, 403);
      await db.customerAccess.delete({ where: { workspaceId_userId: { workspaceId: a.id, userId: customer.id } } });
      assert.equal((await request(path, body, customer.cookie)).status, 403);
    });

    await t.test("customer reads exclude other owners, other workspaces, internal notes, and revoked access", async () => {
      await db.customerAccess.createMany({ data: [
        { workspaceId: a.id, userId: customer.id },
        { workspaceId: a.id, userId: outsider.id },
      ] });
      const get = (path: string, cookie = customer.cookie) => fetch(`${origin}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
      const own = await db.ticket.create({ data: { workspaceId: a.id, customerId: customer.id, subject: "Visible customer ticket", description: "<script>customer request</script>" } });
      const other = await db.ticket.create({ data: { workspaceId: a.id, customerId: outsider.id, subject: "Other customer secret", description: "Private" } });
      const foreign = await db.ticket.create({ data: { workspaceId: b.id, customerId: customer.id, subject: "Revoked workspace secret", description: "Private" } });
      const legacy = await db.ticket.create({ data: { workspaceId: a.id, subject: "Staff-only ticket", description: "Private" } });
      const staffPath = `/api/workspaces/${a.id}/tickets/${own.id}/messages`;
      assert.equal((await request(staffPath, { kind: "INTERNAL_NOTE", body: "INTERNAL_SECRET_52" }, owner.cookie)).status, 201);
      assert.equal((await request(staffPath, { kind: "PUBLIC_REPLY", body: "Public answer <b>hello</b>" }, owner.cookie)).status, 201);
      const path = `/api/customer/tickets/${own.id}`;
      assert.equal((await get("/api/customer/tickets", "")).status, 401);
      assert.equal((await get(path, "")).status, 401);
      const listed = await get(`/api/customer/tickets?customerId=${outsider.id}&workspaceId=${b.id}`);
      assert.equal(listed.status, 200);
      assert.equal(listed.headers.get("cache-control"), "no-store");
      const { tickets } = await listed.json();
      assert.ok(tickets.some((ticket: { id: number }) => ticket.id === own.id));
      for (const hidden of [other, foreign, legacy]) {
        assert.ok(!tickets.some((ticket: { id: number }) => ticket.id === hidden.id));
        assert.equal((await get(`/api/customer/tickets/${hidden.id}`)).status, 404);
      }
      assert.equal((await get(path, outsider.cookie)).status, 404);
      assert.equal((await get(path, owner.cookie)).status, 404);
      assert.equal((await get("/api/customer/tickets/invalid")).status, 400);
      const detail = await get(path);
      assert.equal(detail.status, 200);
      assert.equal(detail.headers.get("cache-control"), "no-store");
      const { ticket } = await detail.json();
      assert.deepEqual(Object.keys(ticket).sort(), ["id", "subject", "description", "status", "createdAt", "workspace", "messages"].sort());
      assert.equal(ticket.messages.length, 1);
      assert.equal(ticket.messages[0].body, "Public answer <b>hello</b>");
      assert.deepEqual(Object.keys(ticket.messages[0]).sort(), ["id", "body", "createdAt"].sort());
      const html = await (await get(`/customer/tickets/${own.id}`)).text();
      assert.ok(html.includes("Public answer &lt;b&gt;hello&lt;/b&gt;"));
      assert.ok(!html.includes("INTERNAL_SECRET_52"));
      assert.ok(html.includes("&lt;script&gt;customer request&lt;/script&gt;"));
      const portal = await (await get("/customer")).text();
      assert.ok(portal.includes("Visible customer ticket"));
      assert.ok(!portal.includes("Other customer secret"));
      const deniedPage = await (await get(`/customer/tickets/${other.id}`)).text();
      assert.ok(!deniedPage.includes("Other customer secret"));
      const anonymousPage = await get(`/customer/tickets/${own.id}`, "");
      const anonymousHtml = await anonymousPage.text();
      // With a loading boundary Next may stream the redirect in a 200 response.
      assert.ok(anonymousPage.headers.get("location")?.includes("/sign-in") || anonymousHtml.includes("/sign-in?next="));
      assert.ok(!anonymousHtml.includes("Public answer"));
      await db.customerAccess.delete({ where: { workspaceId_userId: { workspaceId: a.id, userId: customer.id } } });
      assert.equal((await get(path)).status, 404);
      assert.deepEqual((await (await get("/api/customer/tickets")).json()).tickets, []);
      assert.ok(!(await (await get(`/customer/tickets/${own.id}`)).text()).includes("Public answer"));
    });

    await t.test("new invited customer gets a hashed credential, no staff membership, and can submit", async () => {
      const address = email("new-customer");
      const invitation = await invite(a.id, address, owner.cookie);
      assert.equal((await accept(invitation.token, "", { name: "New Customer", password: "short" })).status, 400);
      const response = await accept(invitation.token, "", { name: "New Customer", password, userId: owner.id });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).access.signInRequired, true);
      const created = await db.user.findUniqueOrThrow({ where: { email: address } });
      const account = await db.account.findUniqueOrThrow({ where: { providerId_accountId: { providerId: "credential", accountId: String(created.id) } } });
      assert.ok(account.password && account.password !== password);
      assert.equal(await db.membership.count({ where: { workspaceId: a.id, userId: created.id } }), 0);
      const cookie = await login(address);
      assert.equal((await request("/api/customer/tickets", { workspaceId: a.id, subject: "New ticket", description: "From customer" }, cookie)).status, 201);
    });
  } finally {
    await db.ticket.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.customerAccess.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    const final = {
      users: await db.user.count(), workspaces: await db.workspace.count(),
      tickets: await db.ticket.count(), customers: await db.customerAccess.count(), invitations: await db.customerInvitation.count(),
    };
    await db.$disconnect();
    assert.deepEqual(final, initial, "Existing records must be preserved");
  }
});
