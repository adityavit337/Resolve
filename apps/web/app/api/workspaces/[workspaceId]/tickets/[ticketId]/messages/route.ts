import { createTicketMessage } from "../../../../../../../lib/ticket-messages";
import { parseWorkspaceId, readWorkspaceBody, workspaceJson, workspaceRequest } from "../../../../../../../lib/workspace-api";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; ticketId: string }> }) {
  return workspaceRequest(request, async (userId) => {
    const params = await context.params;
    return workspaceJson({ message: await createTicketMessage(parseWorkspaceId(params.workspaceId), parseWorkspaceId(params.ticketId), userId, await readWorkspaceBody(request)) }, 201);
  });
}
