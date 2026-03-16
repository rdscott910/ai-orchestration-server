import type { Context } from "grammy";
import { config } from "../config.js";
import { execWithTimeout } from "../services/shell.js";
import { writeReview } from "../services/sync.js";
import { sanitizeForShell } from "../utils/sanitize.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("executor");

type AgentTarget = "cursor" | "claude";

interface ParsedCommand {
  target: AgentTarget;
  instruction: string;
}

/**
 * Executor skill: Telegram /exec → CLI agent → Review file in SYNC_DIR/Reviews/
 *
 * Accepts two forms:
 *   /exec <instruction>             → routes to cursor (default)
 *   /exec cursor <instruction>      → routes to cursor explicitly
 *   /exec claude <instruction>      → routes to claude CLI
 */
export async function execute(args: string, ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  log.info(`Executor triggered by user ${userId}`);

  let parsed: ParsedCommand;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Parse error: ${message}\n\nUsage: /exec [cursor|claude] <instruction>`);
    return;
  }

  const cfg = config.get();

  // Validate the target CLI is configured before starting execution
  if (parsed.target === "claude" && !cfg.CLAUDE_CLI_PATH) {
    await ctx.reply(
      "Claude CLI is not configured.\n\n" +
      "Install it with: npm install -g @anthropic-ai/claude-code\n" +
      "Then set CLAUDE_CLI_PATH in .env"
    );
    return;
  }

  const cliPath =
    parsed.target === "claude" ? cfg.CLAUDE_CLI_PATH : cfg.CURSOR_CLI_PATH;

  const sanitizedInstruction = sanitizeForShell(parsed.instruction);
  if (!sanitizedInstruction) {
    await ctx.reply("Instruction is empty after sanitization. Please use plain text.");
    return;
  }

  const cliArgs = buildCliArgs(parsed.target, sanitizedInstruction);

  await ctx.reply(`Executing via ${parsed.target}...`);
  log.info(`Running ${parsed.target} CLI: ${cliPath} ${cliArgs.join(" ")}`);

  const startMs = Date.now();
  const result = await execWithTimeout(cliPath, cliArgs, {
    timeoutMs: cfg.EXEC_TIMEOUT_MS,
  });

  const durationSec = Math.round((Date.now() - startMs) / 1000);

  if (result.timedOut) {
    await ctx.reply(
      `Execution timed out after ${Math.round(cfg.EXEC_TIMEOUT_MS / 1000)}s.\n\n` +
      `Partial output:\n${truncate(result.stdout, 500)}`
    );
    log.warn(`Executor timed out for instruction: ${parsed.instruction.slice(0, 80)}`);
    return;
  }

  const statusLine = `Exit ${result.exitCode} in ${durationSec}s`;

  if (result.exitCode !== 0) {
    const errPreview = truncate(result.stderr || result.stdout, 600);
    await ctx.reply(`Execution failed (${statusLine}):\n\n${errPreview}`);
    log.warn(`Executor failed with exit ${result.exitCode}`);
    return;
  }

  // Phase 4: Generate review file on successful execution
  let reviewFilename: string | null = null;
  try {
    reviewFilename = await generateReview({
      instruction: parsed.instruction,
      target: parsed.target,
      exitCode: result.exitCode,
      durationSec,
      stdout: result.stdout,
    });
  } catch (reviewErr) {
    const msg = reviewErr instanceof Error ? reviewErr.message : String(reviewErr);
    log.warn(`Review generation failed (non-fatal): ${msg}`);
  }

  const outputPreview = truncate(result.stdout, 500);
  const reviewNote = reviewFilename ? `\n\nReview saved: Reviews/${reviewFilename}` : "";

  await ctx.reply(`Done (${statusLine}):\n\n${outputPreview}${reviewNote}`);
  log.info(`Executor completed successfully for: ${parsed.instruction.slice(0, 80)}`);
}

// --- Argument parsing ---

function parseArgs(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Instruction cannot be empty");

  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();

  if (firstWord === "cursor" || firstWord === "claude") {
    const instruction = trimmed.slice(firstWord.length).trim();
    if (!instruction) throw new Error("Instruction text is required after target");
    return { target: firstWord as AgentTarget, instruction };
  }

  return { target: "cursor", instruction: trimmed };
}

function buildCliArgs(target: AgentTarget, instruction: string): string[] {
  switch (target) {
    case "cursor":
      return ["--command", instruction];
    case "claude":
      // --print sends the instruction non-interactively and prints output to stdout
      return ["--print", instruction];
  }
}

// --- Phase 4: Review file generation ---

interface ReviewInput {
  instruction: string;
  target: AgentTarget;
  exitCode: number;
  durationSec: number;
  stdout: string;
}

async function generateReview(input: ReviewInput): Promise<string> {
  // Get staged diff first; fall back to last commit diff if nothing is staged
  const diffResult = await execWithTimeout("git", ["diff", "--cached"], { timeoutMs: 10_000 });
  const diff =
    diffResult.stdout.trim() ||
    (await execWithTimeout("git", ["diff", "HEAD~1"], { timeoutMs: 10_000 })).stdout.trim();

  const filesChanged = parseChangedFiles(diff);
  const diffStats = parseDiffStats(diff);
  const slug = makeSlug(input.instruction);
  const timestamp = new Date().toISOString();
  const datePrefix = timestamp.slice(0, 10).replace(/-/g, "") +
    "-" + timestamp.slice(11, 19).replace(/:/g, "");

  const filename = `${datePrefix}-${slug}.md`;
  const content = formatReview({ ...input, diff, filesChanged, diffStats, timestamp });

  await writeReview(filename, content);
  return filename;
}

function formatReview(opts: {
  instruction: string;
  target: AgentTarget;
  exitCode: number;
  durationSec: number;
  stdout: string;
  diff: string;
  filesChanged: string[];
  diffStats: { added: number; removed: number };
  timestamp: string;
}): string {
  const title = opts.instruction.slice(0, 50);
  const diffBlock = opts.diff
    ? `\`\`\`diff\n${truncate(opts.diff, 5000)}\n\`\`\``
    : "_No staged or recent changes detected._";

  const changedFilesList =
    opts.filesChanged.length > 0
      ? opts.filesChanged.map((f) => `- ${f}`).join("\n")
      : "_None detected_";

  return [
    `# Review: ${title}`,
    ``,
    `**Date:** ${opts.timestamp}`,
    `**Agent:** ${opts.target}`,
    `**Exit Code:** ${opts.exitCode}`,
    `**Duration:** ${opts.durationSec}s`,
    `**Changes:** +${opts.diffStats.added} -${opts.diffStats.removed} lines`,
    ``,
    `## Instruction`,
    ``,
    `> ${opts.instruction}`,
    ``,
    `## Agent Output`,
    ``,
    "```",
    truncate(opts.stdout, 2000),
    "```",
    ``,
    `## Files Changed`,
    ``,
    changedFilesList,
    ``,
    `## Diff`,
    ``,
    diffBlock,
    ``,
  ].join("\n");
}

function parseChangedFiles(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
    if (match?.[1]) files.push(match[1]);
  }
  return files;
}

function parseDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

function makeSlug(instruction: string): string {
  return instruction
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `\n... [truncated ${str.length - maxLen} chars]`;
}
