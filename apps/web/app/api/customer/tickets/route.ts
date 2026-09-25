import { submitCustomerTicket } from "../../../../lib/customer-intake";
import { listCustomerTickets } from "../../../../lib/customer-tickets";
import { validateTicketInput } from "../../../../lib/tickets";
import { parseWorkspaceId, readWorkspaceBody, workspaceJson, workspaceRequest } from "../../../../lib/workspace-api";

export async function GET(request: Request) {
  return workspaceRequest(request, async (userId) => workspaceJson({ tickets: await listCustomerTickets(userId) }));
}

export async function POST(request: Request) {
  return workspaceRequest(request, async (userId) => {
    const body = await readWorkspaceBody(request);
    const workspaceId = parseWorkspaceId(String(body.workspaceId));
    const input = validateTicketInput(body);
    if (!input.success) return workspaceJson({ error: {
      code: "VALIDATION_ERROR", message: "Check the ticket fields.", fieldErrors: input.fieldErrors,
    } }, 400);
    return workspaceJson({ ticket: await submitCustomerTicket(workspaceId, userId, input.data) }, 201);
  });
}
