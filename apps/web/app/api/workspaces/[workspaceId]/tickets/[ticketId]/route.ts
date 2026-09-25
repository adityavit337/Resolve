import { getTicketDetail } from "../../../../../../lib/ticket-messages";
import { updateTicketWorkflow } from "../../../../../../lib/ticket-workflow";
import { readWorkspaceBody } from "../../../../../../lib/workspace-api";
import { parseWorkspaceId, workspaceJson, workspaceRequest } from "../../../../../../lib/workspace-api";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; ticketId: string }> }) {
  return workspaceRequest(request, async (userId) => {
    const params = await context.params;
    return workspaceJson({ ticket: await getTicketDetail(parseWorkspaceId(params.workspaceId), parseWorkspaceId(params.ticketId), userId) });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ workspaceId: string; ticketId: string }> }) {
  return workspaceRequest(request, async (userId) => {
    const params = await context.params;
    return workspaceJson(await updateTicketWorkflow(parseWorkspaceId(params.workspaceId), parseWorkspaceId(params.ticketId), userId, await readWorkspaceBody(request)));
  });
}
