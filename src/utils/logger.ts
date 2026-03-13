type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL ?? "info";
  if (raw in LEVELS) return raw as LogLevel;
  return "info";
}

function formatMessage(level: LogLevel, context: string, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase().padEnd(5)}] [${context}] ${message}`;
}

function createLogger(context: string) {
  const minLevel = LEVELS[getConfiguredLevel()];

  return {
    debug(msg: string, ...args: unknown[]) {
      if (minLevel <= LEVELS.debug) {
        console.debug(formatMessage("debug", context, msg), ...args);
      }
    },
    info(msg: string, ...args: unknown[]) {
      if (minLevel <= LEVELS.info) {
        console.info(formatMessage("info", context, msg), ...args);
      }
    },
    warn(msg: string, ...args: unknown[]) {
      if (minLevel <= LEVELS.warn) {
        console.warn(formatMessage("warn", context, msg), ...args);
      }
    },
    error(msg: string, ...args: unknown[]) {
      if (minLevel <= LEVELS.error) {
        console.error(formatMessage("error", context, msg), ...args);
      }
    },
  };
}

export { createLogger };
export type { LogLevel };
