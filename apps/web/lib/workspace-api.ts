import "server-only";
import { getSession } from "./auth.ts";
import { isLocalDevelopmentDatabase } from "./tickets.ts";

export class WorkspaceError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function workspaceJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Shared boundary for workspace, member and ticket routes. Membership checks
// also run next to the database operations in workspaces.ts / ticket-access.ts.
export async function workspaceRequest(request: Request, action: (userId: number) => Promise<Response>) {
  try {
    if (!isLocalDevelopmentDatabase()) throw new WorkspaceError(404, "NOT_FOUND", "This local endpoint is unavailable.");
    const session = await getSession(request.headers);
    if (!session) throw new WorkspaceError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (request.method !== "GET" && request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin) {
      throw new WorkspaceError(403, "INVALID_ORIGIN", "This request origin is not allowed.");
    }
    return await action(Number(session.user.id));
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return workspaceJson({ error: { code: error.code, message: error.message } }, error.status);
    }
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "P2002") return workspaceJson({ error: { code: "ALREADY_MEMBER", message: "This user is already a member." } }, 409);
    if (code === "P2034") return workspaceJson({ error: { code: "CONFLICT", message: "Membership changed concurrently. Please try again." } }, 409);
    return workspaceJson({ error: { code: "INTERNAL_ERROR", message: "Could not complete the workspace request. Please try again." } }, 500);
  }
}

export async function readWorkspaceBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); }
  catch { throw new WorkspaceError(400, "INVALID_JSON", "Send a JSON object."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new WorkspaceError(400, "VALIDATION_ERROR", "Send a JSON object.");
  }
  return body as Record<string, unknown>;
}

export function parseWorkspaceId(value: string): number {
  const id = Number(value);
  if (!/^-?[1-9]\d*$/.test(value) || !Number.isSafeInteger(id) || id < -2147483648 || id > 2147483647) {
    throw new WorkspaceError(400, "VALIDATION_ERROR", "Invalid record ID.");
  }
  return id;
}
