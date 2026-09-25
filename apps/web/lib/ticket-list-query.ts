import "server-only";
import { parseWorkspaceId, WorkspaceError } from "./workspace-api.ts";
import { priorities, type WorkflowPriority, type WorkflowStatus } from "./ticket-workflow-options.ts";

export const ticketPageSize = 20;
export const maxTicketPage = 10000;
export type TicketListQuery = { page: number; q: string; status?: WorkflowStatus; priority?: WorkflowPriority; assigneeId?: number | null };

export function parseTicketListQuery(params: URLSearchParams): TicketListQuery {
  const invalid = () => new WorkspaceError(400, "VALIDATION_ERROR", "Invalid ticket filters. Use page 1-10000, a search of up to 100 characters, and valid filter values.");
  for (const key of params.keys()) {
    if (!["page", "q", "status", "priority", "assignee"].includes(key) || params.getAll(key).length !== 1) throw invalid();
  }
  const page = params.get("page") ?? "1";
  const q = (params.get("q") ?? "").trim();
  const status = params.get("status");
  const priority = params.get("priority");
  const assignee = params.get("assignee");
  if (!/^[1-9]\d*$/.test(page) || Number(page) > maxTicketPage || q.length > 100) throw invalid();
  if (status !== null && !["OPEN", "IN_PROGRESS", "RESOLVED"].includes(status)) throw invalid();
  if (priority !== null && !(priorities as readonly string[]).includes(priority)) throw invalid();
  return {
    page: Number(page), q,
    ...(status !== null ? { status: status as WorkflowStatus } : {}),
    ...(priority !== null ? { priority: priority as WorkflowPriority } : {}),
    ...(assignee !== null ? { assigneeId: assignee === "unassigned" ? null : parseWorkspaceId(assignee) } : {}),
  };
}
