// Shared vocabulary, not authorization: the server enforces these transitions.
export const statusTransitions = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["OPEN", "RESOLVED"],
  RESOLVED: ["OPEN"],
} as const;
export type WorkflowStatus = keyof typeof statusTransitions;
export const priorities = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type WorkflowPriority = typeof priorities[number];
