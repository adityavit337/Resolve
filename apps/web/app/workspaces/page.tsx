import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { isLocalDevelopmentDatabase } from "../../lib/tickets";
import { listMembers, listWorkspaces } from "../../lib/workspaces";
import WorkspaceManager from "./workspace-manager";
import AppShell from "../app-shell";
import WorkspaceSelector from "./workspace-selector";

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ workspace?: string | string[] }> }) {
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in");
  if (!isLocalDevelopmentDatabase()) return <main><h1>Workspaces</h1><p>Workspace management is not available here yet.</p></main>;

  const workspaces = await listWorkspaces(Number(session.user.id));
  const requestedId = (await searchParams).workspace;
  const selected = requestedId === undefined ? workspaces[0] : workspaces.find((workspace) => String(workspace.id) === requestedId);
  const members = selected ? await listMembers(selected.id, Number(session.user.id)) : [];

  return (
    <AppShell user={session.user} section="workspaces" workspaceId={selected?.id}>
      <h1>Workspaces</h1>
      <p><Link href={selected ? `/?workspace=${selected.id}` : "/"}>Back to tickets</Link></p>
      {workspaces.length ? (
        <WorkspaceSelector workspaces={workspaces} selectedId={selected?.id} />
      ) : <p>You have no workspaces yet. Create one below to become its owner.</p>}
      {requestedId !== undefined && !selected && <p>This workspace is unavailable to you.</p>}
      <WorkspaceManager key={selected?.id ?? "unavailable"} workspace={selected ?? null} members={members} />
    </AppShell>
  );
}
