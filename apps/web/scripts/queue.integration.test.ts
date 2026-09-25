import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFile, fork, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createCheckQueue } from "../lib/background.ts";

const exec = promisify(execFile);

test("queue lifecycle, retries, and duplicate safety", { timeout: 60_000 }, async (t) => {
  const previousPrefix = process.env.BULLMQ_PREFIX;
  const prefix = `resolve-test-${randomUUID()}`;
  process.env.BULLMQ_PREFIX = prefix;
  const queue = createCheckQueue();
  let worker: ChildProcess | undefined;
  let workerExit: Promise<number | null> | undefined;
  let workerOutput = "";
  const run = async (...args: string[]) => {
    const { stdout } = await exec(process.execPath, ["--conditions=react-server", "scripts/queue-check.ts", ...args], {
      env: { ...process.env }, timeout: 10_000,
    });
    return JSON.parse(stdout);
  };
  const waitFor = async (id: string, state: string) => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const job = await queue.getJob(id);
      assert.ok(job);
      if (await job.getState() === state) return job;
      assert.equal(worker?.exitCode, null, "Worker must stay alive");
      assert.ok(Date.now() < deadline, `Job must reach ${state}`);
      await delay(50);
    }
  };
  try {
    // exec resolves only after the producer process has exited.
    const submitted = await run("add");
    assert.equal(submitted.accepted, true);
    assert.equal((await run("status", submitted.jobId)).state, "waiting");
    const job = await queue.getJob(submitted.jobId);
    assert.ok(job);

    worker = fork("scripts/worker.ts", [], { execArgv: ["--conditions=react-server"], env: { ...process.env }, silent: true });
    workerExit = new Promise((resolve, reject) => { worker!.once("exit", resolve); worker!.once("error", reject); });
    // Consume output so a child's pipe can never block processing.
    worker.stdout?.on("data", (chunk) => { workerOutput += chunk.toString(); });
    worker.stderr?.resume();
    const deadline = Date.now() + 15_000;
    while (await job.getState() !== "completed") {
      assert.equal(worker.exitCode, null, "Worker must stay alive");
      assert.notEqual(await job.getState(), "failed");
      assert.ok(Date.now() < deadline, "Job must finish within 15 seconds");
      await delay(100);
    }
    const completed = await run("status", submitted.jobId);
    assert.equal(completed.state, "completed");
    assert.equal(completed.result.requestedAt, job.data.requestedAt);
    assert.equal(completed.result.outcome, "checked");
    assert.equal(completed.result.operationId, submitted.jobId);
    assert.ok(workerOutput.includes(`"workerPid":${worker.pid}`));
    assert.notEqual(worker.pid, process.pid);
    assert.ok(completed.finishedOn >= Date.parse(job.data.requestedAt));

    await t.test("temporary failure waits for backoff and succeeds on attempt two", async () => {
      const added = await run("add", "temporary", "transient");
      const delayed = await waitFor(added.jobId, "delayed");
      assert.equal(delayed.attemptsMade, 1);
      const firstProcessed = delayed.processedOn!;
      const done = await waitFor(added.jobId, "completed");
      assert.equal(done.attemptsMade, 2);
      assert.ok(done.processedOn! - firstProcessed >= 900, "Retry respects the one-second backoff");
      assert.equal(done.returnvalue.outcome, "checked");
    });

    await t.test("persistent failure stops at three attempts and is inspectable", async () => {
      const added = await run("add", "persistent", "always-fail");
      await waitFor(added.jobId, "failed");
      const status = await run("status", added.jobId);
      assert.equal(status.attemptsMade, 3);
      assert.equal(status.maxAttempts, 3);
      assert.equal(status.lastFailure, "Simulated persistent failure.");
      const listed = (await run("failed")).jobs.find((entry: { jobId: string }) => entry.jobId === added.jobId);
      assert.equal(listed.failure, status.lastFailure);
      await delay(1100);
      assert.equal((await run("status", added.jobId)).attemptsMade, 3);
    });

    await t.test("concurrent and completed duplicate submissions preserve the original job", async () => {
      const duplicates = await Promise.all([run("add", "same-operation"), run("add", "same-operation")]);
      assert.equal(duplicates[0].jobId, duplicates[1].jobId);
      const original = await waitFor(duplicates[0].jobId, "completed");
      const receipt = original.returnvalue;
      assert.equal(original.attemptsMade, 1);
      // A duplicate with different content cannot replace the retained job's data.
      await run("add", "same-operation", "always-fail");
      const retained = await queue.getJob(original.id!);
      assert.deepEqual(retained!.data, original.data);
      assert.equal(retained!.attemptsMade, 1);
      assert.deepEqual(retained!.returnvalue, receipt);
      // Force actual re-execution, proving processor safety separately from deduplication.
      await original.retry("completed");
      const replay = await waitFor(original.id!, "completed");
      assert.deepEqual(replay.returnvalue, receipt);
      assert.ok(replay.attemptsMade > original.attemptsMade);
    });

    await t.test("invalid job data fails once without retrying", async () => {
      const invalid = await queue.add("check", { requestedAt: "invalid" });
      const failed = await waitFor(invalid.id!, "failed");
      assert.equal(failed.attemptsMade, 1);
      assert.equal(failed.failedReason, "Invalid queue-check job.");
    });

    worker.send("shutdown");
    const stopped = await Promise.race([workerExit, delay(5000, "timeout", { ref: false })]);
    assert.equal(stopped, 0, "Worker closes its connections and exits cleanly");
    // Completed receipts remain available after worker shutdown.
    assert.equal((await run("status", submitted.jobId)).state, "completed");
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill();
      await workerExit;
    }
    // Delete only this uniquely named test queue, never the whole Redis database.
    assert.equal(queue.opts.prefix, prefix);
    await queue.obliterate({ force: true });
    await queue.close();
    if (previousPrefix === undefined) delete process.env.BULLMQ_PREFIX;
    else process.env.BULLMQ_PREFIX = previousPrefix;
  }
});

test("queue commands reject remote configuration without disclosing credentials", async () => {
  const secret = randomUUID();
  await assert.rejects(exec(process.execPath, ["--conditions=react-server", "scripts/queue-check.ts", "add"], {
    env: { ...process.env, REDIS_URL: `redis://user:${secret}@example.test:6379` }, timeout: 5000,
  }), (error: unknown) => {
    const result = error as { code: number; stdout: string; stderr: string };
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes("Queue command failed"));
    assert.ok(!result.stderr.includes(secret));
    assert.equal(result.stdout, "");
    return true;
  });
});
