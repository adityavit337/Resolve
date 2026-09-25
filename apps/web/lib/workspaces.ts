import "server-only";
import type { Prisma } from "../generated/prisma/client.ts";
import { getDb } from "./db.ts";
import { WorkspaceError } from "./workspace-api.ts";

const memberSelection = {
  userId: true,
  role: true,
  user: { select: { name: true, email: true } },
} as const;

export async function requireMember(tx: Prisma.TransactionClient, workspaceId: number, userId: number) {
  const member = await tx.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!member) throw new WorkspaceError(403, "FORBIDDEN", "You do not have access to this workspace.");
  return member;
}

function editableRole(value: unknown): "ADMIN" | "AGENT" {
  if (value !== "ADMIN" && value !== "AGENT") {
    throw new WorkspaceError(400, "VALIDATION_ERROR", "Choose ADMIN or AGENT. Ownership cannot be assigned here.");
  }
  return value;
}

export async function listWorkspaces(userId: number) {
  const memberships = await getDb().membership.findMany({
    where: { userId },
    select: { role: true, workspace: { select: { id: true, name: true } } },
    orderBy: { workspaceId: "desc" },
  });
  return memberships.map(({ role, workspace }) => ({ ...workspace, role }));
}

export async function createWorkspace(userId: number, body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) throw new WorkspaceError(400, "VALIDATION_ERROR", "Enter a workspace name of 1-100 characters.");
  // A nested write is atomic: the workspace and its owner both succeed or
  // neither is saved. The creator comes from the session, never the body.
  return getDb().workspace.create({
    data: { name, memberships: { create: { userId, role: "OWNER" } } },
    select: { id: true, name: true },
  });
}

export async function listMembers(workspaceId: number, userId: number) {
  return getDb().$transaction(async (tx) => {
    await requireMember(tx, workspaceId, userId);
    return tx.membership.findMany({ where: { workspaceId }, select: memberSelection, orderBy: { userId: "asc" } });
  }, { isolationLevel: "Serializable" });
}


export async function changeMemberRole(workspaceId: number, userId: number, targetUserId: number, body: Record<string, unknown>) {
  return getDb().$transaction(async (tx) => {
    const actor = await requireMember(tx, workspaceId, userId);
    if (actor.role !== "OWNER") throw new WorkspaceError(403, "FORBIDDEN", "Only owners can change member roles.");
    const role = editableRole(body.role);
    const target = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw new WorkspaceError(404, "MEMBER_NOT_FOUND", "Member not found in this workspace.");
    if (target.role === "OWNER") throw new WorkspaceError(403, "OWNER_PROTECTED", "Ownership changes are not supported.");
    return tx.membership.update({ where: { id: target.id }, data: { role }, select: memberSelection });
  }, { isolationLevel: "Serializable" });
}
