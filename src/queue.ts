import PQueue from "p-queue";
import { createLogger } from "./utils/logger.js";

const log = createLogger("queue");

// concurrency=1 enforces strict FIFO ordering for all enqueued jobs.
// This is the primary guard against concurrent shell executions that could
// corrupt the local git index (e.g., two agents running `git add` simultaneously).
const queue = new PQueue({ concurrency: 1 });

queue.on("active", () => {
  log.debug(`Queue active — size: ${queue.size}, pending: ${queue.pending}`);
});

queue.on("idle", () => {
  log.debug("Queue drained");
});

/**
 * Enqueue an async task. Returns a promise that resolves/rejects with the
 * task's return value once it reaches the front of the queue and completes.
 * Callers can await this for direct feedback, or fire-and-forget.
 */
async function enqueue<T>(task: () => Promise<T>): Promise<T> {
  log.debug(`Enqueuing task — queue size before: ${queue.size}`);
  return queue.add(task) as Promise<T>;
}

function getSize(): number {
  return queue.size;
}

function getPending(): number {
  return queue.pending;
}

export const taskQueue = { enqueue, getSize, getPending };
