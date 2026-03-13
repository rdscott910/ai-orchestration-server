# Architecture and Security Audit

This is the cynical version, not the comforting one. The project is small enough
to be maintainable today, but a few choices are already pushing it toward "tiny
system wearing enterprise architecture clothes."

## Critical Concerns

1. **A public repo had a tracked `.env` file**
   - For a local-only tool, this is the single biggest operational risk.
   - A public repository should never rely on "I meant to gitignore that" as a
     control. The repository has to be safe by default.

2. **`npm install` was broken out of the box**
   - `@types/mozilla__readability@^0.5.3` does not exist on npm.
   - That means the repo could appear healthy to the original author while being
     unrecoverable to anyone cloning it fresh.

3. **The architecture is close to over-explaining simple behavior**
   - The code is heavily annotated and split into services/skills/utils for a
     bot that has three commands and one serialized queue.
   - That is not fatal, but it creates a maintenance trap: every future change
     must be mentally reconstructed across multiple files before a contributor
     knows where the actual behavior lives.

4. **There is a leaky abstraction between "safe CLI invocation" and "trusted CLI semantics"**
   - `execFile` prevents shell interpolation by Node.
   - But the code also assumes downstream tools like Cursor or Claude CLI will
     interpret a string argument safely. That is a different trust boundary.
   - Sanitization is useful, but the real system guarantee is "safe enough for a
     single trusted operator," not "safe for arbitrary delegated execution."

5. **Path safety depended on a POSIX-only string prefix check**
   - The previous `startsWith(syncDir + "/")` logic works on macOS/Linux but
     bakes in path separator assumptions.
   - That is exactly the kind of hidden environmental assumption that becomes
     future technical debt when the code is reused elsewhere.

6. **Queue-based serialization is doing double duty as both orchestration and safety policy**
   - `concurrency=1` prevents overlapping shell work, but it also becomes the
     de facto backpressure model, failure-isolation model, and throughput limit.
   - If you ever add more commands or users, the queue turns from a neat guardrail
     into a global bottleneck with head-of-line blocking.

7. **There is dead-weight abstraction already forming**
   - `routeCode()` in `src/services/anthropic.ts` is exported but unused.
   - Unused "future capability" code is how small repos quietly accumulate stale,
     undocumented behavior that nobody tests and everyone is afraid to delete.

8. **No test harness means the architecture is safer in theory than in practice**
   - There is no runtime test coverage for auth, sanitization boundaries, queue
     behavior, or path protections.
   - Right now, maintainability depends on the code being small and the author
     remembering the intent, not on executable guarantees.

## Specific Refactor Suggestions

These are intentionally small and skeptical. The goal is to delete fragility, not
to add another framework layer.

### 1) Keep command routing simple

Current design spreads behavior across `bot.ts`, `queue.ts`, and `skills/*`.
That is acceptable today, but do not introduce more indirection unless a second
execution strategy actually exists.

```ts
bot.command("exec", async (ctx) => {
  const args = ctx.match?.trim();
  if (!args) return ctx.reply("Usage: /exec [cursor|claude] <instruction>");
  await taskQueue.enqueue(() => execute(args, ctx));
});
```

If this stays a single-user local bot, resist adding command registries,
middleware stacks, or plugin systems. They would add ceremony without solving a
current problem.

### 2) Validate once, then pass the validated value forward

The executor previously sanitized inside `buildCliArgs()`, which made input
validation implicit and easy to forget.

```ts
const sanitizedInstruction = sanitizeForShell(parsed.instruction);
if (!sanitizedInstruction) {
  await ctx.reply("Instruction is empty after sanitization. Please use plain text.");
  return;
}

const cliArgs = buildCliArgs(parsed.target, sanitizedInstruction);
```

This is simpler because it makes the trust boundary visible in one place.

### 3) Use path APIs, not string-prefix folklore

The safe version is shorter than the clever version:

```ts
const syncDir = resolve(config.get().SYNC_DIR);
const resolved = resolve(join(syncDir, subPath));
const relativePath = relative(syncDir, resolved);

if (relativePath !== "" && (relativePath.startsWith("..") || isAbsolute(relativePath))) {
  throw new Error(`Path traversal detected: "${subPath}" resolves outside SYNC_DIR`);
}
```

That removes the hidden "this is POSIX forever" assumption.

### 4) Delete unused capabilities before adding new ones

If `routeCode()` is not part of the execution path, either wire it into a tested
flow or remove it. A 10-line deletion is often better than preserving an
imaginary extension point.

```ts
// If unused long-term, delete this instead of documenting it as a feature.
export async function routeCode(instruction: string): Promise<string> {
  // ...
}
```

### 5) Don’t confuse serialization with resilience

If higher load or multi-user operation ever matters, the system should move from
"one global queue for everything" to "small explicit quotas per command or per
user." Until then, keep the queue but document that it is a local-safety tradeoff,
not a scalable job architecture.

## The Why

- **If the tracked `.env` had contained live secrets, making the repo public could
  have turned a local convenience tool into an account-compromise event.**
- **If fresh installs fail, maintainability is fictional.** A project that only
  works on the author’s machine is already carrying hidden operational debt.
- **If safety depends on informal assumptions about downstream CLIs, then "safe
  execution" can degrade silently as those tools evolve.**
- **If queue serialization remains the only concurrency control, one slow scrape
  or hung CLI call can starve the entire bot.**
- **If unused abstractions stay in place, future contributors will preserve them
  out of caution, and the codebase will become harder to reason about without
  gaining real capability.**

## Local-Machine Security Advice

For personal use on your own machine, this project is defensible **only if** you
keep the trust model narrow:

- Run it for **your Telegram user only**.
- Treat `/exec` as equivalent to giving a local automation tool terminal-adjacent
  authority over your machine.
- Keep `SYNC_DIR` pointed at a folder you are comfortable writing to automatically.
- Rotate any bot/API keys that were ever committed, even accidentally.
- Do not promote this from "personal automation" to "shared service" without
  adding rate limits, tests, and a stricter execution model.
