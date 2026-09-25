import { getCustomerTicket } from "../../../../../lib/customer-tickets";
import { parseWorkspaceId, workspaceJson, workspaceRequest } from "../../../../../lib/workspace-api";

export async function GET(request: Request, context: { params: Promise<{ ticketId: string }> }) {
  return workspaceRequest(request, async (userId) => {
    const ticketId = parseWorkspaceId((await context.params).ticketId);
    return workspaceJson({ ticket: await getCustomerTicket(userId, ticketId) });
  });
}
