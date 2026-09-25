import { createArticle, listArticles, searchArticles } from "../../../../../lib/articles";
import { parseWorkspaceId, readWorkspaceBody, workspaceJson, workspaceRequest } from "../../../../../lib/workspace-api";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context) {
  return workspaceRequest(request, async (userId) => {
    const id = parseWorkspaceId((await context.params).workspaceId);
    const query = new URL(request.url).searchParams.get("q");
    return workspaceJson({ articles: query === null ? await listArticles(id, userId) : await searchArticles(id, userId, query) });
  });
}

export async function POST(request: Request, context: Context) {
  return workspaceRequest(request, async (userId) => {
    const id = parseWorkspaceId((await context.params).workspaceId);
    return workspaceJson({ article: await createArticle(id, userId, await readWorkspaceBody(request)) }, 201);
  });
}
