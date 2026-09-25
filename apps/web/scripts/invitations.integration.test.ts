import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { getDb } from "../lib/db.ts";
import { isLocalDevelopmentDatabase } from "../lib/tickets.ts";

test("private invitation lifecycle through HTTP and MySQL", async (t) => {
  assert.ok(isLocalDevelopmentDatabase());
  const origin = process.env.BETTER_AUTH_URL;
  assert.equal(origin, "http://127.0.0.1:3000");
  const db = getDb();
  const marker = randomUUID();
  const password = randomUUID();
  const emails: string[] = [];
  const workspaceIds: number[] = [];
  async function snapshot() {
    return JSON.stringify({
      workspaces: await db.workspace.findMany({ orderBy: { id: "asc" } }),
      memberships: await db.membership.findMany({ orderBy: { id: "asc" } }),
      tickets: await db.ticket.findMany({ orderBy: { id: "asc" } }),
      invitations: await db.invitation.findMany({ orderBy: { id: "asc" } }),
    });
  }
  const before = await snapshot();
  function email(label: string) { const value = `${label}-${marker}@example.test`; emails.push(value); return value; }
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
    assert.equal(response.status, 200, "Login should succeed");
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("better-auth.session_token="));
    assert.ok(cookie);
    return cookie.split(";")[0];
  }
  async function user(label: string) {
    const record = await db.user.create({ data: { name: label, email: email(label) } });
    await db.account.create({ data: { userId: record.id, providerId: "credential", accountId: String(record.id), password: await hashPassword(password) } });
    return { ...record, cookie: await login(record.email) };
  }
  async function invite(workspaceId: number, address: string, cookie: string, role = "AGENT") {
    const response = await request(`/api/workspaces/${workspaceId}/invitations`, { email: address, role }, cookie);
    assert.equal(response.status, 201, "Invitation creation should succeed");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const { invitation } = await response.json();
    return { ...invitation, token: new URL(invitation.url).hash.slice(1) } as { id: number; token: string; url: string };
  }
  const accept = (token: string, cookie = "", extra = {}) => request("/api/invitations/accept", { token, ...extra }, cookie);

  try {
    const owner = await user("owner");
    const other = await user("other-owner");
    const recipient = await user("recipient");
    const a = await db.workspace.create({ data: { name: `Invitation A ${marker}`, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
    workspaceIds.push(a.id);
    const b = await db.workspace.create({ data: { name: `Invitation B ${marker}`, memberships: { create: { userId: other.id, role: "OWNER" } } } });
    workspaceIds.push(b.id);
    const path = `/api/workspaces/${a.id}/invitations`;
    const link = await invite(a.id, recipient.email.toUpperCase(), owner.cookie);

    await t.test("creation stores only a token hash and gives no membership before acceptance", async () => {
      const record = await db.invitation.findUniqueOrThrow({ where: { id: link.id } });
      assert.ok(record.tokenHash !== link.token);
      assert.ok(record.tokenHash === createHash("sha256").update(link.token).digest("hex"));
      assert.equal(record.email, recipient.email);
      assert.ok(record.expiresAt.getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000);
      assert.equal(await db.membership.count({ where: { workspaceId: a.id, userId: recipient.id } }), 0);
      const preview = await request("/api/invitations/preview", { token: link.token });
      assert.equal(preview.status, 200);
      const { invitation } = await preview.json();
      assert.equal(invitation.email, recipient.email);
      assert.equal(invitation.existingAccount, true);
      assert.ok(!("tokenHash" in invitation));
      assert.equal(new URL(link.url).search, "");
    });

    await t.test("anonymous, nonmember, forged-role, and foreign-origin invitation creation is rejected", async () => {
      const body = { email: email("denied"), role: "AGENT" };
      assert.equal((await request(path, body)).status, 401);
      assert.equal((await request(path, body, other.cookie)).status, 403);
      assert.equal((await request(path, { ...body, role: "OWNER" }, owner.cookie)).status, 400);
      for (const source of [null, "https://foreign.example"]) {
        assert.equal((await request(path, body, owner.cookie, source)).status, 403);
        assert.equal((await request("/api/invitations/accept", { token: link.token }, recipient.cookie, source)).status, 403);
      }
      assert.equal((await request(`/api/workspaces/${a.id}/members`, body, owner.cookie)).status, 410);
    });

    await t.test("invalid, expired, and reissued links cannot create accounts or memberships", async () => {
      for (const token of ["", "broken", "a".repeat(64)]) assert.equal((await accept(token)).status, 410);
      const expired = await invite(a.id, email("expired"), owner.cookie);
      await db.invitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1) } });
      assert.equal((await accept(expired.token, "", { name: "Expired", password })).status, 410);
      const address = email("reissued");
      const old = await invite(a.id, address, owner.cookie);
      await invite(a.id, address, owner.cookie);
      assert.equal((await accept(old.token, "", { name: "Old", password })).status, 410);
      assert.equal(await db.user.count({ where: { email: { in: [address, emails.find((value) => value.startsWith("expired-"))!] } } }), 0);
    });

    await t.test("existing accounts require the matching session; rejection does not consume the token", async () => {
      assert.equal((await accept(link.token, "", { name: "Override", password })).status, 401);
      assert.equal((await accept(link.token, other.cookie)).status, 403);
      assert.equal((await db.invitation.findUniqueOrThrow({ where: { id: link.id } })).acceptedAt, null);
      const response = await accept(link.token, recipient.cookie, { workspaceId: b.id, userId: other.id, role: "OWNER" });
      assert.equal(response.status, 200);
      const { membership } = await response.json();
      assert.equal(membership.workspaceId, a.id);
      assert.equal(membership.role, "AGENT");
      assert.equal((await accept(link.token, recipient.cookie)).status, 410);
      assert.equal(await db.membership.count({ where: { workspaceId: b.id, userId: recipient.id } }), 0);
    });

    await t.test("agents cannot invite; admins only invite agents; sender demotion invalidates pending links", async () => {
      const body = { email: email("admin-invite"), role: "AGENT" };
      assert.equal((await request(path, body, recipient.cookie)).status, 403);
      await db.membership.update({ where: { workspaceId_userId: { workspaceId: a.id, userId: recipient.id } }, data: { role: "ADMIN" } });
      assert.equal((await request(path, { ...body, role: "ADMIN" }, recipient.cookie)).status, 403);
      const adminLink = await invite(a.id, body.email, recipient.cookie);
      await db.membership.update({ where: { workspaceId_userId: { workspaceId: a.id, userId: recipient.id } }, data: { role: "AGENT" } });
      assert.equal((await accept(adminLink.token, "", { name: "Blocked", password })).status, 410);
    });

    await t.test("new invitees create a hashed credential account and can sign in; public signup stays disabled", async () => {
      const address = email("new-user");
      const invitation = await invite(a.id, address, owner.cookie, "ADMIN");
      assert.equal((await accept(invitation.token, "", { name: "New User", password: "short" })).status, 400);
      assert.equal((await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).acceptedAt, null);
      const response = await accept(invitation.token, "", { name: " New User ", password, email: other.email, role: "OWNER" });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).membership.signInRequired, true);
      const created = await db.user.findUniqueOrThrow({ where: { email: address } });
      assert.equal(created.name, "New User");
      const account = await db.account.findUniqueOrThrow({ where: { providerId_accountId: { providerId: "credential", accountId: String(created.id) } } });
      assert.ok(account.password && account.password !== password);
      assert.equal((await db.membership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: a.id, userId: created.id } } })).role, "ADMIN");
      const cookie = await login(address);
      const tickets = await fetch(`${origin}/api/workspaces/${a.id}/tickets`, { headers: { Cookie: cookie } });
      assert.equal(tickets.status, 200);
      assert.equal((await accept(invitation.token, "", { name: "Again", password })).status, 410);
      assert.equal((await request("/api/auth/sign-up/email", { email: email("public"), name: "Public", password })).status, 400);
    });

    await t.test("simultaneous acceptance succeeds once and preserves an existing member's role", async () => {
      const invitation = await invite(b.id, recipient.email, other.cookie, "AGENT");
      // Simulate another valid enrollment occurring while this link is pending.
      await db.membership.create({ data: { workspaceId: b.id, userId: recipient.id, role: "ADMIN" } });
      const responses = await Promise.all([accept(invitation.token, recipient.cookie), accept(invitation.token, recipient.cookie)]);
      assert.equal(responses.filter((response) => response.status === 200).length, 1);
      assert.ok(responses.some((response) => response.status === 409 || response.status === 410));
      assert.equal((await db.membership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: b.id, userId: recipient.id } } })).role, "ADMIN");
      assert.equal((await accept(invitation.token, recipient.cookie)).status, 410);
    });
  } finally {
    await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } }); // Cascade only these test invitations.
    await db.user.deleteMany({ where: { email: { in: emails } } }); // Cascade only these test accounts/sessions.
    const after = await snapshot();
    await db.$disconnect();
    assert.equal(after, before, "Existing company records and invitations must be preserved");
  }
});
