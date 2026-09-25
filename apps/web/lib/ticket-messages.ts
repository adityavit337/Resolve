import "server-only";
import { getDb } from "./db.ts";
import { requireMember } from "./workspaces.ts";
import { WorkspaceError } from "./workspace-api.ts";

const messageSelection = {
  id: true, kind: true, body: true, createdAt: true,
  author: { select: { id: true, name: true } },
} as const;

// Staff-only: includes internal notes. Never reuse as a customer-facing reader.
export async function getTicketDetail(workspaceId: number, ticketId: number, userId: number) {
  return getDb().$transaction(async (tx) => {
    await requireMember(tx, workspaceId, userId);
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, workspaceId },
      select: {
        id: true, subject: true, description: true, status: true, createdAt: true,
        priority: true, assigneeId: true, version: true,
        assignee: { select: { id: true, name: true } },
        changes: { orderBy: [{ version: "asc" }, { id: "asc" }], select: {
          id: true, version: true, field: true, before: true, after: true, createdAt: true,
          actor: { select: { id: true, name: true } },
        } },
        messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: messageSelection },
      },
    });
    if (!ticket) throw new WorkspaceError(404, "NOT_FOUND", "Ticket not found in this workspace.");
    return ticket;
  }, { isolationLevel: "Serializable" });
}

export async function createTicketMessage(workspaceId: number, ticketId: number, userId: number, input: Record<string, unknown>) {
  const kind = input.kind;
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if ((kind !== "PUBLIC_REPLY" && kind !== "INTERNAL_NOTE") || !body || body.length > 10000) {
    throw new WorkspaceError(400, "VALIDATION_ERROR", "Choose a message type and enter 1-10,000 characters.");
  }
  return getDb().$transaction(async (tx) => {
    await requireMember(tx, workspaceId, userId);
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId, workspaceId }, select: { id: true } });
    if (!ticket) throw new WorkspaceError(404, "NOT_FOUND", "Ticket not found in this workspace.");
    // Author comes from the session; ticket comes from the validated URL pair.
    return tx.ticketMessage.create({ data: { ticketId: ticket.id, authorId: userId, kind, body }, select: messageSelection });
  }, { isolationLevel: "Serializable" });
}
