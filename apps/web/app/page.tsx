import HealthCheck from "./health-check";
import TicketWorkbench from "./ticket-workbench";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { listMembers, listWorkspaces } from "../lib/workspaces";
import { isLocalDevelopmentDatabase } from "../lib/tickets";
import AppShell from "./app-shell";
import Link from "next/link";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ workspace?: string | string[] }> }) {
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in");
  const workspaces = isLocalDevelopmentDatabase() ? await listWorkspaces(Number(session.user.id)) : [];
  const requestedId = (await searchParams).workspace;
  const selected = requestedId === undefined ? workspaces[0] : workspaces.find((workspace) => String(workspace.id) === requestedId);
  const members = selected ? await listMembers(selected.id, Number(session.user.id)) : [];
  return (
    <AppShell user={session.user} section="inbox" workspaceId={selected?.id}>
      <h1>Ticket inbox</h1>
      <p className="muted">Your team's customer conversations, in one place.</p>
      {workspaces.length > 0
        ? <TicketWorkbench workspaces={workspaces} workspaceId={selected?.id} members={members} />
        : <section className="panel empty-state"><h2>No staff ticket workspaces are available.</h2><p>If you are a customer, use the customer portal. Staff can create a workspace or accept a staff invitation.</p><p><Link href="/customer">Customer portal</Link></p><Link href="/workspaces">Manage workspaces and members</Link></section>}
      <details className="diagnostics"><summary>Development connection check</summary><HealthCheck /></details>
    </AppShell>
  );
}
