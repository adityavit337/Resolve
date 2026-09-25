import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { getDb } from "./db.ts";

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || !baseURL) {
    throw new Error("Set BETTER_AUTH_SECRET (at least 32 characters) and BETTER_AUTH_URL.");
  }
  const origin = new URL(baseURL);
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
  }

  return betterAuth({
    appName: "Resolve",
    secret,
    baseURL: origin.origin,
    trustedOrigins: [origin.origin],
    database: prismaAdapter(getDb(), { provider: "mysql" }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    session: {
      expiresIn: 60 * 60 * 24,
      // A fixed 24-hour session keeps expiry independent of page rendering.
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    advanced: { database: { generateId: "serial" } },
    // Keep protection enabled during local development as well.
    rateLimit: { enabled: true },
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

// Initialization is lazy so builds don't require deployment secrets or a DB connection.
export function getAuth() {
  return auth ??= createAuth();
}

export async function getSession(headers: Headers) {
  return getAuth().api.getSession({ headers });
}
