import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { listCustomerWorkspaces } from "../../lib/customer-intake";
import { isLocalDevelopmentDatabase } from "../../lib/tickets";
import SignOutButton from "../sign-out-button";
import CustomerTicketForm from "./ticket-form";
import { listCustomerTickets } from "../../lib/customer-tickets";

export default async function CustomerPage() {
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in?next=%2Fcustomer");
  const workspaces = isLocalDevelopmentDatabase() ? await listCustomerWorkspaces(Number(session.user.id)) : [];
  const tickets = isLocalDevelopmentDatabase() ? await listCustomerTickets(Number(session.user.id)) : [];
  return <main className="app-content">
    <h1>Customer portal</h1>
    <p>Signed in as {session.user.email}</p>
    <SignOutButton />
    {workspaces.length ? <CustomerTicketForm workspaces={workspaces} /> : <p>You do not have customer access yet. Ask a workspace owner or admin for a customer invitation.</p>}
    <section className="panel">
      <h2>Your tickets</h2>
      <p><a href="/customer">Refresh tickets</a></p>
      {tickets.length ? <ul>{tickets.map((ticket) => <li key={ticket.id}>
        <Link href={`/customer/tickets/${ticket.id}`}>#{ticket.id}: {ticket.subject}</Link>
        <p>{ticket.workspace.name} · {ticket.status.replaceAll("_", " ")} · {ticket.createdAt.toISOString()}</p>
      </li>)}</ul> : <p>No tickets to show yet.</p>}
    </section>
    <p><Link href="/">Staff inbox</Link></p>
  </main>;
}
