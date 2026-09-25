import "server-only";
import { getDb } from "./db.ts";
import { requireMember } from "./workspaces.ts";
import { WorkspaceError } from "./workspace-api.ts";
import { priorities, statusTransitions, type WorkflowPriority, type WorkflowStatus } from "./ticket-workflow-options.ts";

const conflict = () => new WorkspaceError(409, "STALE_TICKET", "This ticket changed. Reload before saving again.");
const invalid = () => new WorkspaceError(400, "VALIDATION_ERROR", "Send a version and valid status, priority, or assigneeId.");

export async function updateTicketWorkflow(workspaceId: number, ticketId: number, userId: number, input: Record<string, unknown>) {
  if (Object.keys(input).some((key) => !["version", "status", "priority", "assigneeId"].includes(key))) throw invalid();
  if (!Number.isInteger(input.version) || (input.version as number) < 0 || (input.version as number) >= 2147483647) throw invalid();
  if (!["status", "priority", "assigneeId"].some((key) => key in input)) throw invalid();
  if ("status" in input && !["OPEN", "IN_PROGRESS", "RESOLVED"].includes(input.status as string)) throw invalid();
  if ("priority" in input && !(priorities as readonly unknown[]).includes(input.priority)) throw invalid();
  if ("assigneeId" in input && input.assigneeId !== null &&
    (typeof input.assigneeId !== "number" || !Number.isInteger(input.assigneeId) || input.assigneeId === 0 || input.assigneeId < -2147483648 || input.assigneeId > 2147483647)) throw invalid();

  return getDb().$transaction(async (tx) => {
    await requireMember(tx, workspaceId, userId);
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId, workspaceId }, include: { assignee: { select: { id: true, name: true } } } });
    if (!ticket) throw new WorkspaceError(404, "NOT_FOUND", "Ticket not found in this workspace.");
    if (ticket.version !== input.version) throw conflict();
    const status = (input.status ?? ticket.status) as WorkflowStatus;
    const priority = (input.priority ?? ticket.priority) as WorkflowPriority;
    const assigneeId = "assigneeId" in input ? input.assigneeId as number | null : ticket.assigneeId;
    if (status !== ticket.status && !(statusTransitions[ticket.status] as readonly string[]).includes(status)) {
      throw new WorkspaceError(400, "INVALID_TRANSITION", `Cannot change ${ticket.status} directly to ${status}.`);
    }
    let assignee = ticket.assignee;
    // Validate every explicit assignment, even if a stale former member is selected.
    if ("assigneeId" in input && assigneeId !== null) {
      const member = await tx.membership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: assigneeId } },
        select: { user: { select: { id: true, name: true } } },
      });
      if (!member) throw new WorkspaceError(400, "INVALID_ASSIGNEE", "Choose a current member of this workspace.");
      assignee = member.user;
    } else if (assigneeId === null) assignee = null;

    const label = (user: { id: number; name: string } | null) => user ? `${user.name} (#${user.id})` : null;
    const changes: { field: "STATUS" | "PRIORITY" | "ASSIGNEE"; before: string | null; after: string | null }[] = [];
    if (status !== ticket.status) changes.push({ field: "STATUS", before: ticket.status, after: status });
    if (priority !== ticket.priority) changes.push({ field: "PRIORITY", before: ticket.priority, after: priority });
    if (assigneeId !== ticket.assigneeId) changes.push({ field: "ASSIGNEE", before: label(ticket.assignee), after: label(assignee) });
    if (changes.length === 0) return { changed: false, version: ticket.version };

    const updated = await tx.ticket.updateMany({
      where: { id: ticketId, workspaceId, version: ticket.version },
      data: { status, priority, assigneeId, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw conflict();
    await tx.ticketChange.createMany({ data: changes.map((change) => ({ ...change, ticketId, actorId: userId, version: ticket.version + 1 })) });
    return { changed: true, version: ticket.version + 1 };
  }, { isolationLevel: "Serializable" });
}
