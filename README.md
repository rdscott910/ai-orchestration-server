# AI Orchestration Server

A unidirectional Telegram → Server → iCloud/OneDrive bridge for AI-assisted workflows on macOS, built with Node.js 24 and TypeScript.

```
Telegram (Input) ──► Server (Logic) ──► SYNC_DIR (Output for iPad)
```

## Architecture

```
src/
  index.ts           Entry point: boots bot + graceful shutdown
  config.ts          Zod-validated .env loader (fail-fast)
  bot.ts             grammY bot with auth guard + command routing
  queue.ts           p-queue wrapper (concurrency=1, FIFO)
  skills/
    observer.ts      URL → scrape → Haiku 3-bullet summary → Inbox.md
    executor.ts      /exec → CLI agent → Reviews/ report
  services/
    scraper.ts       Readability + JSDOM text extraction
    anthropic.ts     Anthropic SDK (Haiku for routing, Sonnet for coding)
    shell.ts         child_process.execFile with 5-min SIGTERM→SIGKILL timeout
    sync.ts          Path-traversal-safe file writer
  utils/
    sanitize.ts      Shell metacharacter stripper
    logger.ts        Structured leveled console logger
```

## Requirements

- Node.js >= 24
- A Telegram bot token (create via [@BotFather](https://t.me/BotFather))
- An Anthropic API key
- Cursor CLI at `/usr/local/bin/cursor` (or configured in `.env`)
- Optional: [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) for `/exec claude` routing

## Setup

```bash
# 1. Clone and install
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — fill in all required values

# 3. Run in development mode (auto-restarts on file changes)
npm run dev

# 4. Or build and run in production
npm run build && npm start
```

## Commands

| Command | Description |
|---------|-------------|
| `/observe <url>` | Scrape URL and append 3-bullet summary to `SYNC_DIR/Inbox.md` |
| `/exec <instruction>` | Run instruction via Cursor CLI; write diff report to `SYNC_DIR/Reviews/` |
| `/exec cursor <instruction>` | Explicit Cursor routing |
| `/exec claude <instruction>` | Route to Claude Code CLI (requires `CLAUDE_CLI_PATH` set) |
| `/status` | Show uptime and queue depth |

## Security Design

| Module | Threat | Defense |
|--------|--------|---------|
| `config.ts` | Missing secrets at runtime | Zod fail-fast at boot |
| `bot.ts` | Unauthorized shell access | User ID allowlist middleware |
| `queue.ts` | Git state corruption | p-queue concurrency=1 (strict FIFO) |
| `scraper.ts` | SSRF / protocol injection | URL constructor + http/https-only allowlist |
| `shell.ts` | Shell injection | `execFile` (no shell) as primary defense |
| `shell.ts` | Zombie processes | 5-min timeout → SIGTERM → SIGKILL |
| `sync.ts` | Path traversal | Resolved path must start with `SYNC_DIR` |
| `anthropic.ts` | Token/cost explosion | Hard `max_tokens` cap + input truncation |

## Repository Audit

This repository now includes a maintainability and security audit in
[`ARCHITECTURE_AUDIT.md`](./ARCHITECTURE_AUDIT.md). Read it before exposing this
project beyond a single-user local machine: it calls out the highest-risk issues,
over-engineered areas, and the parts that are currently relying on convention
instead of enforcement.

## Output Files

- **`SYNC_DIR/Inbox.md`** — Append-only log of Observer summaries with ISO timestamps
- **`SYNC_DIR/Reviews/YYYYMMDD-HHmmss-<slug>.md`** — Per-execution diff reports

## Installing Claude Code CLI (optional)

```bash
npm install -g @anthropic-ai/claude-code
which claude  # Copy this path into CLAUDE_CLI_PATH in .env
```
