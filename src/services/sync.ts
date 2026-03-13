import { promises as fs } from "fs";
import { resolve, join } from "path";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("sync");

/**
 * Resolve a sub-path within SYNC_DIR and assert it stays inside SYNC_DIR.
 *
 * Path traversal guard: `path.resolve()` normalizes `..` segments. By asserting
 * the result starts with the resolved SYNC_DIR, we ensure no crafted filename
 * like `../../etc/passwd` can escape the sandbox.
 */
function safePath(subPath: string): string {
  const syncDir = config.get().SYNC_DIR;
  const resolved = resolve(join(syncDir, subPath));

  if (!resolved.startsWith(syncDir + "/") && resolved !== syncDir) {
    throw new Error(`Path traversal detected: "${subPath}" resolves outside SYNC_DIR`);
  }

  return resolved;
}

/**
 * Append a formatted entry to SYNC_DIR/Inbox.md.
 *
 * fs.appendFile is used instead of writeFile because it atomically appends
 * on POSIX systems — no read-modify-write cycle that could cause data loss
 * if two entries are written within the same OS flush window (unlikely here
 * given queue concurrency=1, but correct regardless).
 */
export async function appendToInbox(content: string): Promise<void> {
  const inboxPath = safePath("Inbox.md");

  // Ensure the directory exists before writing
  await fs.mkdir(config.get().SYNC_DIR, { recursive: true });

  await fs.appendFile(inboxPath, content, "utf-8");
  log.info(`Appended to Inbox.md (${content.length} chars)`);
}

/**
 * Write a review report to SYNC_DIR/Reviews/<filename>.
 *
 * Each review gets a unique timestamped filename, so writeFile (not appendFile)
 * is appropriate — there is no existing content to preserve.
 */
export async function writeReview(filename: string, content: string): Promise<void> {
  // Validate the filename component itself doesn't contain traversal
  if (filename.includes("/") || filename.includes("..")) {
    throw new Error(`Invalid review filename: "${filename}"`);
  }

  const reviewsDir = safePath("Reviews");
  await fs.mkdir(reviewsDir, { recursive: true });

  const filePath = join(reviewsDir, filename);
  await fs.writeFile(filePath, content, "utf-8");
  log.info(`Review written: Reviews/${filename} (${content.length} chars)`);
}
