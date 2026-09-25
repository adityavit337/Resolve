import "server-only";
import { getDb } from "./db.ts";
import { requireMember } from "./workspaces.ts";
import { WorkspaceError } from "./workspace-api.ts";

const selection = {
  id: true, workspaceId: true, title: true, body: true, status: true,
  version: true, publishedAt: true, createdAt: true, updatedAt: true,
  createdById: true, updatedById: true,
} as const;

function content(input: Record<string, unknown>) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title || title.length > 200 || !body || body.length > 50_000) {
    throw new WorkspaceError(400, "VALIDATION_ERROR", "Enter a title (1–200 characters) and body (1–50,000 characters).");
  }
  return { title, body };
}

export async function listArticles(workspaceId: number, userId: number) {
  return getDb().$transaction(async (tx) => {
    await requireMember(tx, workspaceId, userId);
    return tx.helpArticle.findMany({
      where: { workspaceId },
      select: { id: true, title: true, status: true, updatedAt: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
  }, { isolationLevel: "Serializable" });
}

export async function getArticle(workspaceId: number, userId: number, articleId: number) {
  return getDb().$transaction(async (tx) => {
    await requireMember(tx, workspaceId, userId);
    const article = await tx.helpArticle.findFirst({ where: { id: articleId, workspaceId }, select: selection });
    if (!article) throw new WorkspaceError(404, "ARTICLE_NOT_FOUND", "Article not found in this workspace.");
    return article;
  }, { isolationLevel: "Serializable" });
}

// Natural-language mode treats input as search text, not boolean search syntax.
// Tagged-template parameters are bound values, never interpolated SQL source.
export async function searchArticles(workspaceId: number, userId: number, input: string) {
  return getDb().$transaction(async (tx) => {
    await requireMember(tx, workspaceId, userId);
    const query = input.trim();
    if (!query || query.length > 200) {
      throw new WorkspaceError(400, "VALIDATION_ERROR", "Enter a search question (1–200 characters).");
    }
    return tx.$queryRaw<Array<{ id: number; title: string; status: "PUBLISHED"; updatedAt: Date }>>`
      SELECT id, title, status, updatedAt
      FROM HelpArticle
      WHERE workspaceId = ${workspaceId} AND status = 'PUBLISHED' AND publishedAt IS NOT NULL
        AND MATCH(title, body) AGAINST (${query} IN NATURAL LANGUAGE MODE) > 0
      ORDER BY MATCH(title, body) AGAINST (${query} IN NATURAL LANGUAGE MODE) DESC, id DESC
      LIMIT 20
    `;
  }, { isolationLevel: "Serializable" });
}

export async function createArticle(workspaceId: number, userId: number, input: Record<string, unknown>) {
  return getDb().$transaction(async (tx) => {
    await requireMember(tx, workspaceId, userId);
    // New articles always start as drafts. Actor and workspace never come from the body.
    return tx.helpArticle.create({ data: {
      ...content(input), workspaceId, createdById: userId, updatedById: userId,
    }, select: selection });
  }, { isolationLevel: "Serializable" });
}

export async function updateArticle(workspaceId: number, userId: number, articleId: number, input: Record<string, unknown>) {
  return getDb().$transaction(async (tx) => {
    await requireMember(tx, workspaceId, userId);
    const article = await tx.helpArticle.findFirst({ where: { id: articleId, workspaceId }, select: selection });
    if (!article) throw new WorkspaceError(404, "ARTICLE_NOT_FOUND", "Article not found in this workspace.");
    const fields = content(input);
    if (!Number.isInteger(input.version) || (input.version as number) < 0 || (input.version as number) > 2147483646 ||
      (input.status !== "DRAFT" && input.status !== "PUBLISHED")) {
      throw new WorkspaceError(400, "VALIDATION_ERROR", "Send the current version and a DRAFT or PUBLISHED status.");
    }
    if (input.version !== article.version) throw new WorkspaceError(409, "STALE_ARTICLE", "This article changed. Reload it before saving again.");
    const result = await tx.helpArticle.updateMany({
      where: { id: articleId, workspaceId, version: article.version },
      data: {
        ...fields, status: input.status, updatedById: userId, version: { increment: 1 },
        publishedAt: input.status === "DRAFT" ? null : article.publishedAt ?? new Date(),
      },
    });
    if (result.count !== 1) throw new WorkspaceError(409, "STALE_ARTICLE", "This article changed. Reload it before saving again.");
    return tx.helpArticle.findFirstOrThrow({ where: { id: articleId, workspaceId }, select: selection });
  }, { isolationLevel: "Serializable" });
}
