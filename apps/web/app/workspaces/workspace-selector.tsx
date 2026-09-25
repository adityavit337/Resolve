"use client";

export default function WorkspaceSelector({ workspaces, selectedId }: {
  workspaces: { id: number; name: string; role: string }[];
  selectedId?: number;
}) {
  return <label htmlFor="workspace">Your workspaces <select id="workspace" value={selectedId ?? ""}
    onChange={(event) => window.location.assign(`/workspaces?workspace=${encodeURIComponent(event.target.value)}`)}>
    {selectedId === undefined && <option value="" disabled>Choose a workspace</option>}
    {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} ({workspace.role})</option>)}
  </select></label>;
}
