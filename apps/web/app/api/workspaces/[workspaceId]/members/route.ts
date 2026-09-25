import { listMembers } from "../../../../../lib/workspaces";
import { parseWorkspaceId, workspaceJson, workspaceRequest } from "../../../../../lib/workspace-api";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context) {
  return workspaceRequest(request, async (userId) => {
    const workspaceId = parseWorkspaceId((await context.params).workspaceId);
    return workspaceJson({ members: await listMembers(workspaceId, userId) });
  });
}

export async function POST(request: Request) {
  return workspaceRequest(request, async () => workspaceJson({ error: {
    code: "INVITATION_REQUIRED", message: "Use invitations to add members.",
  } }, 410));
}
