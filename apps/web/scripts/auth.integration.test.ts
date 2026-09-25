import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { getDb } from "../lib/db.ts";
import { isLocalDevelopmentDatabase } from "../lib/tickets.ts";

// Run against the local dev server. Each test-created session and ticket is
// tracked explicitly so cleanup cannot affect an existing browser session.
test("authentication and protected ticket HTTP flow", async (t) => {
  assert.ok(isLocalDevelopmentDatabase(), "Tests require local resolve_dev outside production");
  assert.equal(process.env.BETTER_AUTH_URL, "http://127.0.0.1:3000");
  const password = process.env.DEV_SEED_PASSWORD;
  assert.ok(password, "Set DEV_SEED_PASSWORD and run db:seed-auth first");
  const origin = process.env.BETTER_AUTH_URL;
  const db = getDb();
  const sessionIds: number[] = [];
  const ticketIds: number[] = [];
  let cookie = "";

  async function request(path: string, init: RequestInit = {}) {
    const send = () => fetch(`${origin}${path}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    let response = await send();
    // Other integration suites share the running server's auth rate limiter.
    if (response.status === 429) {
      const seconds = Number(response.headers.get("x-retry-after"));
      assert.ok(seconds > 0 && seconds <= 60, "Throttled auth request must provide a bounded retry delay");
      await delay(seconds * 1000 + 100);
      response = await send();
    }
    return response;
  }

  function post(body: unknown, sessionCookie = cookie, requestOrigin = origin): RequestInit {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: requestOrigin, Cookie: sessionCookie },
      body: JSON.stringify(body),
    };
  }

  async function signIn() {
    const response = await request("/api/auth/sign-in/email", post({ email: "alice@example.test", password }, ""));
    assert.equal(response.status, 200, "Demo sign-in should succeed");
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith("better-auth.session_token="));
    assert.ok(setCookie, "Sign-in must set the session cookie");
    assert.ok(/; HttpOnly/i.test(setCookie));
    assert.ok(/; SameSite=Lax/i.test(setCookie));
    assert.ok(!/; Domain=/i.test(setCookie), "Session must be host-only");
    const body = await response.json();
    const session = await db.session.findUnique({ where: { token: body.token }, select: { id: true } });
    assert.ok(session, "Sign-in must persist a session in MySQL");
    sessionIds.push(session.id);
    return setCookie.split(";")[0];
  }

  try {
    await t.test("anonymous page redirects; health remains public; both ticket methods return 401", async () => {
      const page = await request("/");
      assert.equal(page.status, 307);
      assert.equal(new URL(page.headers.get("location")!, origin).pathname, "/sign-in");
      assert.equal((await request("/api/health")).status, 200);
      const form = await request("/sign-in");
      assert.equal(form.status, 200);
      assert.match(await form.text(), /Sign in to Resolve/);
      for (const init of [{}, post({}, "")]) {
        const response = await request("/api/workspaces/-1/tickets", init);
        assert.equal(response.status, 401);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
      }
    });

    await t.test("bad credentials and direct public signup fail", async () => {
      const bad = await request("/api/auth/sign-in/email", post({ email: "alice@example.test", password: "incorrect-password" }, ""));
      assert.equal(bad.status, 401);
      assert.ok(!bad.headers.getSetCookie().some((value) => value.startsWith("better-auth.session_token=")));
      const count = await db.user.count();
      const signup = await request("/api/auth/sign-up/email", post({ email: "uninvited@example.test", password, name: "Uninvited" }, ""));
      assert.equal(signup.status, 400);
      assert.equal((await signup.json()).code, "EMAIL_PASSWORD_SIGN_UP_DISABLED");
      assert.equal(await db.user.count(), count);
    });

    await t.test("sign-in grants access and a later request keeps the same identity", async () => {
      cookie = await signIn();
      const tickets = await request("/api/workspaces/-1/tickets", { headers: { Cookie: cookie } });
      assert.equal(tickets.status, 200);
      assert.ok(Array.isArray((await tickets.json()).tickets));
      const page = await request("/", { headers: { Cookie: cookie } });
      assert.equal(page.status, 200);
      assert.match(await page.text(), /alice@example.test/);
      const session = await request("/api/auth/get-session", { headers: { Cookie: cookie } });
      assert.equal((await session.json()).user.email, "alice@example.test");
    });

    await t.test("forged cookies cannot authenticate", async () => {
      const response = await request("/api/workspaces/-1/tickets", { headers: { Cookie: "better-auth.session_token=forged" } });
      assert.equal(response.status, 401);
    });

    await t.test("another workspace is forbidden for both reading and writing", async () => {
      const count = await db.ticket.count({ where: { workspaceId: -2 } });
      for (const init of [{ headers: { Cookie: cookie } }, post({ subject: "Forbidden", description: "Must not be saved" })]) {
        const response = await request("/api/workspaces/-2/tickets", init);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error.code, "FORBIDDEN");
      }
      assert.equal(await db.ticket.count({ where: { workspaceId: -2 } }), count);
    });

    await t.test("cross-origin sign-in, sign-out, and ticket writes are rejected", async () => {
      const foreign = "https://untrusted.example";
      const attempts = [
        ["/api/auth/sign-in/email", post({ email: "alice@example.test", password }, "", foreign)],
        ["/api/auth/sign-out", post({}, cookie, foreign)],
        ["/api/workspaces/-1/tickets", post({ subject: "Forbidden", description: "Must not be saved" }, cookie, foreign)],
      ] as const;
      for (const [path, init] of attempts) assert.equal((await request(path, init)).status, 403);
      const missingOrigin = post({});
      const headers = new Headers(missingOrigin.headers);
      headers.delete("origin");
      assert.equal((await request("/api/workspaces/-1/tickets", { ...missingOrigin, headers })).status, 403);
    });

    await t.test("authenticated creation persists; input validation still rejects blank fields", async () => {
      const bad = await request("/api/workspaces/-1/tickets", post({ subject: " ", description: " " }));
      assert.equal(bad.status, 400);
      const marker = `Auth verification ${crypto.randomUUID()}`;
      const response = await request("/api/workspaces/-1/tickets", post({ subject: marker, description: "Temporary integration-test record" }));
      assert.equal(response.status, 201);
      const { ticket } = await response.json();
      ticketIds.push(ticket.id);
      const record = await db.ticket.findUnique({ where: { id: ticket.id } });
      assert.equal(record?.workspaceId, -1);
      assert.equal(record?.subject, marker);
    });

    await t.test("sign-out deletes the session and replaying its old cookie returns 401", async () => {
      const response = await request("/api/auth/sign-out", post({}));
      assert.equal(response.status, 200);
      assert.ok(response.headers.getSetCookie().some((value) => /session_token=.*Max-Age=0/i.test(value)));
      assert.equal(await db.session.count({ where: { id: sessionIds[0] } }), 0);
      assert.equal((await request("/api/workspaces/-1/tickets", { headers: { Cookie: cookie } })).status, 401);
      assert.equal((await request("/api/workspaces/-1/tickets", post({}))).status, 401);
    });

    await t.test("an expired database session is rejected even with its original signed cookie", async () => {
      cookie = await signIn();
      await db.session.update({ where: { id: sessionIds.at(-1)! }, data: { expiresAt: new Date(Date.now() - 60_000) } });
      assert.equal((await request("/api/workspaces/-1/tickets", { headers: { Cookie: cookie } })).status, 401);
      assert.equal((await request("/api/workspaces/-1/tickets", post({}))).status, 401);
    });
  } finally {
    await db.session.deleteMany({ where: { id: { in: sessionIds } } });
    await db.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    await db.$disconnect();
  }
});
