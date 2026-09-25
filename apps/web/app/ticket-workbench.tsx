"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { priorities } from "../lib/ticket-workflow-options";

type Ticket = {
  id: number;
  subject: string;
  description: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  createdAt: string;
  priority: string;
  assignee: { id: number; name: string } | null;
};

type ApiError = { error?: { message?: string; fieldErrors?: Record<string, string> } };
type Member = { userId: number; user: { name: string } };
type Filters = { q: string; status: string; priority: string; assignee: string };
const emptyFilters: Filters = { q: "", status: "", priority: "", assignee: "" };
type Pagination = { page: number; pageSize: number; total: number; totalPages: number; capped: boolean };

export default function TicketWorkbench({ workspaces, workspaceId, members }: { workspaces: { id: number; name: string }[]; workspaceId?: number; members: Member[] }) {
  return (
    <section aria-label="Workspace tickets">
      <div className="toolbar">
      <label>
        Workspace
        <select value={workspaceId ?? ""} onChange={(event) => window.location.assign(`/?workspace=${encodeURIComponent(event.target.value)}`)}>
          {workspaceId === undefined && <option value="" disabled>Choose a workspace</option>}
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select>
      </label>
      <span className="muted">Switching workspaces clears the current draft.</span>
      </div>
      {/* Each workspace gets its own state, including in-flight requests and drafts. */}
      {workspaceId === undefined ? <p role="alert">This workspace is unavailable to you. Choose one of your workspaces above.</p> : <WorkspaceTickets key={workspaceId} workspaceId={workspaceId} members={members} />}
    </section>
  );
}

function WorkspaceTickets({ workspaceId, members }: { workspaceId: number; members: Member[] }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("Loading tickets...");
  const [loadError, setLoadError] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitError, setSubmitError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [draftFilters, setDraftFilters] = useState<Filters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 1, capped: false });
  const activeRequest = useRef<AbortController | null>(null);
  const hasFilters = Object.values(appliedFilters).some(Boolean);

  async function loadTickets(filters = appliedFilters, page = pagination.page) {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const signal = controller.signal;
    setIsLoading(true);
    setLoadError("");
    setMessage("Loading tickets...");
    setAppliedFilters(filters);
    try {
      const query = new URLSearchParams({ page: String(page) });
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
      const response = await fetch(`/api/workspaces/${workspaceId}/tickets?${query}`, { cache: "no-store", signal });
      if (signal.aborted) return;
      if (response.status === 401) {
        window.location.replace("/sign-in");
        return;
      }
      const data: unknown = await response.json();
      if (signal?.aborted) return;
      if (response.status === 403) throw new Error("You no longer have access to this workspace. Reload the page to update your workspace list.");
      if (!response.ok || typeof data !== "object" || data === null || !("tickets" in data) || !Array.isArray(data.tickets) || !("pagination" in data)) {
        throw new Error("Could not load tickets.");
      }
      setTickets(data.tickets as Ticket[]);
      const metadata = data.pagination as Pagination;
      setPagination(metadata);
      setMessage(`${metadata.total} matching ticket${metadata.total === 1 ? "" : "s"}. Showing ${data.tickets.length} on page ${metadata.page} of ${metadata.totalPages}.`);
    } catch (error) {
      if (signal?.aborted) return;
      setTickets([]);
      setLoadError(error instanceof Error ? error.message : "Could not load tickets. Please try again.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadTickets(emptyFilters, 1);
    return () => activeRequest.current?.abort();
  }, [workspaceId]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadTickets({ ...draftFilters, q: draftFilters.q.trim() }, 1);
  }

  function clearFilters() {
    setDraftFilters(emptyFilters);
    void loadTickets(emptyFilters, 1);
  }

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setSubmitError(false);
    setSubmitMessage("Creating ticket...");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, description }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 403) {
          setTickets([]);
          setLoadError("You no longer have access to this workspace. Reload the page to update your workspace list.");
        }
        if (response.status === 401) {
          window.location.replace("/sign-in");
          return;
        }
        const error = data as ApiError;
        setFieldErrors(error.error?.fieldErrors ?? {});
        throw new Error(error.error?.message ?? "Could not create the ticket.");
      }
      setSubject("");
      setDescription("");
      setSubmitMessage("Ticket created. It may be hidden by the current filters.");
      await loadTickets(appliedFilters, 1);
    } catch (error) {
      setSubmitError(true);
      setSubmitMessage(error instanceof Error ? error.message : "Could not create the ticket. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="inbox-grid">
      <section className="panel" aria-labelledby="tickets-heading" aria-busy={isLoading}>
      <div className="toolbar"><h2 id="tickets-heading">All tickets</h2><button type="button" onClick={() => void loadTickets()} disabled={isLoading || isSubmitting}>Refresh</button></div>
      <form onSubmit={applyFilters}>
        <fieldset className="ticket-filters" disabled={isLoading || isSubmitting}>
          <legend>Find tickets</legend>
          <label htmlFor="ticket-search">Search subject or description
            <input id="ticket-search" type="search" maxLength={100} value={draftFilters.q} onChange={(event) => setDraftFilters({ ...draftFilters, q: event.target.value })} />
          </label>
          <label htmlFor="filter-status">Status<select id="filter-status" value={draftFilters.status} onChange={(event) => setDraftFilters({ ...draftFilters, status: event.target.value })}>
            <option value="">All statuses</option>{["OPEN", "IN_PROGRESS", "RESOLVED"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select></label>
          <label htmlFor="filter-priority">Priority<select id="filter-priority" value={draftFilters.priority} onChange={(event) => setDraftFilters({ ...draftFilters, priority: event.target.value })}>
            <option value="">All priorities</option>{priorities.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label htmlFor="filter-assignee">Assignee<select id="filter-assignee" value={draftFilters.assignee} onChange={(event) => setDraftFilters({ ...draftFilters, assignee: event.target.value })}>
            <option value="">Anyone</option><option value="unassigned">Unassigned</option>
            {members.map((member) => <option key={member.userId} value={member.userId}>{member.user.name} (#{member.userId})</option>)}
          </select></label>
          <button>Apply filters</button><button type="button" onClick={clearFilters}>Clear filters</button>
        </fieldset>
      </form>
      {isLoading ? <p role="status">{message}</p> : (
        loadError ? <div role="alert"><h3>Tickets could not be loaded</h3><p className="error">{loadError}</p><button type="button" disabled={isSubmitting} onClick={() => void loadTickets()}>Try again</button></div> : <>
          <p role="status">{message}</p>
          {tickets.length === 0 ? <div className="empty-state"><h3>{hasFilters ? "No tickets match these filters." : "No tickets yet."}</h3>{hasFilters ? <button type="button" onClick={clearFilters} disabled={isSubmitting}>Clear filters</button> : <><p className="muted">Create the first ticket using the form to get started.</p><a href="#subject">Create your first ticket</a></>}</div> : (
            <ul className="ticket-list">
              {tickets.map((ticket) => <li key={ticket.id}><div className="ticket-title"><h3><Link href={`/workspaces/${workspaceId}/tickets/${ticket.id}`}>{ticket.subject}</Link></h3><TicketStatus status={ticket.status} /></div><p className="muted ticket-preview">{ticket.description}</p><p className="muted">Priority: {ticket.priority} · Assigned to: {ticket.assignee?.name ?? "Unassigned"}</p><small className="muted">#{ticket.id} · <time dateTime={ticket.createdAt}>{new Date(ticket.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} (UTC)</time></small></li>)}
            </ul>
          )}
          <nav className="toolbar" aria-label="Ticket pages">
            <button type="button" disabled={isSubmitting || pagination.page <= 1} onClick={() => void loadTickets(appliedFilters, pagination.page - 1)}>Previous</button>
            <span>Page {pagination.page} of {pagination.totalPages}</span>
            <button type="button" disabled={isSubmitting || pagination.page >= pagination.totalPages} onClick={() => void loadTickets(appliedFilters, pagination.page + 1)}>Next</button>
          </nav>
          {pagination.capped && <p role="status">Only the first 200,000 matches can be paged through. Refine the filters to narrow your results.</p>}
        </>
      )}
      </section>
      <section className="panel" aria-labelledby="create-heading">
      <h2 id="create-heading">Create a ticket</h2>
      <p className="muted">Log a customer issue in this workspace.</p>
      <form className="ticket-form" onSubmit={createTicket}>
        <p>
          <label htmlFor="subject">Subject</label><br />
          <input id="subject" name="subject" required maxLength={200} disabled={isSubmitting} value={subject} onChange={(event) => setSubject(event.target.value)} aria-invalid={!!fieldErrors.subject} aria-describedby={fieldErrors.subject ? "subject-error" : undefined} />
          {fieldErrors.subject && <span id="subject-error"> {fieldErrors.subject}</span>}
        </p>
        <p>
          <label htmlFor="description">Description</label><br />
          <textarea id="description" name="description" required maxLength={10000} disabled={isSubmitting} value={description} onChange={(event) => setDescription(event.target.value)} aria-invalid={!!fieldErrors.description} aria-describedby={fieldErrors.description ? "description-error" : undefined} />
          {fieldErrors.description && <span id="description-error"> {fieldErrors.description}</span>}
        </p>
        <p role={submitError ? "alert" : "status"} className={submitError ? "error" : undefined}>{submitMessage}</p>
        <button type="submit" disabled={isSubmitting || isLoading}>{isSubmitting ? "Creating..." : "Create ticket"}</button>
      </form>
      </section>
    </div>
  );
}

function TicketStatus({ status }: { status: Ticket["status"] }) {
  const labels = { OPEN: "Open", IN_PROGRESS: "In progress", RESOLVED: "Resolved" };
  return <span className={`badge ${status}`}>{labels[status]}</span>;
}
