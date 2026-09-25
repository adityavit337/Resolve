import { checkFailure, createCheckWorker } from "../lib/background.ts";

async function main() {
  const worker = createCheckWorker();
  worker.on("error", () => console.error("Worker connection error. Check local Redis; reconnection will be attempted."));
  worker.on("completed", (job) => console.log(JSON.stringify({ event: "completed", jobId: job.id, attemptsMade: job.attemptsMade })));
  worker.on("failed", (job, error) => console.error(JSON.stringify({ event: "attempt-failed", jobId: job?.id,
    attemptsMade: job?.attemptsMade, maxAttempts: job?.opts.attempts, reason: checkFailure(error.message) })));
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await worker.close(); // Finish active work before releasing the Redis connections.
    if (process.connected) process.disconnect();
  }
  const shutdown = () => { void stop().catch(() => { process.exitCode = 1; }); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Allows the process integration test to request graceful shutdown on Windows.
  process.on("message", (message) => { if (message === "shutdown") shutdown(); });
  await worker.waitUntilReady();
  console.log(JSON.stringify({ event: "ready", workerPid: process.pid }));
}

main().catch(() => {
  console.error("Worker could not start. Check REDIS_URL and local queue configuration.");
  process.exitCode = 1;
});
