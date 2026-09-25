import { getDb } from "../lib/db.ts";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    process.env.NODE_ENV === "production" ||
    url.protocol !== "mysql:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/resolve_dev"
  ) {
    throw new Error("Seed requires the local resolve_dev database.");
  }

  const db = getDb();
  try {
    await db.$transaction(async (tx) => {
      // Negative IDs are reserved for these fixtures. Normal inserts use
      // positive auto-increment IDs. Empty updates preserve local edits.
      const acme = await tx.workspace.upsert({
        where: { id: -1 },
        update: {},
        create: { id: -1, name: "Acme Support" },
      });
      const northstar = await tx.workspace.upsert({
        where: { id: -2 },
        update: {},
        create: { id: -2, name: "Northstar Support" },
      });

      const alice = await tx.user.upsert({
        where: { email: "alice@example.test" },
        update: {},
        create: { name: "Alice Demo", email: "alice@example.test" },
      });
      const ben = await tx.user.upsert({
        where: { email: "ben@example.test" },
        update: {},
        create: { name: "Ben Demo", email: "ben@example.test" },
      });
      const cara = await tx.user.upsert({
        where: { email: "cara@example.test" },
        update: {},
        create: { name: "Cara Demo", email: "cara@example.test" },
      });

      const memberships = [
        { workspaceId: acme.id, userId: alice.id, role: "OWNER" },
        { workspaceId: acme.id, userId: ben.id, role: "AGENT" },
        { workspaceId: northstar.id, userId: cara.id, role: "OWNER" },
        { workspaceId: northstar.id, userId: ben.id, role: "ADMIN" },
      ] as const;

      for (const membership of memberships) {
        await tx.membership.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: membership.workspaceId,
              userId: membership.userId,
            },
          },
          update: {},
          create: membership,
        });
      }

      const tickets = [
        { id: -1, workspaceId: acme.id, subject: "Cannot reset my password", description: "The password reset email has not arrived.", status: "OPEN" },
        { id: -2, workspaceId: acme.id, subject: "Invoice shows the wrong address", description: "Please help update the address on my latest invoice.", status: "IN_PROGRESS" },
        { id: -3, workspaceId: northstar.id, subject: "Cannot reset my password", description: "The reset link says it has expired.", status: "OPEN" },
        { id: -4, workspaceId: northstar.id, subject: "Where can I download my receipt?", description: "Support helped me locate the receipt in account settings.", status: "RESOLVED" },
      ] as const;

      for (const ticket of tickets) {
        await tx.ticket.upsert({
          where: { id: ticket.id },
          update: {},
          create: ticket,
        });
      }
    });

    const workspaces = await db.workspace.findMany({
      where: { id: { in: [-1, -2] } },
      orderBy: { id: "desc" },
      select: {
        id: true,
        name: true,
        memberships: {
          orderBy: { userId: "asc" },
          select: { role: true, user: { select: { name: true, email: true } } },
        },
        tickets: {
          orderBy: { id: "desc" },
          select: { id: true, subject: true, status: true },
        },
      },
    });
    console.log("Development seed ready. Existing records were preserved.");
    console.dir(workspaces, { depth: null });
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  // Do not expose credentials or driver connection details.
  console.error("Seed failed. Use local resolve_dev outside production; check credentials, migrations, and fixture conflicts.");
  process.exitCode = 1;
});
