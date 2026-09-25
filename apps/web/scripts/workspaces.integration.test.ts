import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { getDb } from "../lib/db.ts";
import { isLocalDevelopmentDatabase } from "../lib/tickets.ts";

test("workspace creation and membership permissions over HTTP", async (t) => {
  assert.ok(isLocalDevelopmentDatabase(), "Use local resolve_dev outside production");
  const origin = process.env.BETTER_AUTH_URL;
  assert.equal(origin, "http://127.0.0.1:3000");
  assert.ok(process.env.DEV_SEED_PASSWORD, "Provision demo accounts first");
  const db = getDb();
  const sessionIds: number[] = [];
  const workspaceIds: number[] = [];
  const before = JSON.stringify(await db.membership.findMany({ orderBy: { id: "asc" } }));

  async function request(path: string, cookie = "", method = "GET", body?: unknown, source: string | null = origin!) {
    const headers = new Headers({ Cookie: cookie });
    if (source !== null) headers.set("Origin", source);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    return fetch(`${origin}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual", signal: AbortSignal.timeout(20_000),
    });
  }

  async function login(email: string) {
    let response = await request("/api/auth/sign-in/email", "", "POST", { email, password: process.env.DEV_SEED_PASSWORD });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("x-retry-after"));
      assert.ok(seconds > 0 && seconds <= 60);
      await delay(seconds * 1000 + 100);
      response = await request("/api/auth/sign-in/email", "", "POST", { email, password: process.env.DEV_SEED_PASSWORD });
    }
    assert.equal(response.status, 200, "Demo sign-in must succeed");
    const data = await response.json();
    const session = await db.session.findUniqueOrThrow({ where: { token: data.token }, select: { id: true } });
    sessionIds.push(session.id);
    return {
      id: Number(data.user.id),
      cookie: response.headers.getSetCookie().find((value) => value.startsWith("better-auth.session_token="))!.split(";")[0],
    };
  }

  try {
    const alice = await login("alice@example.test");
    const ben = await login("ben@example.test");
    const cara = await login("cara@example.test");
    let workspaceId = 0;

    await t.test("every workspace endpoint rejects anonymous requests", async () => {
      for (const [path, method] of [
        ["/api/workspaces", "GET"], ["/api/workspaces", "POST"],
        ["/api/workspaces/-1/members", "GET"], ["/api/workspaces/-1/members", "POST"],
        [`/api/workspaces/-1/members/${ben.id}`, "PATCH"],
      ]) {
        const response = await request(path, "", method, method === "GET" ? undefined : {});
        assert.equal(response.status, 401);
        assert.equal(response.headers.get("cache-control"), "no-store");
      }
      assert.equal((await request("/workspaces")).status, 307);
    });

    await t.test("invalid names, malformed bodies and foreign/missing origins do not create workspaces", async () => {
      const count = await db.workspace.count();
      for (const name of [" ", "x".repeat(101), 42]) assert.equal((await request("/api/workspaces", alice.cookie, "POST", { name })).status, 400);
      assert.equal((await request("/api/workspaces", alice.cookie, "POST", null)).status, 400);
      assert.equal((await request("/api/workspaces", alice.cookie, "POST", { name: "Denied" }, "https://foreign.example")).status, 403);
      assert.equal((await request("/api/workspaces", alice.cookie, "POST", { name: "Denied" }, null)).status, 403);
      const malformed = await fetch(`${origin}/api/workspaces`, {
        method: "POST", headers: { Cookie: alice.cookie, Origin: origin!, "Content-Type": "application/json" }, body: "{",
      });
      assert.equal(malformed.status, 400);
      assert.equal(await db.workspace.count(), count);
    });

    await t.test("creation persists with the authenticated creator as its only owner", async () => {
      const response = await request("/api/workspaces", alice.cookie, "POST", {
        name: `  Workspace test ${crypto.randomUUID()}  `, userId: cara.id, role: "AGENT",
      });
      assert.equal(response.status, 201);
      const { workspace } = await response.json();
      workspaceId = workspace.id;
      workspaceIds.push(workspaceId);
      assert.ok(workspaceId > 0);
      assert.equal(workspace.name, workspace.name.trim());
      const members = await db.membership.findMany({ where: { workspaceId } });
      assert.equal(members.length, 1);
      assert.equal(members[0].userId, alice.id);
      assert.equal(members[0].role, "OWNER");
      const list = await request("/api/workspaces", alice.cookie);
      assert.equal(list.status, 200);
      assert.ok((await list.json()).workspaces.some((item: { id: number; role: string }) => item.id === workspaceId && item.role === "OWNER"));
    });
    assert.ok(workspaceId, "Creation must succeed before member tests");
    const membersPath = `/api/workspaces/${workspaceId}/members`;
    const invitationsPath = `/api/workspaces/${workspaceId}/invitations`;
    async function enroll(cookie: string, email: string, role: string, recipientCookie: string) {
      const response = await request(invitationsPath, cookie, "POST", { email, role });
      assert.equal(response.status, 201);
      const { invitation } = await response.json();
      const token = new URL(invitation.url).hash.slice(1);
      assert.equal((await request("/api/invitations/accept", recipientCookie, "POST", { token })).status, 200);
    }

    await t.test("nonmembers cannot see or modify the workspace", async () => {
      const list = await request("/api/workspaces", cara.cookie);
      assert.ok(!(await list.json()).workspaces.some((item: { id: number }) => item.id === workspaceId));
      assert.equal((await request(membersPath, cara.cookie)).status, 403);
      assert.equal((await request(invitationsPath, cara.cookie, "POST", { email: "cara@example.test", role: "AGENT" })).status, 403);
      assert.equal((await request(`${membersPath}/${alice.id}`, cara.cookie, "PATCH", { role: "AGENT" })).status, 403);
      const page = await request(`/workspaces?workspace=${workspaceId}`, cara.cookie);
      assert.match(await page.text(), /This workspace is unavailable to you/);
    });

    await t.test("owner can invite an admin; duplicates and OWNER grants fail", async () => {
      assert.equal((await request(invitationsPath, alice.cookie, "POST", { email: "ben@example.test", role: "OWNER" })).status, 400);
      assert.equal((await request(invitationsPath, alice.cookie, "POST", { email: "not-an-email", role: "AGENT" })).status, 400);
      assert.equal((await request(invitationsPath, alice.cookie, "POST", { email: `${crypto.randomUUID()}@example.test`, role: "AGENT" })).status, 201);
      await enroll(alice.cookie, " BEN@example.test ", "ADMIN", ben.cookie);
      assert.equal((await request(invitationsPath, alice.cookie, "POST", { email: "ben@example.test", role: "AGENT" })).status, 409);
      const benMember = await db.membership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId: ben.id } } });
      assert.equal(benMember.role, "ADMIN");
    });

    await t.test("admin can add agents but cannot grant admin or change ownership/roles", async () => {
      assert.equal((await request(invitationsPath, ben.cookie, "POST", { email: "cara@example.test", role: "ADMIN" })).status, 403);
      await enroll(ben.cookie, "cara@example.test", "AGENT", cara.cookie);
      assert.equal((await request(`${membersPath}/${alice.id}`, ben.cookie, "PATCH", { role: "AGENT" })).status, 403);
      assert.equal((await request(`${membersPath}/${cara.id}`, ben.cookie, "PATCH", { role: "ADMIN" })).status, 403);
    });

    await t.test("agents can view members but cannot add members or promote themselves", async () => {
      const response = await request(membersPath, cara.cookie);
      assert.equal(response.status, 200);
      const { members } = await response.json();
      assert.equal(members.length, 3);
      assert.deepEqual(Object.keys(members[0].user).sort(), ["email", "name"]);
      assert.equal((await request(invitationsPath, cara.cookie, "POST", { email: "ben@example.test", role: "AGENT" })).status, 403);
      assert.equal((await request(`${membersPath}/${cara.id}`, cara.cookie, "PATCH", { role: "ADMIN" })).status, 403);
      const page = await request(`/workspaces?workspace=${workspaceId}`, cara.cookie);
      const html = await page.text();
      assert.match(html, /Members of/);
      assert.ok(!html.includes("Invite a member"));
      assert.ok(!html.includes("Save role"));
    });

    await t.test("owner role edits persist and revoked admin permission applies to the existing session", async () => {
      assert.equal((await request(`${membersPath}/${alice.id}`, alice.cookie, "PATCH", { role: "AGENT" })).status, 403);
      assert.equal((await request(`${membersPath}/${ben.id}`, alice.cookie, "PATCH", { role: "OWNER" })).status, 400);
      assert.equal((await request(`${membersPath}/${ben.id}`, alice.cookie, "PATCH", { role: "AGENT" }, "https://foreign.example")).status, 403);
      assert.equal((await request(`${membersPath}/${ben.id}`, alice.cookie, "PATCH", { role: "AGENT" })).status, 200);
      assert.equal((await request(invitationsPath, ben.cookie, "POST", { email: "cara@example.test", role: "AGENT" })).status, 403);
      assert.equal((await request(`${membersPath}/${cara.id}`, alice.cookie, "PATCH", { role: "ADMIN" })).status, 200);
      const member = await db.membership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId: cara.id } } });
      assert.equal(member.role, "ADMIN");
      // Cara remains an owner in her original workspace: roles are not global.
      const original = JSON.parse(before).find((row: { workspaceId: number; userId: number }) => row.workspaceId === -2 && row.userId === cara.id);
      assert.equal((await db.membership.findUniqueOrThrow({ where: { id: original.id } })).role, original.role);
      assert.equal((await request("/api/workspaces/not-a-number/members", alice.cookie)).status, 400);
      assert.equal((await request(`/api/workspaces/${workspaceId}/tickets`, alice.cookie)).status, 200);
    });
  } finally {
    // Only delete records created by this run. Never touch fixture memberships.
    await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await db.session.deleteMany({ where: { id: { in: sessionIds } } });
    const after = JSON.stringify(await db.membership.findMany({ orderBy: { id: "asc" } }));
    await db.$disconnect();
    assert.equal(after, before, "Existing memberships must remain unchanged");
  }
});
