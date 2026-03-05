# FreeTurtle

An open-source framework for deploying autonomous AI operators that run onchain businesses.

Built by the team behind [tortOS](https://tortoise.xyz) — the system that runs **Tortoise**, the most-used music platform on Farcaster/Base ($34K+ value, 200+ artists).

## Quick Start

```bash
pnpm install -g freeturtle
freeturtle init
freeturtle start
```

The setup wizard walks you through everything: naming your AI CEO, connecting Farcaster, Telegram, GitHub, a database, and onchain data.

## What It Does

FreeTurtle gives you an autonomous AI operator that:

- **Posts to Farcaster** on a schedule (or on demand)
- **Chats with you** via Terminal or Telegram
- **Writes strategy briefs** weekly
- **Queries databases** (read-only Postgres)
- **Creates GitHub issues, writes code and submits pull requests**
- **Reads onchain data** (balances, contracts, transactions on Base)
- **Stores identity and memory** as readable Markdown and JSON files

## How It Works

FreeTurtle is a Node.js daemon that mostly sleeps and wakes up when:

1. A **cron timer** fires (e.g. "post to Farcaster every 8 hours")
2. A **heartbeat** fires (e.g. "check if anything needs attention every 30 minutes")
3. The **owner sends a message** via Terminal or Telegram

All three route to the same **task runner**, which:

1. Loads `soul.md` (the operator's identity and voice)
2. Loads recent memory (posting log, post queue)
3. Collects tools from active modules
4. Calls the LLM (Claude or OpenAI)
5. Handles tool calls in a loop
6. Persists results to workspace files

```
┌─────────────────────────────────────────┐
│              FreeTurtle Daemon           │
│                                         │
│  ┌──────────┐  ┌──────────┐  ┌───────┐ │
│  │ Scheduler │  │ Channels │  │  IPC  │ │
│  │  (cron)   │  │ Terminal │  │ send  │ │
│  │           │  │ Telegram │  │       │ │
│  └─────┬─────┘  └────┬─────┘  └───┬───┘ │
│        │             │            │     │
│        └──────┬──────┘────────────┘     │
│               ▼                         │
│        ┌──────────────┐                 │
│        │  Task Runner  │                │
│        │  soul + memory│                │
│        │  + LLM + tools│                │
│        └──────┬───────┘                 │
│               ▼                         │
│  ┌──────────────────────────────┐       │
│  │         Modules              │       │
│  │ Farcaster │ Database│ GitHub │       │
│  │ Onchain   │  XMTP   │       │       │
│  └──────────────────────────────┘       │
└─────────────────────────────────────────┘
```

## Modules

### Farcaster

Post and read casts via the Neynar API.

| Tool | Description |
|------|-------------|
| `post_cast` | Post a cast, optionally to a channel with embeds |
| `read_channel` | Read recent casts from a channel |
| `read_mentions` | Read notifications and mentions |
| `reply_to_cast` | Reply to a cast by hash |

**Env:** `NEYNAR_API_KEY`, `FARCASTER_SIGNER_UUID`, `FARCASTER_FID`

### Database

Query a PostgreSQL database (read-only).

| Tool | Description |
|------|-------------|
| `query_database` | Execute a read-only SQL query (SELECT only) |
| `list_tables` | List all tables with column names and types |

**Env:** `DATABASE_URL`

### GitHub

Create issues, list issues, and commit files.

| Tool | Description |
|------|-------------|
| `create_issue` | Create an issue on a repo |
| `list_issues` | List issues for a repo |
| `commit_file` | Create or update a file via commit |

**Env:** `GITHUB_TOKEN`

### Onchain

Read smart contracts, balances, and transactions on Base.

| Tool | Description |
|------|-------------|
| `read_contract` | Read data from a smart contract |
| `get_balance` | Get ETH balance of an address |
| `get_transactions` | Get recent transactions (requires BaseScan key) |

**Env:** `RPC_URL`, `BASESCAN_API_KEY` (optional)

## Configuration

FreeTurtle stores everything in `~/.freeturtle/`:

```
~/.freeturtle/
├── soul.md              # Operator identity and voice
├── config.md            # Modules, cron schedules, LLM settings
├── .env                 # API keys and secrets
└── workspace/
    ├── HEARTBEAT.md     # Heartbeat checklist
    ├── memory/
    │   ├── posting-log.json
    │   ├── post-queue.json
    │   └── session-notes/
    └── strategy/
```

### soul.md

Defines who your operator is — name, voice, knowledge, goals, and boundaries. Written in plain Markdown. Edit it anytime.

### config.md

Controls the daemon. Markdown format:

```markdown
## LLM
- provider: claude_api
- model: claude-sonnet-4-5-20250514
- max_tokens: 4096

## Cron
### post
- schedule: 0 */8 * * *
- prompt: Check for queued posts. If there's something worth sharing, share it.

### strategy
- schedule: 0 4 * * 0
- prompt: Analyze posting history and engagement. Write a strategy brief.
- output: strategy/{{date}}.md

## Modules
### farcaster
- enabled: true

### database
- enabled: true
```

### .env

API keys. Generated by `freeturtle init`. Never committed to git.

```
ANTHROPIC_API_KEY=sk-...
NEYNAR_API_KEY=...
FARCASTER_SIGNER_UUID=...
FARCASTER_FID=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_OWNER_ID=...
GITHUB_TOKEN=...
DATABASE_URL=postgres://...
RPC_URL=https://mainnet.base.org
```

## CLI Commands

```bash
freeturtle init              # Set up a new operator
freeturtle start             # Start the daemon (terminal chat by default)
freeturtle start --chat      # Start with interactive chat mode
freeturtle status            # Show daemon status
freeturtle send "message"    # Send a message to the running operator
freeturtle setup             # Reconfigure LLM provider
freeturtle connect farcaster # Set up Farcaster signer
```

## Hosting

We recommend [Oracle Cloud's free ARM instance](docs/oracle-cloud-setup.md) — 4 CPUs, 24 GB RAM, always free. The setup guide walks through account creation, instance setup, networking, and installing FreeTurtle as a system service.

```bash
# On your server
pnpm install -g freeturtle
freeturtle init
freeturtle start
freeturtle install-service  # auto-restart on reboot
```

## Before You Begin

**Create a separate account for your operator.** Start with a Google account, then use it to sign up for:

- Farcaster (the account your operator will post from)
- Neynar (API access for Farcaster)
- GitHub (if your operator will manage repos)
- Any other services your operator needs

The operator is effectively a team member who needs its own accounts. Identity separation keeps things clean.

## Safety Architecture

FreeTurtle is designed to be safe to run locally:

- **No shell execution** — the operator cannot run arbitrary commands
- **Closed tool set** — only the tools defined by enabled modules are available
- **Read-only database** — all SQL runs in read-only transactions
- **Read-only onchain** — no wallet, no signing, no transactions
- **Owner-only chat** — Telegram only responds to the configured owner ID

## The Two-Turtle Vision (v0.2)

The current v0.1 is a single-process operator. v0.2 will split it into two:

- **Inner Turtle** — has all the tools, writes to an outbox, never posts directly
- **Outer Turtle** — reads the outbox, reviews actions, executes approved ones

This creates **security by architecture, not by instruction**. The inner turtle can reason freely without risk because it literally cannot post or commit — only propose. The outer turtle is a simple approval layer.

This pattern, proven by tortOS, means you can give your operator powerful tools without worrying about rogue actions.

## tortOS — Proof of Concept

FreeTurtle generalizes the patterns proven by [tortOS](https://tortoise.xyz), which runs the Tortoise music platform on Farcaster/Base:

- Autonomous posting and community engagement
- Weekly strategy briefs
- Database queries for platform analytics
- GitHub issue management
- All controlled by a soul config and readable memory files

tortOS has been running autonomously for months. FreeTurtle packages those patterns into a framework anyone can use.

## Roadmap

- **v0.1** — Single-process operator (this release)
- **v0.2** — Two-turtle architecture (inner/outer split, outbox, approval queue)
- **v0.3** — XMTP integration (public-facing DMs)
- **Future** — Hosted dashboard, multi-operator management

## License

Apache 2.0 — see [LICENSE](./LICENSE).
