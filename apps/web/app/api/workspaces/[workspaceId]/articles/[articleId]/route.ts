import { getArticle, updateArticle } from "../../../../../../lib/articles";
import { parseWorkspaceId, readWorkspaceBody, workspaceJson, workspaceRequest } from "../../../../../../lib/workspace-api";

type Context = { params: Promise<{ workspaceId: string; articleId: string }> };

export async function GET(request: Request, context: Context) {
  return workspaceRequest(request, async (userId) => {
    const { workspaceId, articleId } = await context.params;
    return workspaceJson({ article: await getArticle(parseWorkspaceId(workspaceId), userId, parseWorkspaceId(articleId)) });
  });
}

export async function PATCH(request: Request, context: Context) {
  return workspaceRequest(request, async (userId) => {
    const { workspaceId, articleId } = await context.params;
    return workspaceJson({ article: await updateArticle(parseWorkspaceId(workspaceId), userId, parseWorkspaceId(articleId), await readWorkspaceBody(request)) });
  });
}
