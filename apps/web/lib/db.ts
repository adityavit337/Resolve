import "server-only";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.ts";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getDb(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Set DATABASE_URL in apps/web/.env first.");

  const url = new URL(databaseUrl);
  if (url.protocol !== "mysql:") throw new Error("DATABASE_URL must use mysql://.");

  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectionLimit: 5,
    connectTimeout: 5000,
    acquireTimeout: 10000,
    timezone: "Z",
    // MySQL password authentication on the local development server.
    allowPublicKeyRetrieval: ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
  });

  // Reuse the pool, including across development hot reloads.
  globalForPrisma.prisma = new PrismaClient({ adapter });
  return globalForPrisma.prisma;
}
