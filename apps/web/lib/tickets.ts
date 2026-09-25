import "server-only";

export type TicketInput = {
  subject: string;
  description: string;
};

export type TicketFieldErrors = Partial<Record<keyof TicketInput, string>>;

export function validateTicketInput(value: unknown):
  | { success: true; data: TicketInput }
  | { success: false; fieldErrors: TicketFieldErrors } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { success: false, fieldErrors: {} };
  }

  const input = value as Record<string, unknown>;
  const fieldErrors: TicketFieldErrors = {};
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";

  if (!subject) fieldErrors.subject = "Enter a subject.";
  else if (subject.length > 200) fieldErrors.subject = "Use 200 characters or fewer.";

  if (!description) fieldErrors.description = "Enter a description.";
  else if (description.length > 10_000) fieldErrors.description = "Use 10,000 characters or fewer.";

  if (Object.keys(fieldErrors).length > 0) return { success: false, fieldErrors };

  return { success: true, data: { subject, description } };
}

export function isLocalDevelopmentDatabase(): boolean {
  if (process.env.NODE_ENV === "production") return false;

  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return url.protocol === "mysql:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.pathname === "/resolve_dev";
  } catch {
    return false;
  }
}
