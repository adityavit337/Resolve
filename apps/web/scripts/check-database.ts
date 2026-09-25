import { getDb } from "../lib/db.ts";

async function main() {
  const db = getDb();
  try {
    const server = await db.$queryRaw<Array<{ version: string }>>`SELECT VERSION() AS version`;
    const counts = {
      users: await db.user.count(),
      workspaces: await db.workspace.count(),
      memberships: await db.membership.count(),
      tickets: await db.ticket.count(),
    };
    console.log("Connected to MySQL", server[0].version);
    console.log("Table counts:", counts);
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  // Avoid printing connection details or credentials from driver errors.
  console.error("Database check failed. Check local credentials, MySQL availability, and migration status.");
  process.exitCode = 1;
});
