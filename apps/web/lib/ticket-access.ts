import "server-only";
import { getDb } from "./db.ts";
import { requireMember } from "./workspaces.ts";
import type { TicketInput } from "./tickets.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { ticketPageSize, maxTicketPage, type TicketListQuery } from "./ticket-list-query.ts";

const ticketSelection = {
  id: true, subject: true, description: true, status: true, createdAt: true,
  priority: true, assignee: { select: { id: true, name: true } },
} as const;

// All three staff roles may list/create tickets in their own workspaces.
// The check and operation share a transaction to coordinate membership changes.
export async function listTickets(workspaceId: number, userId: number, query: TicketListQuery) {
  return getDb().$transaction(async (tx) => {
    await requireMember(tx, workspaceId, userId);
    // contains uses LIKE: escape wildcard characters to make search literal.
    const term = query.q.replace(/[\\%_]/g, (character) => `\\${character}`);
    const where: Prisma.TicketWhereInput = {
      workspaceId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assigneeId !== undefined ? { assigneeId: query.assigneeId } : {}),
      ...(term ? { OR: [{ subject: { contains: term } }, { description: { contains: term } }] } : {}),
    };
    // Count and page use the same tenant-scoped predicate and transaction.
    const total = await tx.ticket.count({ where });
    const totalPages = Math.min(maxTicketPage, Math.max(1, Math.ceil(total / ticketPageSize)));
    const page = Math.min(query.page, totalPages);
    const tickets = await tx.ticket.findMany({
      where, take: ticketPageSize, skip: (page - 1) * ticketPageSize,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: ticketSelection,
    });
    return { tickets, pagination: { page, pageSize: ticketPageSize, total, totalPages, capped: total > maxTicketPage * ticketPageSize } };
  }, { isolationLevel: "Serializable" });
}

export async function createTicket(workspaceId: number, userId: number, input: TicketInput) {
  return getDb().$transaction(async (tx) => {
    await requireMember(tx, workspaceId, userId);
    return tx.ticket.create({
      // Neither ownership nor status comes from extra request-body properties.
      data: { workspaceId, subject: input.subject, description: input.description },
      select: ticketSelection,
    });
  }, { isolationLevel: "Serializable" });
}
