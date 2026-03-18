---
name: visual-debug
description: Debug FreeTurtle from Telegram screenshots — diagnose issues, trace to source code, and fix
user-invocable: true
---

# Visual Debug

Debug FreeTurtle issues from Telegram chat screenshots. Accepts screenshots showing errors, unexpected behavior, or broken output, then diagnoses the root cause and applies a fix.

## Usage

The user will provide one or more screenshots (usually from Telegram) and optionally a brief description. Follow the steps below.

## Step 1: Read the Screenshot

Carefully examine the screenshot(s). Extract:

- **What was said/shown** — the exact message text, error output, or unexpected behavior visible in the chat
- **Who sent it** — the bot (FreeTurtle CEO) or the user (founder)
- **Timing clues** — timestamps, message ordering, context about what triggered the issue
- **Error type** — categorize as one or more of (screenshots can reveal compound failures — assign multiple types if needed):
  - `bad-output` — bot responded but content is wrong, malformed, or off-voice
  - `no-response` — bot didn't respond when it should have
  - `crash` — error message visible or bot sent an error reply
  - `wrong-action` — bot took an action it shouldn't have (posted wrong thing, etc.)
  - `delivery-fail` — message wasn't delivered or was truncated
  - `timing` — cron didn't fire, heartbeat missed, action happened at wrong time
  - `config-poisoning` — bot edited its own config (config.md, soul.md, .env) in a way that broke the system or caused unexpected behavior. Look for approval messages in the chat history showing what was changed.

## Step 2: Route to Source Code

Use this routing map to identify which files to inspect based on the error type and visible symptoms:

### Message Handling & Responses
| Symptom | Primary Files | Secondary Files |
|---------|--------------|-----------------|
| Bot response is wrong/off-voice | `src/soul.ts`, `~/.freeturtle/soul.md` | `src/runner.ts` (buildSystemPrompt) |
| Bot didn't respond (single message) | `src/channels/telegram.ts` | `src/runner.ts` (runMessage), `src/daemon.ts` |
| Bot didn't respond (multiple messages over hours) | `src/daemon.ts` (crash, uncaughtException handler) | `src/scheduler.ts` (invalid cron crash), `src/channels/telegram.ts` |
| Bot sent error text | `src/runner.ts` (runMessage catch block) | `src/llm.ts` (agentLoop) |
| Approval stuck/not working | `src/approval.ts` | `src/channels/telegram.ts` (approval intercept) |
| Conversation context lost | `src/runner.ts` (conversationHistory) | `src/channels/telegram.ts` |

### Farcaster Posts
| Symptom | Primary Files | Secondary Files |
|---------|--------------|-----------------|
| Cast content wrong/malformed | `src/modules/farcaster/client.ts` | `soul.md` voice section, `workspace/memory/post-queue.json` |
| Cast failed to post | `src/modules/farcaster/client.ts` | `src/reliability.ts`, `.env` (NEYNAR_API_KEY, FARCASTER_SIGNER_UUID) |
| Wrong channel posted to | `src/modules/farcaster/tools.ts` | `src/policy.ts` (allowed_channels) |
| Mentions/replies not working | `src/webhooks/neynar.ts`, `src/webhooks/server.ts` | `src/modules/farcaster/client.ts` |
| Duplicate posts | `workspace/memory/posting-log.json` | `src/scheduler.ts` (concurrent run guard) |

### Cron & Heartbeat
| Symptom | Primary Files | Secondary Files |
|---------|--------------|-----------------|
| Cron didn't fire | `src/scheduler.ts` | `~/.freeturtle/config.md` (Cron section) |
| Heartbeat missed | `src/heartbeat.ts` | `~/.freeturtle/config.md` (Heartbeat section), `workspace/HEARTBEAT.md` |
| Task ran but output wrong | `src/runner.ts` (runTask) | The specific cron prompt in `config.md` |
| Duplicate task runs | `src/scheduler.ts` (running guard) | `src/runner.ts` |
| Task ran despite being disabled / invalid schedule | `src/config.ts` (parseConfig, cron filtering) | `src/scheduler.ts` (cron expression validation) |

### Self-Modification & Config Poisoning
| Symptom | Primary Files | Secondary Files |
|---------|--------------|-----------------|
| Bot edited config.md and broke itself | `src/config.ts` (parseConfig) | `~/.freeturtle/config.md`, approval history in chat |
| Bot edited soul.md and changed behavior | `src/soul.ts` | `~/.freeturtle/soul.md`, `workspace/reflections/` |
| Daemon crashed after config change | `src/daemon.ts` (start, uncaughtException) | `src/scheduler.ts`, `src/config.ts` |

### Memory & State
| Symptom | Primary Files | Secondary Files |
|---------|--------------|-----------------|
| Bot forgot context | `src/memory.ts` | `workspace/memory/` daily files, `workspace/MEMORY.md` |
| Posting log wrong | `workspace/memory/posting-log.json` | `src/modules/farcaster/index.ts` |
| Post queue not clearing | `workspace/memory/post-queue.json` | Cron "post" task prompt in `config.md` |

### Telegram-Specific
| Symptom | Primary Files | Secondary Files |
|---------|--------------|-----------------|
| Message truncated | `src/channels/telegram.ts` (send method) | grammy library limits |
| Photos not processed | `src/channels/telegram.ts` (message:photo handler) | `src/runner.ts` (runMessage images param) |
| "Only talk to founder" | `src/channels/telegram.ts` (ownerId check) | `.env` (TELEGRAM_OWNER_ID) |
| Typing indicator stuck | `src/channels/telegram.ts` (startTyping) | |

### Database / GitHub / Other Modules
| Symptom | Primary Files | Secondary Files |
|---------|--------------|-----------------|
| Database query failed | `src/modules/database/` | `.env` (DATABASE_URL), `src/policy.ts` |
| GitHub action failed | `src/modules/github/` | `.env` (GITHUB_TOKEN), `src/policy.ts` |
| Gmail failed | `src/modules/gmail/` | OAuth tokens |
| Shell command failed | `src/modules/shell/` | `src/policy.ts` |

## Step 3: Gather Context

Before proposing a fix, always check:

1. **Recent audit logs** — `ls` then read files in `~/.freeturtle/workspace/audit/` for the relevant date. These show exactly what tools were called and what happened.
2. **Daily memory** — read `~/.freeturtle/workspace/memory/YYYY-MM-DD.md` for today and yesterday to understand recent system state.
3. **Session notes** — check `~/.freeturtle/workspace/memory/session-notes/` for recent task runs related to the issue.
4. **Posting log** — if the issue involves posts, read `~/.freeturtle/workspace/memory/posting-log.json` (last 20 entries).
5. **The actual source code** — read the primary files identified in Step 2.

**If workspace files are missing or empty** (no audit logs, no memory files, no posting log), don't stall — focus on the source code and the screenshot evidence directly. The workspace may not exist if the daemon crashed before writing anything, or if it's a fresh install.

## Step 4: Diagnose

Present a structured diagnosis:

```
SCREENSHOT ANALYSIS:
- What I see: [describe the visible issue]
- Error type: [from Step 1 categories]

ROOT CAUSE:
- Component: [which module/file]
- Issue: [what's wrong in the code]
- Evidence: [what in the audit logs/memory confirms this]

FILES TO FIX:
- [file path]: [what needs to change]
```

## Step 5: Fix

Apply the fix. After fixing:

1. Run `pnpm build` to verify the fix compiles
2. If there are relevant tests, run them with `pnpm test` or `npx vitest run <test-file>`
3. Briefly explain what was wrong and what you changed

## Important Notes

- The FreeTurtle workspace directory is at `~/.freeturtle/` — this is where runtime config, memory, and audit logs live (separate from this source repo)
- The source code is at `/Users/matthewlee/projects/FreeTurtle/` (this repo)
- Soul and config are markdown files parsed at runtime — syntax errors in those files can cause subtle issues
- The LLM agent loop in `src/llm.ts` handles tool calling — if the bot's behavior is wrong but the code looks fine, the issue may be in the prompt (soul.md or config.md cron prompts)
- Farcaster uses the Neynar API — check rate limits and API errors in audit logs
- Telegram uses grammy — check for API-level errors in the bot framework
