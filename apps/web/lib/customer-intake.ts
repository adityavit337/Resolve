import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Prisma } from "../generated/prisma/client.ts";
import { getDb } from "./db.ts";
import { requireMember } from "./workspaces.ts";
import { WorkspaceError } from "./workspace-api.ts";
import type { TicketInput } from "./tickets.ts";

const lifetime = 7 * 24 * 60 * 60 * 1000;
const unavailable = () => new WorkspaceError(410, "INVITATION_UNAVAILABLE", "This customer invitation is invalid, expired, or already used.");

function tokenHash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw unavailable();
  return createHash("sha256").update(value).digest("hex");
}

async function availableInvitation(tx: Prisma.TransactionClient, hash: string) {
  const invitation = await tx.customerInvitation.findUnique({ where: { tokenHash: hash } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) throw unavailable();
  const sender = await tx.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: invitation.invitedById } },
  });
  if (!sender || (sender.role !== "OWNER" && sender.role !== "ADMIN")) throw unavailable();
  return invitation;
}

export async function createCustomerInvitation(workspaceId: number, userId: number, body: Record<string, unknown>) {
  return getDb().$transaction(async (tx) => {
    const actor = await requireMember(tx, workspaceId, userId);
    if (actor.role === "AGENT") throw new WorkspaceError(403, "FORBIDDEN", "Only owners and admins can invite customers.");
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new WorkspaceError(400, "VALIDATION_ERROR", "Enter a valid email.");
    }
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      if (await tx.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: existing.id } } })) {
        throw new WorkspaceError(409, "STAFF_ACCOUNT", "This account is already staff in the workspace.");
      }
      if (await tx.customerAccess.findUnique({ where: { workspaceId_userId: { workspaceId, userId: existing.id } } })) {
        throw new WorkspaceError(409, "ALREADY_CUSTOMER", "This account already has customer access.");
      }
    }
    await tx.customerInvitation.updateMany({ where: { workspaceId, email, acceptedAt: null }, data: { expiresAt: new Date() } });
    const token = randomBytes(32).toString("hex");
    const invitation = await tx.customerInvitation.create({
      data: { workspaceId, invitedById: userId, email, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + lifetime) },
      select: { id: true, email: true, expiresAt: true },
    });
    const url = new URL("/customer-invitations/accept", process.env.BETTER_AUTH_URL);
    url.hash = token;
    return { ...invitation, url: url.toString() };
  }, { isolationLevel: "Serializable" });
}

export async function previewCustomerInvitation(token: unknown) {
  const hash = tokenHash(token);
  return getDb().$transaction(async (tx) => {
    const invitation = await availableInvitation(tx, hash);
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: invitation.workspaceId }, select: { name: true } });
    const account = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    return { email: invitation.email, workspaceName: workspace.name, existingAccount: !!account };
  }, { isolationLevel: "Serializable" });
}

export async function acceptCustomerInvitation(body: Record<string, unknown>, sessionUserId: number | null) {
  const hash = tokenHash(body.token);
  const preview = await previewCustomerInvitation(body.token);
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
      throw new WorkspaceError(401, "SIGN_IN_REQUIRED", "Sign in with the invited account.");
    } else {
      if (!passwordHash) throw new WorkspaceError(409, "CONFLICT", "Account details changed. Reload the invitation.");
      user = await tx.user.create({ data: { email: invitation.email, name }, select: { id: true } });
      await tx.account.create({ data: { userId: user.id, providerId: "credential", accountId: String(user.id), password: passwordHash } });
    }
    if (await tx.membership.findUnique({ where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } } })) {
      throw new WorkspaceError(409, "STAFF_ACCOUNT", "This account is already staff in the workspace.");
    }
    const now = new Date();
    const claimed = await tx.customerInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: now } }, data: { acceptedAt: now } });
    if (claimed.count !== 1) throw unavailable();
    const access = await tx.customerAccess.upsert({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
      update: {}, create: { workspaceId: invitation.workspaceId, userId: user.id },
      select: { workspaceId: true },
    });
    return { ...access, signInRequired: sessionUserId === null };
  }, { isolationLevel: "Serializable" });
}

export async function listCustomerWorkspaces(userId: number) {
  const rows = await getDb().customerAccess.findMany({
    where: { userId }, select: { workspace: { select: { id: true, name: true } } }, orderBy: { workspaceId: "desc" },
  });
  return rows.map((row) => row.workspace);
}

export async function submitCustomerTicket(workspaceId: number, userId: number, input: TicketInput) {
  return getDb().$transaction(async (tx) => {
    const access = await tx.customerAccess.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (!access) throw new WorkspaceError(403, "FORBIDDEN", "You cannot submit tickets to this workspace.");
    return tx.ticket.create({
      data: { workspaceId, customerId: userId, subject: input.subject, description: input.description },
      select: { id: true, subject: true, status: true, createdAt: true },
    });
  }, { isolationLevel: "Serializable" });
}
