"use client";

import { useState, type FormEvent } from "react";

type Message = { id: number; kind: "PUBLIC_REPLY" | "INTERNAL_NOTE"; body: string; createdAt: string; author: { id: number; name: string } };
type Ticket = { id: number; subject: string; description: string; status: string; createdAt: string; messages: Message[] };
const labels = { PUBLIC_REPLY: "Public reply", INTERNAL_NOTE: "Internal note" };

export default function TicketConversation({ workspaceId, initialTicket }: { workspaceId: number; initialTicket: Ticket }) {
  const [messages, setMessages] = useState(initialTicket.messages);
  const [kind, setKind] = useState<Message["kind"]>("INTERNAL_NOTE");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFeedback("");
    setFailed(false);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/tickets/${initialTicket.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, body }),
      });
      if (response.status === 401) { setBlocked(true); window.location.replace("/sign-in"); return; }
      if ([403, 404].includes(response.status)) setBlocked(true);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not save the message.");
      setMessages((current) => [...current, result.message]);
      setBody("");
      setFeedback(`${labels[kind]} saved. No notification was sent.`);
    } catch (error) {
      setFailed(true);
      setFeedback(error instanceof Error ? error.message : "Could not save. Refresh to check whether it saved before retrying.");
    } finally { setPending(false); }
  }

  if (blocked) return <p role="alert">This ticket is no longer available to you. Return to the inbox to update your workspace list.</p>;
  return <>
    <h1>{initialTicket.subject}</h1>
    <p className="muted">Ticket #{initialTicket.id} · {initialTicket.status.replaceAll("_", " ")}</p>
    <section className="panel"><h2>Original request</h2><p className="message-body">{initialTicket.description}</p><Timestamp value={initialTicket.createdAt} /></section>
    <section className="panel conversation" aria-labelledby="conversation-heading">
      <div className="toolbar"><h2 id="conversation-heading">Conversation</h2><button disabled={pending} onClick={() => window.location.reload()}>Refresh conversation</button></div>
      {messages.length === 0 ? <p>No replies or notes yet.</p> : <ol className="ticket-list">
        {messages.map((message) => <li key={message.id} className={message.kind === "INTERNAL_NOTE" ? "internal-note" : "public-reply"}>
          <strong>{labels[message.kind]}</strong> · {message.author.name}
          <p className="message-body">{message.body}</p><Timestamp value={message.createdAt} />
        </li>)}
      </ol>}
    </section>
    <section className="panel conversation"><h2>Add to conversation</h2>
      <form className="ticket-form" onSubmit={submit}>
        <label htmlFor="message-kind">Message type </label>
        <select id="message-kind" value={kind} disabled={pending} onChange={(event) => setKind(event.target.value as Message["kind"])}>
          <option value="INTERNAL_NOTE">Internal note — staff only</option>
          <option value="PUBLIC_REPLY">Public reply — customer-facing</option>
        </select>
        <p id="visibility-help">{kind === "INTERNAL_NOTE" ? "For workspace staff only. Never intended for customers." : "Visible to the ticket's customer in their portal while they have company access. No email notification is sent."}</p>
        <label htmlFor="message-body">{labels[kind]}</label>
        <textarea id="message-body" required maxLength={10000} value={body} onChange={(event) => setBody(event.target.value)} disabled={pending} aria-describedby="visibility-help" />
        <p role={failed ? "alert" : "status"} className={failed ? "error" : undefined}>{feedback}</p>
        <button disabled={pending}>{pending ? "Saving..." : `Save ${labels[kind].toLowerCase()}`}</button>
      </form>
    </section>
  </>;
}

function Timestamp({ value }: { value: string }) {
  return <time className="muted" dateTime={value}>{new Date(value).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</time>;
}
