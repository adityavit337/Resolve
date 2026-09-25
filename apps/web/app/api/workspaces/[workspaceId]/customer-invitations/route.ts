import { createCustomerInvitation } from "../../../../../lib/customer-intake";
import { parseWorkspaceId, readWorkspaceBody, workspaceJson, workspaceRequest } from "../../../../../lib/workspace-api";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return workspaceRequest(request, async (userId) => {
    const workspaceId = parseWorkspaceId((await context.params).workspaceId);
    return workspaceJson({ invitation: await createCustomerInvitation(workspaceId, userId, await readWorkspaceBody(request)) }, 201);
  });
}
