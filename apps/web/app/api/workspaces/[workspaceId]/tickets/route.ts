import { createTicket, listTickets } from "../../../../../lib/ticket-access";
import { validateTicketInput } from "../../../../../lib/tickets";
import { parseTicketListQuery } from "../../../../../lib/ticket-list-query";
import { parseWorkspaceId, readWorkspaceBody, workspaceJson, workspaceRequest } from "../../../../../lib/workspace-api";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: Context) {
  return workspaceRequest(request, async (userId) => {
    const workspaceId = parseWorkspaceId((await context.params).workspaceId);
    return workspaceJson(await listTickets(workspaceId, userId, parseTicketListQuery(new URL(request.url).searchParams)));
  });
}

export async function POST(request: Request, context: Context) {
  return workspaceRequest(request, async (userId) => {
    const workspaceId = parseWorkspaceId((await context.params).workspaceId);
    const result = validateTicketInput(await readWorkspaceBody(request));
    if (!result.success) {
      return workspaceJson({ error: {
        code: "VALIDATION_ERROR", message: "Check the ticket fields.", fieldErrors: result.fieldErrors,
      } }, 400);
    }
    return workspaceJson({ ticket: await createTicket(workspaceId, userId, result.data) }, 201);
  });
}
