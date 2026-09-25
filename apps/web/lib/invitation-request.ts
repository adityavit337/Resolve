import "server-only";
import { getSession } from "./auth.ts";
import { isLocalDevelopmentDatabase } from "./tickets.ts";
import { readWorkspaceBody, WorkspaceError, workspaceJson } from "./workspace-api.ts";

// Acceptance can bootstrap a new invited account, so a session is optional.
// The private invitation token supplies the required authorization in that case.
export async function invitationRequest(request: Request, action: (body: Record<string, unknown>, userId: number | null) => Promise<unknown>) {
  try {
    if (!isLocalDevelopmentDatabase()) throw new WorkspaceError(404, "NOT_FOUND", "This local endpoint is unavailable.");
    if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin) throw new WorkspaceError(403, "INVALID_ORIGIN", "This request origin is not allowed.");
    const body = await readWorkspaceBody(request);
    const session = await getSession(request.headers);
    return workspaceJson(await action(body, session ? Number(session.user.id) : null));
  } catch (error) {
    if (error instanceof WorkspaceError) return workspaceJson({ error: { code: error.code, message: error.message } }, error.status);
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "P2034" || code === "P2002") return workspaceJson({ error: { code: "CONFLICT", message: "Another request changed this invitation or account. Please try again." } }, 409);
    return workspaceJson({ error: { code: "INTERNAL_ERROR", message: "Could not process this invitation. Please try again." } }, 500);
  }
}
