import "server-only";
import { Queue, Worker, UnrecoverableError } from "bullmq";

export const queueName = "queue-check";
export const checkModes = ["success", "transient", "always-fail"] as const;
export type CheckMode = typeof checkModes[number];
export type CheckData = { requestedAt: string; mode?: CheckMode };
export type CheckResult = { operationId: string; requestedAt: string; outcome: "checked" };

// Only known diagnostic messages are exposed; arbitrary dependency errors may contain secrets.
export function checkFailure(reason: string | undefined) {
  const known = ["Invalid queue-check job.", "Simulated temporary failure.", "Simulated persistent failure."];
  return reason ? (known.includes(reason) ? reason : "Task failed; inspect the worker configuration.") : null;
}

// This first task is a local infrastructure check, with no company/customer data.
// Nothing connects to Redis until a CLI explicitly creates a queue or worker.
function options(worker: boolean) {
  let url: URL;
  try { url = new URL(process.env.REDIS_URL ?? ""); }
  catch { throw new Error("Set REDIS_URL to your local Redis address."); }
  if (process.env.NODE_ENV === "production" || url.protocol !== "redis:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Queue checks require local Redis outside production.");
  }
  const prefix = process.env.BULLMQ_PREFIX ?? "resolve-local";
  if (!/^resolve-[a-zA-Z0-9-]{1,80}$/.test(prefix)) throw new Error("Use a resolve- prefixed queue namespace.");
  return {
    prefix,
    connection: {
      url: url.toString(),
      connectTimeout: 3000,
      // Producers fail promptly; workers stay alive across Redis reconnects.
      maxRetriesPerRequest: worker ? null : 1,
      retryStrategy: worker ? (attempt: number) => Math.min(attempt * 250, 3000) : () => null,
    },
  };
}

export function createCheckQueue() {
  const queue = new Queue<CheckData, CheckResult, "check">(queueName, {
    ...options(false),
    defaultJobOptions: {
      attempts: 3, backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { count: 100 }, removeOnFail: { count: 100 },
    },
  });
  queue.on("error", () => console.error("Queue connection error. Check that local Redis is running."));
  return queue;
}

export function createCheckWorker() {
  return new Worker<CheckData, CheckResult, "check">(queueName, async (job) => {
    const mode = job.data?.mode ?? "success";
    if (job.name !== "check" || typeof job.data?.requestedAt !== "string" ||
      !Number.isFinite(Date.parse(job.data.requestedAt)) || !checkModes.includes(mode)) {
      throw new UnrecoverableError("Invalid queue-check job.");
    }
    if (mode === "always-fail") throw new Error("Simulated persistent failure.");
    if (mode === "transient" && job.attemptsMade === 0) throw new Error("Simulated temporary failure.");
    // A pure, repeatable task: no email, counter increment, or other external side effect.
    // Re-execution returns exactly the same receipt. Timing belongs in job metadata.
    return { operationId: job.id!, requestedAt: job.data.requestedAt, outcome: "checked" };
  }, { ...options(true), concurrency: 1 });
}
