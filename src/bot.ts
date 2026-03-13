import { Bot, Context } from "grammy";
import { config } from "./config.js";
import { taskQueue } from "./queue.js";
import { createLogger } from "./utils/logger.js";
import { observe } from "./skills/observer.js";
import { execute } from "./skills/executor.js";

const log = createLogger("bot");

const startTime = Date.now();

/**
 * Auth guard middleware — rejects any message from a user ID not in the
 * configured allowlist. This is the first line of defense: no unauthorized
 * user can reach the /exec or /observe handlers, regardless of what they send.
 */
async function authGuard(ctx: Context, next: () => Promise<void>): Promise<void> {
  const userId = ctx.from?.id;
  const cfg = config.get();

  if (!userId || !cfg.TELEGRAM_ALLOWED_USER_IDS.has(userId)) {
    log.warn(`Rejected unauthorized user: ${userId ?? "unknown"}`);
    await ctx.reply("Unauthorized.");
    return;
  }

  log.debug(`Authorized user ${userId}`);
  await next();
}

export function createBot(): Bot {
  const { TELEGRAM_BOT_TOKEN } = config.get();
  const bot = new Bot(TELEGRAM_BOT_TOKEN);

  // Apply auth guard to all updates
  bot.use(authGuard);

  // /observe <url> — scrape URL and append 3-bullet summary to Inbox.md
  bot.command("observe", async (ctx) => {
    const url = ctx.match?.trim();
    if (!url) {
      await ctx.reply("Usage: /observe <url>");
      return;
    }

    const position = taskQueue.getSize() + 1;
    if (position > 1) {
      await ctx.reply(`Queued (position ${position})...`);
    }

    taskQueue.enqueue(() => observe(url, ctx)).catch((err: unknown) => {
      log.error("Observer skill unhandled error", err);
    });
  });

  // /exec [cursor|claude] <instruction> — delegate to CLI agent
  bot.command("exec", async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) {
      await ctx.reply("Usage: /exec [cursor|claude] <instruction>");
      return;
    }

    const position = taskQueue.getSize() + 1;
    if (position > 1) {
      await ctx.reply(`Queued (position ${position})...`);
    }

    taskQueue.enqueue(() => execute(args, ctx)).catch((err: unknown) => {
      log.error("Executor skill unhandled error", err);
    });
  });

  // /status — health check
  bot.command("status", async (ctx) => {
    const uptimeMs = Date.now() - startTime;
    const uptime = formatUptime(uptimeMs);
    const queueSize = taskQueue.getSize();
    const pending = taskQueue.getPending();

    await ctx.reply(
      `AI is running\n\nUptime: ${uptime}\nQueue: ${queueSize} waiting, ${pending} active`
    );
  });

  bot.catch((err) => {
    log.error("grammY unhandled error", err);
  });

  return bot;
}

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
