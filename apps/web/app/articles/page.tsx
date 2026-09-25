import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { listWorkspaces } from "../../lib/workspaces";
import { isLocalDevelopmentDatabase } from "../../lib/tickets";
import AppShell from "../app-shell";
import ArticleManager from "./article-manager";

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ workspace?: string | string[] }> }) {
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in");
  const workspaces = isLocalDevelopmentDatabase() ? await listWorkspaces(Number(session.user.id)) : [];
  const requested = (await searchParams).workspace;
  const selected = requested === undefined ? workspaces[0] : workspaces.find((workspace) => String(workspace.id) === requested);
  return <AppShell user={session.user} section="articles" workspaceId={selected?.id}>
    <h1>Help articles</h1>
    <p>Prepare and publish guidance for your support team. All workspace staff can maintain articles.</p>
    <nav aria-label="Article workspaces">
      {workspaces.map((workspace) => <p key={workspace.id}><Link href={`/articles?workspace=${workspace.id}`} aria-current={selected?.id === workspace.id ? "page" : undefined}>{workspace.name}</Link></p>)}
    </nav>
    {selected ? <><h2>{selected.name}</h2><ArticleManager key={selected.id} workspaceId={selected.id} /></> : <p>This workspace is unavailable to you. Select a workspace where you are a staff member.</p>}
  </AppShell>;
}
