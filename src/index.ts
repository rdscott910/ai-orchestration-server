import { config } from "./config.js";
import { createBot } from "./bot.js";
import { createLogger } from "./utils/logger.js";

const log = createLogger("index");

async function main(): Promise<void> {
  // Load and validate all environment configuration before touching anything else.
  // If .env is incomplete, the process exits here with a clear error.
  config.load();

  const bot = createBot();

  // Graceful shutdown: stop accepting new Telegram updates and let the queue
  // drain naturally. This avoids leaving the bot in a wedged state on restart.
  function shutdown(signal: string): void {
    log.info(`Received ${signal} — shutting down gracefully`);
    bot.stop();
    log.info("Bot stopped");
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Unhandled rejections are logged but do not crash the server.
  // Individual skill errors are handled within each skill and reported
  // back to Telegram, so unhandled rejections here are genuine bugs.
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection", reason);
  });

  log.info("Starting AI Orchestration Server...");
  await bot.start({
    onStart: (info) => {
      log.info(`Bot @${info.username} is live (long polling)`);
    },
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
