import { randomUUID } from "node:crypto";
import { checkFailure, checkModes, createCheckQueue, type CheckMode } from "../lib/background.ts";

async function main() {
  const [action, id, mode = "success", ...extra] = process.argv.slice(2);
  if (extra.length || !["add", "status", "failed"].includes(action) ||
    (action === "add" && ((id !== undefined && !/^[a-zA-Z0-9-]{1,80}$/.test(id)) || !checkModes.includes(mode as CheckMode))) ||
    (action === "status" && (!id || !/^(check-[a-zA-Z0-9-]{1,80}|[1-9]\d*)$/.test(id))) ||
    (action === "failed" && id !== undefined) || (action !== "add" && process.argv.length > (action === "status" ? 4 : 3))) {
    throw new Error("Usage: add [OPERATION_KEY] [success|transient|always-fail] | status JOB_ID | failed");
  }
  const queue = createCheckQueue();
  try {
    if (action === "add") {
      // The same operation key maps to the same job; Redis atomically ignores duplicates.
      const job = await queue.add("check", { requestedAt: new Date().toISOString(), mode: mode as CheckMode }, {
        jobId: `check-${id ?? randomUUID()}`,
      });
      console.log(JSON.stringify({ jobId: job.id, accepted: true }));
      return; // Submission finishes without waiting for any worker.
    }
    if (action === "failed") {
      const jobs = await queue.getFailed(0, 19);
      console.log(JSON.stringify({ jobs: jobs.map((job) => ({ jobId: job.id, attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts, failure: checkFailure(job.failedReason), finishedOn: job.finishedOn })) }));
      return;
    }
    const job = await queue.getJob(id!);
    if (!job) throw new Error("Job not found (completed/failed jobs have bounded retention).");
    console.log(JSON.stringify({ jobId: job.id, state: await job.getState(), attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts, lastFailure: checkFailure(job.failedReason),
      processedOn: job.processedOn, finishedOn: job.finishedOn, result: job.returnvalue }));
  } finally { await queue.close(); }
}

main().catch(() => {
  console.error("Queue command failed. Usage: add [OPERATION_KEY] [success|transient|always-fail] | status JOB_ID | failed. Check REDIS_URL and local Redis.");
  process.exitCode = 1;
});
