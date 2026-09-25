import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { getDb } from "../lib/db.ts";
import { isLocalDevelopmentDatabase } from "../lib/tickets.ts";

if (!isLocalDevelopmentDatabase() || process.env.BETTER_AUTH_URL !== "http://127.0.0.1:3000") {
  throw new Error("Browser fixtures require the local resolve_dev database and loopback auth URL.");
}

const db = getDb();
const action = process.argv[2];
const marker = process.argv[3];
if (!marker || !/^[a-f0-9-]{36}$/.test(marker)) throw new Error("Expected a test UUID marker.");

const email = `e2e-${marker}@example.test`;
const workspaceName = `Browser workspace ${marker}`;
const subject = `Browser journey ${marker}`;

async function cleanup() {
  const workspace = await db.workspace.findFirst({ where: { name: workspaceName }, select: { id: true } });
  if (workspace) {
    await db.helpArticle.deleteMany({ where: { workspaceId: workspace.id } });
    await db.ticket.deleteMany({ where: { workspaceId: workspace.id } });
    await db.membership.deleteMany({ where: { workspaceId: workspace.id } });
    await db.workspace.delete({ where: { id: workspace.id } });
  }
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (user) await db.user.delete({ where: { id: user.id } });
}

try {
  if (action === "create") {
    const password = randomUUID();
    try {
      const user = await db.user.create({ data: { email, name: "Browser Agent" } });
      await db.account.create({ data: {
        userId: user.id, providerId: "credential", accountId: String(user.id), password: await hashPassword(password),
      } });
      const workspace = await db.workspace.create({ data: {
        name: workspaceName,
        memberships: { create: { userId: user.id, role: "OWNER" } },
      } });
      process.stdout.write(JSON.stringify({ email, password, userId: user.id, workspaceId: workspace.id, subject }));
    } catch (error) {
      await cleanup();
      throw error;
    }
  } else if (action === "inspect") {
    const ticket = await db.ticket.findFirst({
      where: { workspace: { name: workspaceName }, subject },
      include: { messages: true, changes: true },
    });
    process.stdout.write(JSON.stringify(ticket && {
      status: ticket.status,
      priority: ticket.priority,
      assigneeId: ticket.assigneeId,
      version: ticket.version,
      messageKinds: ticket.messages.map((message) => message.kind).sort(),
      changeFields: ticket.changes.map((change) => change.field).sort(),
    }));
  } else if (action === "cleanup") {
    await cleanup();
  } else {
    throw new Error("Expected create, inspect, or cleanup.");
  }
} finally {
  await db.$disconnect();
}
