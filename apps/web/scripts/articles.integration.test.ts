import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { getDb } from "../lib/db.ts";
import { isLocalDevelopmentDatabase } from "../lib/tickets.ts";

test("workspace help article lifecycle and boundaries", async (t) => {
  assert.ok(isLocalDevelopmentDatabase());
  const origin = process.env.BETTER_AUTH_URL;
  assert.equal(origin, "http://127.0.0.1:3000");
  const db = getDb();
  const marker = randomUUID();
  const password = randomUUID();
  const emails: string[] = [];
  const workspaceIds: number[] = [];
  const before = JSON.stringify(await db.helpArticle.findMany({ orderBy: { id: "asc" } }));
  async function request(path: string, cookie = "", method = "GET", body?: unknown, source: string | null = origin!) {
    const headers = new Headers({ Cookie: cookie, "Content-Type": "application/json" });
    if (source !== null) headers.set("Origin", source);
    return fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(20000) });
  }
  async function user(label: string) {
    const email = `article-${label}-${marker}@example.test`;
    emails.push(email);
    const record = await db.user.create({ data: { email, name: label } });
    await db.account.create({ data: { userId: record.id, providerId: "credential", accountId: String(record.id), password: await hashPassword(password) } });
    let response = await request("/api/auth/sign-in/email", "", "POST", { email, password });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("x-retry-after"));
      assert.ok(seconds > 0 && seconds <= 60);
      await delay(seconds * 1000 + 100);
      response = await request("/api/auth/sign-in/email", "", "POST", { email, password });
    }
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("better-auth.session_token="));
    assert.ok(cookie);
    return { ...record, cookie: cookie.split(";")[0] };
  }
  try {
    const owner = await user("owner");
    const admin = await user("admin");
    const agent = await user("agent");
    const customer = await user("customer");
    const a = await db.workspace.create({ data: { name: `Articles A ${marker}`, memberships: { create: [
      { userId: owner.id, role: "OWNER" }, { userId: admin.id, role: "ADMIN" }, { userId: agent.id, role: "AGENT" },
    ] }, customerAccesses: { create: { userId: customer.id } } } });
    workspaceIds.push(a.id);
    const b = await db.workspace.create({ data: { name: `Articles B ${marker}`, memberships: { create: { userId: admin.id, role: "OWNER" } } } });
    workspaceIds.push(b.id);
    const path = `/api/workspaces/${a.id}/articles`;
    const foreignPath = `/api/workspaces/${b.id}/articles`;
    const valid = { title: " Reset password ", body: " Follow these instructions. " };
    let articleId = 0;

    await t.test("anonymous, customers, and foreign-workspace requests are denied", async () => {
      for (const [url, method] of [[path, "GET"], [path, "POST"], [`${path}/1`, "GET"], [`${path}/1`, "PATCH"]]) {
        assert.equal((await request(url, "", method, method === "GET" ? undefined : valid)).status, 401);
        assert.equal((await request(url, customer.cookie, method, method === "GET" ? undefined : valid)).status, 403);
      }
      assert.equal((await request(foreignPath, agent.cookie)).status, 403);
      assert.equal((await request(foreignPath, agent.cookie, "POST", valid)).status, 403);
      const page = await request(`/articles?workspace=${a.id}`, customer.cookie);
      assert.ok((await page.text()).includes("This workspace is unavailable to you"));
    });

    await t.test("all staff roles create drafts with session-derived actors and scoped lists", async () => {
      for (const actor of [owner, admin, agent]) {
        const response = await request(path, actor.cookie, "POST", { ...valid, status: "PUBLISHED", workspaceId: b.id, createdById: customer.id, updatedById: customer.id });
        assert.equal(response.status, 201);
        const { article } = await response.json();
        articleId = article.id;
        assert.equal(article.status, "DRAFT"); assert.equal(article.publishedAt, null);
        assert.equal(article.title, "Reset password"); assert.equal(article.body, "Follow these instructions.");
        assert.equal(article.workspaceId, a.id); assert.equal(article.createdById, actor.id); assert.equal(article.updatedById, actor.id);
      }
      const list = await request(path, agent.cookie);
      assert.equal(list.headers.get("cache-control"), "no-store");
      assert.equal((await list.json()).articles.length, 3);
      assert.deepEqual((await (await request(foreignPath, admin.cookie)).json()).articles, []);
    });

    await t.test("invalid content, IDs, versions, JSON, statuses and origins are rejected", async () => {
      for (const body of [{ title: " ", body: "x" }, { title: "x".repeat(201), body: "x" }, { title: "x", body: " " }, { title: "x", body: "x".repeat(50001) }, null, []]) {
        assert.equal((await request(path, owner.cookie, "POST", body)).status, 400);
      }
      const malformed = await fetch(`${origin}${path}`, { method: "POST", headers: { Cookie: owner.cookie, Origin: origin!, "Content-Type": "application/json" }, body: "{" });
      assert.equal(malformed.status, 400);
      for (const source of [null, "https://foreign.example"]) {
        assert.equal((await request(path, owner.cookie, "POST", valid, source)).status, 403);
        assert.equal((await request(`${path}/${articleId}`, owner.cookie, "PATCH", { ...valid, version: 0, status: "PUBLISHED" }, source)).status, 403);
      }
      for (const fields of [{ status: "OTHER", version: 0 }, { status: "DRAFT", version: "0" }, { status: "DRAFT", version: -1 }]) {
        assert.equal((await request(`${path}/${articleId}`, agent.cookie, "PATCH", { ...valid, ...fields })).status, 400);
      }
      assert.equal((await request(`${path}/invalid`, agent.cookie)).status, 400);
      assert.equal((await request(`${foreignPath}/${articleId}`, admin.cookie)).status, 404);
      assert.equal((await request(`${foreignPath}/${articleId}`, admin.cookie, "PATCH", { ...valid, status: "PUBLISHED", version: 0 })).status, 404);
    });

    await t.test("edit, publish, edit published text, and unpublish persist without changing creator", async () => {
      let version = 0;
      for (const [actor, status] of [[owner, "DRAFT"], [admin, "PUBLISHED"], [agent, "PUBLISHED"], [owner, "DRAFT"]] as const) {
        const response = await request(`${path}/${articleId}`, actor.cookie, "PATCH", { title: `Edited ${version}`, body: "<script>plain text</script>", status, version, createdById: customer.id, workspaceId: b.id });
        assert.equal(response.status, 200);
        const { article } = await response.json();
        assert.equal(article.version, ++version); assert.equal(article.status, status);
        assert.equal(article.createdById, agent.id); assert.equal(article.updatedById, actor.id);
        assert.equal(article.workspaceId, a.id);
        assert.equal(article.publishedAt === null, status === "DRAFT");
        const persisted = await (await request(`${path}/${articleId}`, agent.cookie)).json();
        assert.deepEqual(persisted.article, article);
      }
    });

    await t.test("stale and simultaneous edits cannot overwrite the winning version", async () => {
      const body = { ...valid, version: 4, status: "PUBLISHED" };
      assert.equal((await request(`${path}/${articleId}`, owner.cookie, "PATCH", { ...body, version: 0 })).status, 409);
      const results = await Promise.all([owner, agent].map((actor) => request(`${path}/${articleId}`, actor.cookie, "PATCH", body)));
      assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
      assert.equal((await db.helpArticle.findUniqueOrThrow({ where: { id: articleId } })).version, 5);
    });

    await t.test("published search enforces access, validation, ranking, and publication changes", async () => {
      const searchUrl = (query: string, base = path) => `${base}?q=${encodeURIComponent(query)}`;
      assert.equal((await request(searchUrl("refund"))).status, 401);
      assert.equal((await request(searchUrl("refund"), customer.cookie)).status, 403);
      assert.equal((await request(searchUrl("refund", foreignPath), agent.cookie)).status, 403);
      for (const query of ["", "   ", "x".repeat(201)]) {
        assert.equal((await request(searchUrl(query), agent.cookie)).status, 400);
      }
      async function sample(title: string, body: string, workspaceId = a.id, status: "DRAFT" | "PUBLISHED" = "PUBLISHED") {
        return db.helpArticle.create({ data: { title, body, workspaceId, status,
          publishedAt: status === "PUBLISHED" ? new Date() : null, createdById: admin.id, updatedById: admin.id } });
      }
      const refund = await sample("Refund policy", "Request a refund within thirty days. Provide your order number for a refund.");
      const reset = await sample("Password reset", "Reset your password from the sign-in page. Follow the password reset email link.");
      const delivery = await sample("Delivery tracking", "Track delivery with the tracking number in your shipment email.");
      await sample("Invoice download", "Download an invoice from billing settings.");
      await sample("Refund internal draft", "refund refund refund", a.id, "DRAFT");
      await sample("Refund foreign company", "refund refund refund", b.id);
      const results = async (query: string) => {
        const response = await request(searchUrl(query), agent.cookie);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        return (await response.json()).articles as Array<{ id: number; title: string; status: string }>;
      };
      for (const [query, expected] of [
        ["Can I request a refund?", refund.id], ["How do I reset my password?", reset.id],
        ["Where is my delivery tracking number?", delivery.id], ["shipment", delivery.id],
      ] as const) {
        const found = await results(query);
        assert.equal(found[0]?.id, expected);
        assert.ok(found.every((row) => row.status === "PUBLISHED"));
        console.log(JSON.stringify({ question: query, rankedTitles: found.map((row) => row.title) }));
      }
      assert.deepEqual((await results("refund")).map((row) => row.id), [refund.id]);
      for (const query of ["zxqvnomatch", "the and", "AI", "reimbursement", "refnud", "' OR 1=1 --"]) {
        assert.deepEqual(await results(query), []);
        console.log(JSON.stringify({ question: query, rankedTitles: [] }));
      }
      assert.equal((await request(`${path}/${refund.id}`, agent.cookie, "PATCH", {
        title: refund.title, body: refund.body, status: "DRAFT", version: refund.version,
      })).status, 200);
      assert.deepEqual(await results("refund"), []);
      assert.equal((await request(`${path}/${refund.id}`, agent.cookie, "PATCH", {
        title: refund.title, body: refund.body, status: "PUBLISHED", version: refund.version + 1,
      })).status, 200);
      assert.deepEqual((await results("refund")).map((row) => row.id), [refund.id]);
      const plan = await db.$queryRaw`EXPLAIN SELECT id, title, status, updatedAt FROM HelpArticle
        WHERE workspaceId = ${a.id} AND status = 'PUBLISHED' AND publishedAt IS NOT NULL
        AND MATCH(title, body) AGAINST (${"refund"} IN NATURAL LANGUAGE MODE) > 0
        ORDER BY MATCH(title, body) AGAINST (${"refund"} IN NATURAL LANGUAGE MODE) DESC, id DESC LIMIT 20`;
      console.log(JSON.stringify({ searchPlan: plan }, (_, value) => typeof value === "bigint" ? Number(value) : value));
      const settings = await db.$queryRaw`SELECT @@innodb_ft_min_token_size AS minTokenSize, @@innodb_ft_enable_stopword AS stopwordsEnabled`;
      console.log(JSON.stringify({ settings }, (_, value) => typeof value === "bigint" ? Number(value) : value));
    });

    await t.test("search caps results at twenty with stable ordering for equal matches", async () => {
      const ids: number[] = [];
      for (let i = 0; i < 23; i++) {
        const row = await db.helpArticle.create({ data: { workspaceId: a.id, title: "limittesttoken", body: "Identical searchable content",
          status: "PUBLISHED", publishedAt: new Date(), createdById: owner.id, updatedById: owner.id } });
        ids.push(row.id);
      }
      const response = await request(`${path}?q=limittesttoken`, owner.cookie);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).articles.map((row: { id: number }) => row.id), ids.reverse().slice(0, 20));
    });

    await t.test("revoked membership denies reads and writes on an existing session", async () => {
      await db.membership.delete({ where: { workspaceId_userId: { workspaceId: a.id, userId: agent.id } } });
      assert.equal((await request(`${path}?q=refund`, agent.cookie)).status, 403);
      for (const [url, method] of [[path, "GET"], [path, "POST"], [`${path}/${articleId}`, "GET"], [`${path}/${articleId}`, "PATCH"]]) {
        assert.equal((await request(url, agent.cookie, method, method === "GET" ? undefined : { ...valid, version: 5, status: "DRAFT" })).status, 403);
      }
    });
  } finally {
    await db.helpArticle.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.customerAccess.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    const after = JSON.stringify(await db.helpArticle.findMany({ orderBy: { id: "asc" } }));
    await db.$disconnect();
    assert.equal(after, before, "Pre-existing articles must remain unchanged");
  }
});
