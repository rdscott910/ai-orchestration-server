import type { Context } from "grammy";
import { scrapeUrl } from "../services/scraper.js";
import { summarize } from "../services/anthropic.js";
import { appendToInbox } from "../services/sync.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("observer");

/**
 * Observer skill: URL → DOM scrape → Claude 3.5 Haiku 3-bullet summary → Inbox.md
 *
 * Each stage sends a Telegram progress update so the user has live feedback
 * during network and API calls that may take 5–15 seconds each.
 */
export async function observe(url: string, ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  log.info(`Observer triggered by user ${userId} for URL: ${url}`);

  try {
    await ctx.reply("Scraping...");
    const articleText = await scrapeUrl(url);
    log.debug(`Extracted ${articleText.length} chars from URL`);

    await ctx.reply("Summarizing...");
    const summary = await summarize(articleText);

    const entry = formatInboxEntry(url, summary);
    await appendToInbox(entry);

    await ctx.reply(`Done. Added to Inbox.md:\n\n${summary}`);
    log.info(`Observer completed for URL: ${url}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Observer failed for URL ${url}: ${message}`);
    await ctx.reply(`Observer failed: ${message}`);
  }
}

function formatInboxEntry(url: string, summary: string): string {
  const timestamp = new Date().toISOString();
  return [
    `\n---\n`,
    `## ${timestamp}`,
    `**Source:** ${url}`,
    ``,
    summary,
    ``,
  ].join("\n");
}
