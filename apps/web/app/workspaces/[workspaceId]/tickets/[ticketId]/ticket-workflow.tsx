"use client";

import { useState, type FormEvent } from "react";
import { priorities, statusTransitions, type WorkflowPriority, type WorkflowStatus } from "../../../../../lib/ticket-workflow-options";

type Change = { id: number; field: string; before: string | null; after: string | null; createdAt: string; actor: { name: string } };
type Workflow = { id: number; status: WorkflowStatus; priority: WorkflowPriority; assigneeId: number | null; version: number; assignee: { name: string } | null; changes: Change[] };

export default function TicketWorkflow({ workspaceId, ticket, members }: {
  workspaceId: number; ticket: Workflow; members: { userId: number; user: { name: string } }[];
}) {
  const [status, setStatus] = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [assignee, setAssignee] = useState(ticket.assigneeId === null ? "" : String(ticket.assigneeId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const missingAssignee = ticket.assigneeId !== null && !members.some((member) => member.userId === ticket.assigneeId);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || needsReload) return;
    setPending(true);
    setError("");
    try {
      const assigneeId = assignee === "" ? null : Number(assignee);
      const response = await fetch(`/api/workspaces/${workspaceId}/tickets/${ticket.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: ticket.version, status, priority,
          ...(assigneeId !== ticket.assigneeId ? { assigneeId } : {}),
        }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const result = await response.json();
      if (!response.ok) {
        if ([403, 404, 409].includes(response.status)) setNeedsReload(true);
        throw new Error(result.error?.message ?? "Could not save changes.");
      }
      window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save changes.");
    } finally { setPending(false); }
  }

  return <>
    <section className="panel conversation" aria-labelledby="workflow-heading">
      <h2 id="workflow-heading">Ticket workflow</h2>
      <p className="muted">Saving reloads the page. Finish any reply or note draft before saving workflow changes.</p>
      <form onSubmit={save}>
        <fieldset disabled={pending || needsReload} className="workflow-fields">
          <legend>Assignment, priority and status</legend>
          <label htmlFor="assignee">Assigned to <select id="assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">Unassigned</option>
            {missingAssignee && <option value={String(ticket.assigneeId)} disabled>{ticket.assignee?.name} (no longer a member)</option>}
            {members.map((member) => <option value={member.userId} key={member.userId}>{member.user.name} (#{member.userId})</option>)}
          </select></label>
          <label htmlFor="priority">Priority <select id="priority" value={priority} onChange={(event) => setPriority(event.target.value as WorkflowPriority)}>
            {priorities.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label htmlFor="ticket-status">Status <select id="ticket-status" value={status} onChange={(event) => setStatus(event.target.value as WorkflowStatus)}>
            {[ticket.status, ...statusTransitions[ticket.status]].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select></label>
          <button disabled={pending || needsReload}>{pending ? "Saving..." : "Save workflow"}</button>
        </fieldset>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {error && <button type="button" onClick={() => window.location.reload()}>Reload latest ticket</button>}
    </section>
    <section className="panel conversation" aria-labelledby="history-heading">
      <h2 id="history-heading">Change history</h2>
      {ticket.changes.length === 0 ? <p>No workflow changes recorded yet.</p> : <ol className="ticket-list">
        {ticket.changes.map((change) => <li key={change.id}>
          <strong>{change.actor.name}</strong> changed {change.field.toLowerCase()}: {change.before ?? "Unassigned"} → {change.after ?? "Unassigned"}
          <br /><time className="muted" dateTime={change.createdAt}>{new Date(change.createdAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</time>
        </li>)}
      </ol>}
    </section>
  </>;
}
