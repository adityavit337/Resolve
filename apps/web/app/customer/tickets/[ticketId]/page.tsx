import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../../lib/auth";
import { getCustomerTicket } from "../../../../lib/customer-tickets";
import { parseWorkspaceId, WorkspaceError } from "../../../../lib/workspace-api";

export default async function CustomerTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in?next=%2Fcustomer");
  let ticket;
  try {
    ticket = await getCustomerTicket(Number(session.user.id), parseWorkspaceId((await params).ticketId));
  } catch (error) {
    if (error instanceof WorkspaceError && (error.status === 400 || error.status === 404)) notFound();
    throw error;
  }
  return <main className="app-content">
    <Link href="/customer">Back to your tickets</Link>
    <h1>#{ticket.id}: {ticket.subject}</h1>
    <p>{ticket.workspace.name} · {ticket.status.replaceAll("_", " ")}</p>
    <p>Submitted <time dateTime={ticket.createdAt.toISOString()}>{ticket.createdAt.toISOString()}</time></p>
    <section className="panel"><h2>Your request</h2><p style={{ whiteSpace: "pre-wrap" }}>{ticket.description}</p></section>
    <section className="panel"><h2>Public replies</h2>
      <p><a href={`/customer/tickets/${ticket.id}`}>Refresh replies</a></p>
      {ticket.messages.length ? ticket.messages.map((message) => <article key={message.id}>
        <p>Support team · <time dateTime={message.createdAt.toISOString()}>{message.createdAt.toISOString()}</time></p>
        <p style={{ whiteSpace: "pre-wrap" }}>{message.body}</p>
      </article>) : <p>No replies yet.</p>}
    </section>
  </main>;
}
