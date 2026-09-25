import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSession } from "../../../../../lib/auth";
import { getTicketDetail } from "../../../../../lib/ticket-messages";
import { isLocalDevelopmentDatabase } from "../../../../../lib/tickets";
import { parseWorkspaceId, WorkspaceError } from "../../../../../lib/workspace-api";
import AppShell from "../../../../app-shell";
import TicketConversation from "./ticket-conversation";
import TicketWorkflow from "./ticket-workflow";
import { listMembers } from "../../../../../lib/workspaces";

export default async function TicketPage({ params }: { params: Promise<{ workspaceId: string; ticketId: string }> }) {
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in");
  if (!isLocalDevelopmentDatabase()) notFound();
  const values = await params;
  let workspaceId: number;
  let ticket;
  let members;
  try {
    workspaceId = parseWorkspaceId(values.workspaceId);
    ticket = await getTicketDetail(workspaceId, parseWorkspaceId(values.ticketId), Number(session.user.id));
    members = await listMembers(workspaceId, Number(session.user.id));
  } catch (error) {
    if (error instanceof WorkspaceError && [400, 403, 404].includes(error.status)) notFound();
    throw error;
  }
  return <AppShell user={session.user} section="inbox" workspaceId={workspaceId}>
    <Link href={`/?workspace=${workspaceId}`}>Back to tickets</Link>
    <TicketConversation key={`${workspaceId}:${ticket.id}`} workspaceId={workspaceId} initialTicket={{
      ...ticket, createdAt: ticket.createdAt.toISOString(),
      messages: ticket.messages.map((message) => ({ ...message, createdAt: message.createdAt.toISOString() })),
    }} />
    <TicketWorkflow workspaceId={workspaceId} members={members} ticket={{
      ...ticket, changes: ticket.changes.map((change) => ({ ...change, createdAt: change.createdAt.toISOString() })),
    }} />
  </AppShell>;
}
