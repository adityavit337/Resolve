import { changeMemberRole } from "../../../../../../lib/workspaces";
import { parseWorkspaceId, readWorkspaceBody, workspaceJson, workspaceRequest } from "../../../../../../lib/workspace-api";

type Context = { params: Promise<{ workspaceId: string; userId: string }> };

export async function PATCH(request: Request, context: Context) {
  return workspaceRequest(request, async (actorId) => {
    const params = await context.params;
    const member = await changeMemberRole(
      parseWorkspaceId(params.workspaceId), actorId, parseWorkspaceId(params.userId), await readWorkspaceBody(request),
    );
    return workspaceJson({ member });
  });
}
