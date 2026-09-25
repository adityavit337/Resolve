import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Prisma } from "../generated/prisma/client.ts";
import { getDb } from "./db.ts";
import { requireMember } from "./workspaces.ts";
import { WorkspaceError } from "./workspace-api.ts";

const lifetime = 7 * 24 * 60 * 60 * 1000;
const invalid = () => new WorkspaceError(410, "INVITATION_UNAVAILABLE", "This invitation is invalid, expired, or already used. Ask for a new link.");

function tokenHash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw invalid();
  return createHash("sha256").update(value).digest("hex");
}

async function availableInvitation(tx: Prisma.TransactionClient, hash: string) {
  const invitation = await tx.invitation.findUnique({ where: { tokenHash: hash } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) throw invalid();
  // An old link cannot outlive the sender's authority to grant this role.
  const sender = await tx.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: invitation.invitedById } },
  });
  if (!sender || !(sender.role === "OWNER" || (sender.role === "ADMIN" && invitation.role === "AGENT")) || invitation.role === "OWNER") throw invalid();
  return invitation;
}

export async function createInvitation(workspaceId: number, userId: number, body: Record<string, unknown>) {
  return getDb().$transaction(async (tx) => {
    const actor = await requireMember(tx, workspaceId, userId);
    if (actor.role === "AGENT") throw new WorkspaceError(403, "FORBIDDEN", "Agents cannot invite members.");
    const role = body.role;
    if (role !== "ADMIN" && role !== "AGENT") throw new WorkspaceError(400, "VALIDATION_ERROR", "Choose ADMIN or AGENT.");
    if (actor.role === "ADMIN" && role !== "AGENT") throw new WorkspaceError(403, "FORBIDDEN", "Admins can only invite agents.");
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WorkspaceError(400, "VALIDATION_ERROR", "Enter a valid email.");
    const member = await tx.membership.findFirst({ where: { workspaceId, user: { email } }, select: { id: true } });
    if (member) throw new WorkspaceError(409, "ALREADY_MEMBER", "This user is already a member.");

    // Reissuing a link invalidates older pending invitations for this address.
    await tx.invitation.updateMany({ where: { workspaceId, email, acceptedAt: null }, data: { expiresAt: new Date() } });
    const token = randomBytes(32).toString("hex");
    const invitation = await tx.invitation.create({
      data: { workspaceId, invitedById: userId, email, role, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + lifetime) },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
    // The fragment is not included in HTTP URLs or Referer headers.
    const url = new URL("/invitations/accept", process.env.BETTER_AUTH_URL);
    url.hash = token;
    return { ...invitation, url: url.toString() };
  }, { isolationLevel: "Serializable" });
}

export async function previewInvitation(token: unknown) {
  const hash = tokenHash(token);
  return getDb().$transaction(async (tx) => {
    const invitation = await availableInvitation(tx, hash);
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: invitation.workspaceId }, select: { name: true } });
    const account = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    return { email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, workspaceName: workspace.name, existingAccount: !!account };
  }, { isolationLevel: "Serializable" });
}

export async function acceptInvitation(body: Record<string, unknown>, sessionUserId: number | null) {
  const hash = tokenHash(body.token);
  // Reject bad links before performing expensive password hashing. Recheck
  // everything in the write transaction after hashing.
  const preview = await previewInvitation(body.token);
  let name = "";
  let passwordHash: string | undefined;
  if (sessionUserId === null && !preview.existingAccount) {
    name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100 || typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) {
      throw new WorkspaceError(400, "VALIDATION_ERROR", "Enter a name (1-100 characters) and password (12-128 characters).");
    }
    passwordHash = await hashPassword(body.password);
  }

  return getDb().$transaction(async (tx) => {
    const invitation = await availableInvitation(tx, hash);
    let user = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    if (sessionUserId !== null) {
      if (!user || user.id !== sessionUserId) throw new WorkspaceError(403, "WRONG_ACCOUNT", "Sign in with the invited email before accepting.");
    } else if (user) {
      // A link never resets or bypasses an existing account's password.
      throw new WorkspaceError(401, "SIGN_IN_REQUIRED", "Sign in with the invited account.");
    } else {
      if (!passwordHash) throw new WorkspaceError(409, "CONFLICT", "Account details changed. Reload the invitation.");
      user = await tx.user.create({ data: { email: invitation.email, name }, select: { id: true } });
      await tx.account.create({ data: { userId: user.id, providerId: "credential", accountId: String(user.id), password: passwordHash } });
    }

    const now = new Date();
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) throw invalid();
    // Never downgrade/promote an existing member via a stale second invitation.
    const member = await tx.membership.upsert({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
      update: {}, create: { workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role },
      select: { workspaceId: true, role: true },
    });
    return { ...member, signInRequired: sessionUserId === null };
  }, { isolationLevel: "Serializable" });
}
