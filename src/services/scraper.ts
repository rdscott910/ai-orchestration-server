import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { createLogger } from "../utils/logger.js";

const log = createLogger("scraper");

// Maximum characters sent to the Anthropic API. Bounds both memory usage
// and per-request token cost. 12,000 chars ≈ 3,000 tokens, well within Haiku limits.
const MAX_CONTENT_CHARS = 12_000;

// 30-second fetch timeout. AbortSignal.timeout() is Node 17.3+ native;
// no external library needed. A hanging fetch would block the queue slot indefinitely.
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Scrape readable text from a URL.
 *
 * Security: Only http/https are allowed to prevent SSRF via file://, ftp://,
 * or custom protocol handlers that could expose local filesystem contents.
 */
export async function scrapeUrl(rawUrl: string): Promise<string> {
  // URL constructor throws on malformed input — validates the URL safely
  // without regex (which is notoriously error-prone for URL parsing).
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked protocol "${parsed.protocol}" — only http/https allowed`);
  }

  log.info(`Fetching: ${parsed.href}`);

  const response = await fetch(parsed.href, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      // Identify as a browser UA to reduce chances of being blocked by anti-bot measures
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} — ${parsed.href}`);
  }

  const html = await response.text();
  log.debug(`Fetched ${html.length} bytes from ${parsed.hostname}`);

  const text = extractText(html, parsed.href);
  const truncated = text.slice(0, MAX_CONTENT_CHARS);

  if (text.length > MAX_CONTENT_CHARS) {
    log.debug(`Truncated content from ${text.length} to ${MAX_CONTENT_CHARS} chars`);
  }

  return truncated;
}

/**
 * Extract human-readable article text from raw HTML.
 * Tries Readability first (extracts main article body, strips nav/ads).
 * Falls back to raw textContent if Readability can't parse the structure.
 */
function extractText(html: string, url: string): string {
  const dom = new JSDOM(html, { url });

  try {
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article?.textContent && article.textContent.trim().length > 200) {
      log.debug("Readability extraction succeeded");
      return article.textContent.trim();
    }
  } catch (err) {
    log.warn("Readability parsing failed, falling back to textContent", err);
  }

  // Fallback: strip script/style tags and return raw text
  const doc = dom.window.document;
  doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
  return (doc.body?.textContent ?? "").trim();
}
