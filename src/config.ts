import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { resolve } from "path";
import { createLogger } from "./utils/logger.js";

const log = createLogger("config");

// Load .env from project root before any validation.
// Fail-fast: if required vars are missing, the process exits immediately
// rather than crashing deep in execution where the error is harder to trace.
loadDotenv();

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10, "TELEGRAM_BOT_TOKEN is required"),

  // Space-tolerant comma-separated list → parsed into a Set<number> for O(1) lookups
  TELEGRAM_ALLOWED_USER_IDS: z
    .string()
    .min(1, "TELEGRAM_ALLOWED_USER_IDS must contain at least one ID")
    .transform((val) =>
      new Set(
        val
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
          .map(Number)
      )
    ),

  ANTHROPIC_API_KEY: z.string().min(10, "ANTHROPIC_API_KEY is required"),

  SYNC_DIR: z
    .string()
    .min(1, "SYNC_DIR is required")
    .transform((val) => resolve(val.replace(/^~/, process.env.HOME ?? "~"))),

  // Optional until the user installs Claude Code CLI
  CLAUDE_CLI_PATH: z.string().default(""),

  CURSOR_CLI_PATH: z.string().default("/usr/local/bin/cursor"),

  EXEC_TIMEOUT_MS: z
    .string()
    .default("300000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive()),

  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

function load(): Config {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    log.error(`Configuration validation failed:\n${issues}`);
    process.exit(1);
  }

  _config = result.data;
  log.info("Configuration loaded successfully");
  log.debug(`SYNC_DIR resolved to: ${_config.SYNC_DIR}`);
  return _config;
}

function get(): Config {
  if (!_config) {
    throw new Error("Config not loaded — call config.load() first");
  }
  return _config;
}

export const config = { load, get };
