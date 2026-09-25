import { hashPassword } from "better-auth/crypto";
import { getDb } from "../lib/db.ts";
import { isLocalDevelopmentDatabase } from "../lib/tickets.ts";

async function main() {
  if (!isLocalDevelopmentDatabase()) throw new Error("Local development only");
  const password = process.env.DEV_SEED_PASSWORD;
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error("Set DEV_SEED_PASSWORD to 12-128 characters");
  }

  const db = getDb();
  try {
    const emails = ["alice@example.test", "ben@example.test", "cara@example.test"];
    const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    if (users.length !== emails.length) throw new Error("Run db:seed first");

    // Hash with the same implementation as Better Auth. Empty updates keep
    // existing credentials unchanged when the script is run again.
    const passwordHash = await hashPassword(password);
    await db.$transaction(users.map((user) => db.account.upsert({
      where: { providerId_accountId: { providerId: "credential", accountId: String(user.id) } },
      update: {},
      create: { userId: user.id, providerId: "credential", accountId: String(user.id), password: passwordHash },
    })));
    console.log("Demo sign-in accounts ready. Existing credentials were preserved.");
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  console.error("Auth seed failed. Use local resolve_dev outside production, apply migrations, run db:seed, and set DEV_SEED_PASSWORD (12-128 characters).");
  process.exitCode = 1;
});
