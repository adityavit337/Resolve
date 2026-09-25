import type { ReactNode } from "react";
import Link from "next/link";
import SignOutButton from "./sign-out-button";

export default function AppShell({ children, user, section, workspaceId }: {
  children: ReactNode;
  user: { name: string; email: string };
  section: "inbox" | "workspaces" | "articles";
  workspaceId?: number;
}) {
  const query = workspaceId === undefined ? "" : `?workspace=${workspaceId}`;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <Link className="brand" href={`/${query}`}>Resolve<span>Support, together.</span></Link>
      <nav aria-label="Main navigation">
        <Link href={`/${query}`} aria-current={section === "inbox" ? "page" : undefined}>Ticket inbox</Link>
        <Link href={`/articles${query}`} aria-current={section === "articles" ? "page" : undefined}>Help articles</Link>
        <Link href={`/workspaces${query}`} aria-current={section === "workspaces" ? "page" : undefined}>Workspaces & members</Link>
      </nav>
      <div className="account"><strong>{user.name}</strong><p>{user.email}</p><SignOutButton /></div>
    </aside>
    <main id="main-content" className="app-content" tabIndex={-1}>{children}</main>
  </div>;
}
