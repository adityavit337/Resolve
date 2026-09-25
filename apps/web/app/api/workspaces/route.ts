import { createWorkspace, listWorkspaces } from "../../../lib/workspaces";
import { readWorkspaceBody, workspaceJson, workspaceRequest } from "../../../lib/workspace-api";

export async function GET(request: Request) {
  return workspaceRequest(request, async (userId) => workspaceJson({ workspaces: await listWorkspaces(userId) }));
}

export async function POST(request: Request) {
  return workspaceRequest(request, async (userId) => {
    const workspace = await createWorkspace(userId, await readWorkspaceBody(request));
    return workspaceJson({ workspace }, 201);
  });
}
