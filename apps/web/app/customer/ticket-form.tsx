"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function CustomerTicketForm({ workspaces }: { workspaces: { id: number; name: string }[] }) {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState(String(workspaces[0].id));
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("Submitting ticket...");
    setFailed(false);
    try {
      const response = await fetch("/api/customer/tickets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: Number(workspaceId), subject, description }),
      });
      if (response.status === 401) { window.location.replace("/sign-in?next=%2Fcustomer"); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not submit the ticket.");
      setSubject("");
      setDescription("");
      setMessage(`Ticket #${result.ticket.id} submitted. You can open it under Your tickets.`);
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Could not reach the server.");
    } finally { setPending(false); }
  }

  return <section className="panel"><h2>New support ticket</h2>
    <form className="ticket-form" onSubmit={submit}>
      <p><label htmlFor="customer-workspace">Company</label><br />
        <select id="customer-workspace" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={pending}>
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select></p>
      <p><label htmlFor="customer-subject">Subject</label><br />
        <input id="customer-subject" required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} disabled={pending} /></p>
      <p><label htmlFor="customer-description">Description</label><br />
        <textarea id="customer-description" required maxLength={10000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={pending} /></p>
      <p role={failed ? "alert" : "status"}>{message}</p>
      <button disabled={pending}>{pending ? "Submitting..." : "Submit ticket"}</button>
    </form>
  </section>;
}
