import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("anthropic");

// Lazy-initialized client — created once on first use to avoid
// instantiating before config.load() has run.
let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: config.get().ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Summarize article text into exactly 3 bullet points using Claude 3.5 Haiku.
 *
 * max_tokens=300 is a hard cap. Without it, a large-context model could generate
 * thousands of tokens for a single summary, causing runaway API costs.
 * The system prompt constrains output to 3 bullets, so 300 tokens is generous.
 */
export async function summarize(articleText: string): Promise<string> {
  log.info("Requesting summary from Claude 3.5 Haiku");

  const message = await getClient().messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 300,
    system:
      "You are a concise research assistant. Summarize the provided article in exactly 3 bullet points. " +
      "Each bullet must be one sentence. Begin each bullet with '• '. Return only the 3 bullets, nothing else.",
    messages: [
      {
        role: "user",
        content: `Article text:\n\n${articleText}`,
      },
    ],
  });

  const block = message.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Anthropic API returned unexpected response structure");
  }

  log.debug(`Summary received (${block.text.length} chars, ${message.usage.output_tokens} tokens)`);
  return block.text;
}

/**
 * Route a coding instruction to Claude 3.7 Sonnet for high-quality code generation.
 * Returns the model's response text for use in review file generation.
 *
 * max_tokens=4096 allows substantial code output while preventing runaway generation.
 */
export async function routeCode(instruction: string): Promise<string> {
  log.info("Routing instruction to Claude 3.7 Sonnet");

  const message = await getClient().messages.create({
    model: "claude-3-7-sonnet-latest",
    max_tokens: 4096,
    system:
      "You are an expert software engineer. Follow the instruction precisely. " +
      "Return only the code or explanation requested, without preamble.",
    messages: [
      {
        role: "user",
        content: instruction,
      },
    ],
  });

  const block = message.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Anthropic API returned unexpected response structure");
  }

  log.debug(`Code response received (${block.text.length} chars, ${message.usage.output_tokens} tokens)`);
  return block.text;
}
