"use client";

import { useState, type FormEvent } from "react";

type Role = "OWNER" | "ADMIN" | "AGENT";
type Workspace = { id: number; name: string; role: Role };
type Member = { userId: number; role: Role; user: { name: string; email: string } };

export default function WorkspaceManager({ workspace, members }: { workspace: Workspace | null; members: Member[] }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>, path: string, method: "POST" | "PATCH") {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setPending(true);
    setMessage("Saving...");
    setInvitationUrl("");
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not save changes.");
      if (result.invitation) {
        setInvitationUrl(result.invitation.url);
        setMessage("Invitation created. Share the private link with the invited person. It expires in 7 days; no email was sent.");
        setPending(false);
        return;
      }
      // Reload server data so the displayed memberships and permissions are fresh.
      const selectedId = result.workspace?.id ?? workspace?.id;
      window.location.assign(`/workspaces?workspace=${selectedId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reach the server.");
      setPending(false);
    }
  }

  return (
    <>
      <p role="status">{message}</p>
      {invitationUrl && <p><label htmlFor="invitation-link">Private invitation link </label><input id="invitation-link" value={invitationUrl} readOnly onFocus={(event) => event.target.select()} size={70} /></p>}
      <section aria-labelledby="create-workspace-heading">
        <h2 id="create-workspace-heading">Create a workspace</h2>
        <form onSubmit={(event) => void submit(event, "/api/workspaces", "POST")}>
          <label htmlFor="workspace-name">Name </label>
          <input id="workspace-name" name="name" required maxLength={100} disabled={pending} />{" "}
          <button disabled={pending}>Create workspace</button>
        </form>
        <p>You will be the owner of the new workspace.</p>
      </section>
      {workspace && (
        <section aria-labelledby="members-heading">
          <h2 id="members-heading">Members of {workspace.name}</h2>
          <p>Your role: {workspace.role}</p>
          <ul>
            {members.map((member) => (
              <li key={member.userId}>
                {member.user.name} ({member.user.email}) — {member.role}
                {workspace.role === "OWNER" && member.role !== "OWNER" && (
                  <form onSubmit={(event) => void submit(event, `/api/workspaces/${workspace.id}/members/${member.userId}`, "PATCH")}>
                    <label htmlFor={`role-${member.userId}`}>Role for {member.user.name} </label>
                    <select id={`role-${member.userId}`} name="role" defaultValue={member.role} disabled={pending}>
                      <option value="AGENT">Agent</option>
                      <option value="ADMIN">Admin</option>
                    </select>{" "}
                    <button disabled={pending}>Save role</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {workspace.role !== "AGENT" && (
            <>
              <h3>Invite a member</h3>
              <p>The recipient must accept before gaining access. They can use an existing account or create one.</p>
              <form onSubmit={(event) => void submit(event, `/api/workspaces/${workspace.id}/invitations`, "POST")}>
                <p><label htmlFor="member-email">Email </label>
                  <input id="member-email" name="email" type="email" required maxLength={254} disabled={pending} /></p>
                <p><label htmlFor="new-role">Role </label>
                  <select id="new-role" name="role" defaultValue="AGENT" disabled={pending}>
                    <option value="AGENT">Agent</option>
                    {workspace.role === "OWNER" && <option value="ADMIN">Admin</option>}
                  </select></p>
                <button disabled={pending}>Create invitation</button>
              </form>
              <h3>Invite a customer</h3>
              <p>Customers receive separate access to submit tickets, not staff membership. Share the private link yourself; no email is sent.</p>
              <form onSubmit={(event) => void submit(event, `/api/workspaces/${workspace.id}/customer-invitations`, "POST")}>
                <p><label htmlFor="customer-email">Customer email </label>
                  <input id="customer-email" name="email" type="email" required maxLength={254} disabled={pending} /></p>
                <button disabled={pending}>Create customer invitation</button>
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
}
