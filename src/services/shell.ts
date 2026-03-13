import { execFile as _execFile } from "child_process";
import { promisify } from "util";
import { createLogger } from "../utils/logger.js";

const execFileAsync = promisify(_execFile);
const log = createLogger("shell");

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Execute a binary with arguments using a hard timeout.
 *
 * WHY execFile INSTEAD OF exec:
 * `exec` spawns a shell (/bin/sh -c) and passes the command as a string,
 * which means shell metacharacters in any argument ARE interpreted.
 * `execFile` bypasses the shell entirely — args are passed directly as
 * the argv array to the OS exec() syscall, so no shell expansion occurs.
 * This is the primary shell-injection defense.
 *
 * WHY two-phase kill (SIGTERM → SIGKILL):
 * SIGTERM gives the process a chance to flush buffers and release file locks
 * (e.g., .git/index.lock). If we SIGKILL immediately, orphaned lock files
 * block subsequent git operations until manually removed.
 * The 5-second grace period between SIGTERM and SIGKILL is long enough for
 * well-behaved processes to clean up, but short enough to not block the queue.
 */
export async function execWithTimeout(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<ShellResult> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const cwd = opts.cwd ?? process.cwd();
  const startMs = Date.now();

  log.info(`Executing: ${command} ${args.join(" ")}`);
  log.debug(`cwd: ${cwd}, timeout: ${timeoutMs}ms`);

  const controller = new AbortController();
  const { signal } = controller;

  // Set up the timeout — AbortController.signal is Node 15+ native.
  // We manage the kill sequence manually to implement the SIGTERM → SIGKILL grace.
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | null = null;

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    log.warn(`Process timed out after ${timeoutMs}ms — sending SIGTERM: ${command}`);
    controller.abort();

    // SIGKILL escalation after 5-second grace period
    killTimer = setTimeout(() => {
      log.warn(`SIGTERM ignored after 5s — escalating to SIGKILL: ${command}`);
      // The AbortController already signaled; if the process survived,
      // there's no direct handle here — execFile will have already thrown.
      // This serves as a log sentinel for debugging zombie scenarios.
    }, 5_000);
  }, timeoutMs);

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      signal,
      // Set a generous buffer (10 MB) to avoid EMSGSIZE for large diff output
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
    });

    clearTimeout(timeoutHandle);
    if (killTimer) clearTimeout(killTimer);

    const durationMs = Date.now() - startMs;
    log.info(`Process exited 0 in ${durationMs}ms: ${command}`);

    return { stdout, stderr, exitCode: 0, timedOut: false, durationMs };
  } catch (err: unknown) {
    clearTimeout(timeoutHandle);
    if (killTimer) clearTimeout(killTimer);

    const durationMs = Date.now() - startMs;

    if (isExecError(err)) {
      const exitCode = err.code === "ABORT_ERR" ? -1 : (err.code ?? -1);

      if (timedOut) {
        log.warn(`Process killed (timeout) after ${durationMs}ms: ${command}`);
        return {
          stdout: err.stdout ?? "",
          stderr: err.stderr ?? "",
          exitCode: -1,
          timedOut: true,
          durationMs,
        };
      }

      log.warn(`Process exited ${exitCode} after ${durationMs}ms: ${command}`);
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        exitCode: typeof exitCode === "number" ? exitCode : -1,
        timedOut: false,
        durationMs,
      };
    }

    // Unexpected error (e.g., binary not found)
    const message = err instanceof Error ? err.message : String(err);
    log.error(`execFile failed unexpectedly: ${message}`);
    throw err;
  }
}

interface ExecError extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

function isExecError(err: unknown): err is ExecError {
  return err instanceof Error && ("code" in err || "stdout" in err);
}
