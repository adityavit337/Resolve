import "server-only";
import { getDb } from "./db.ts";
import { isLocalDevelopmentDatabase } from "./tickets.ts";
import { WorkspaceError } from "./workspace-api.ts";

// Shared by customer pages and APIs. Never reuse the staff conversation reader.
function customerScope(userId: number) {
  if (!isLocalDevelopmentDatabase()) throw new WorkspaceError(404, "NOT_FOUND", "This local endpoint is unavailable.");
  return { customerId: userId, workspace: { customerAccesses: { some: { userId } } } };
}

export async function listCustomerTickets(userId: number) {
  return getDb().ticket.findMany({
    where: customerScope(userId),
    select: { id: true, subject: true, status: true, createdAt: true, workspace: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getCustomerTicket(userId: number, ticketId: number) {
  return getDb().$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, ...customerScope(userId) },
      select: {
        id: true, subject: true, description: true, status: true, createdAt: true,
        workspace: { select: { name: true } },
        messages: {
          where: { kind: "PUBLIC_REPLY" },
          select: { id: true, body: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!ticket) throw new WorkspaceError(404, "NOT_FOUND", "Ticket not found.");
    return ticket;
  }, { isolationLevel: "Serializable" });
}
