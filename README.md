# FreeTurtle

An open-source framework for deploying autonomous AI CEOs that run onchain businesses.

FreeTurtle gives you an AI agent that operates as your project's CEO — it posts to Farcaster, responds to mentions, writes strategy briefs, manages GitHub repos, queries databases, and chats with you via Telegram. It reads smart contracts, tracks wallet balances, and performs onchain actions on Base: creating bounty tasks via a TaskBoard contract, funding them with ETH, reviewing submissions, and paying contributors — all autonomously. Everything it knows and does is stored as readable files (Markdown and JSON) that both you and the agent can edit. You define its identity, voice, and goals in a single `soul.md` file, set up cron schedules and tool access in `config.md`, and let it run. It modifies itself when you ask, requires your approval for anything destructive, and logs every action to an audit trail.

> **Beta software.** FreeTurtle is under active development. Expect bugs, breaking changes, and rough edges. If you run into issues, please open a GitHub issue or reach out directly.

## Contact

- **X:** [@mattleefc](https://x.com/mattleefc)
- **Farcaster:** [@mattlee](https://warpcast.com/mattlee)

## Getting Started

### 1. Set Up a Server

FreeTurtle is a long-running daemon — it needs a machine that stays on 24/7.

#### Local (recommended for getting started)

Run FreeTurtle on hardware you already own. No cloud account needed, no ongoing costs, and your data stays on your machine.

- **Your existing Mac or Linux machine** — just leave it running. Works great for testing or if your machine is always on.
- **Raspberry Pi** — a $35-80 single-board computer that runs headless, draws ~5W of power, and is perfect for always-on daemons. A Pi 4 (4GB+) or Pi 5 handles FreeTurtle easily. Install the 64-bit Raspberry Pi OS Lite, plug in ethernet, and SSH in.
- **Any old laptop or desktop** — install Ubuntu Server and repurpose it as a dedicated FreeTurtle box.

#### Cloud

If you want something accessible from anywhere without keeping a local machine running:

- **[Oracle Cloud](docs/oracle-cloud-setup.md)** — 2 CPUs, 12 GB RAM, always free ARM instance. Our [setup guide](docs/oracle-cloud-setup.md) walks through everything from account creation to SSH.
- **[Railway](https://railway.app)** — deploy from a repo or Dockerfile, easy scaling, free trial available.
- **[Fly.io](https://fly.io)** — runs containers close to users globally, generous free tier.
- **[DigitalOcean](https://digitalocean.com)** — straightforward VPS starting at $4/mo.
- **[Hostinger](https://hostinger.com)** — budget-friendly VPS plans.

> **New to servers?** The [Oracle Cloud setup guide](docs/oracle-cloud-setup.md) walks through everything from account creation to SSH. Paste it into an AI chat (ChatGPT, Claude, etc.) and ask it to guide you step by step.

### 2. Create Accounts for Your CEO

Before running init, create a separate identity for your CEO:

- **Google account** — use it to sign up for everything below
- **Farcaster** — the account your CEO will post from
- **Neynar** — API access for Farcaster (sign up at [dev.neynar.com](https://dev.neynar.com))
- **GitHub** (optional) — if your CEO will manage repos, give it its own account

The CEO is effectively a team member who needs its own accounts.

### 3. Install and Run

```bash
# Install Node.js and pnpm (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm

# Install FreeTurtle
sudo pnpm install -g freeturtle

# Set up your CEO (interactive wizard)
freeturtle init

# Start the daemon
freeturtle start

# Keep it running after reboot (macOS or Linux)
freeturtle install-service
```

The setup wizard walks you through naming your AI CEO, picking an LLM provider, connecting Farcaster, Telegram, GitHub, and more.

### 4. Set Up Webhooks (optional)

If you want your CEO to auto-respond to Farcaster mentions and replies, you need webhooks. This requires HTTPS, which means a domain and a reverse proxy.

The quickest path:
1. Get a free subdomain at [duckdns.org](https://www.duckdns.org)
2. Install Caddy (`sudo apt install -y caddy`) — it handles HTTPS automatically
3. Run `freeturtle webhooks` to register with Neynar

See the [Oracle Cloud setup guide](docs/oracle-cloud-setup.md#setting-up-webhooks-farcaster-mentionsreplies) for full instructions.

## How It Works

FreeTurtle is a Node.js daemon that mostly sleeps and wakes up when:

1. A **cron timer** fires (e.g. "post to Farcaster every 8 hours")
2. A **heartbeat** fires (e.g. "check if anything needs attention every 30 minutes")
3. The **founder sends a message** via Terminal or Telegram
4. A **webhook event** arrives (e.g. someone mentions the CEO on Farcaster)

All four route to the same **task runner**, which:

1. Loads `soul.md` (the CEO's identity and voice)
2. Loads recent memory (posting log, post queue)
3. Collects tools from active modules
4. Calls the LLM (Claude or OpenAI)
5. Checks policy allowlists and approval requirements before executing tools
6. Handles tool calls in a loop (with automatic retry on transient failures)
7. Logs every tool call to the audit trail
8. Persists results to workspace files

```
┌──────────────────────────────────────────────────────┐
│                   FreeTurtle Daemon                    │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────┐ ┌──────────┐ │
│  │ Scheduler │  │ Channels │  │  IPC  │ │ Webhooks │ │
│  │  (cron)   │  │ Terminal │  │ send/ │ │ Farcaster│ │
│  │           │  │ Telegram │  │approve│ │ mentions │ │
│  └─────┬─────┘  └────┬─────┘  └───┬───┘ └────┬─────┘ │
│        │             │            │           │      │
│        └──────┬──────┘────────────┘───────────┘      │
│               ▼                                      │
│        ┌──────────────┐                              │
│        │  Task Runner  │                             │
│        │  soul + memory│                             │
│        │  + LLM + tools│                             │
│        └──────┬───────┘                              │
│               ▼                                      │
│  ┌─────────────────────────────────────┐             │
│  │      Policy ─► Approval ─► Retry   │             │
│  │  allowlists   founder gate  backoff  │             │
│  └──────────────────┬──────────────────┘             │
│                     ▼                                │
│  ┌───────────────────────────────────────────────┐   │
│  │                  Modules                       │   │
│  │ Workspace│Farcaster│Database│ GitHub │ Onchain │   │
│  └───────────────────────────────────────────────┘   │
│                     │                                │
│               ┌─────▼─────┐                          │
│               │ Audit Log │                          │
│               └───────────┘                          │
└──────────────────────────────────────────────────────┘
```

## CLI Commands

```bash
freeturtle init              # Set up a new AI CEO
freeturtle start             # Start the daemon
freeturtle start --chat      # Start with interactive terminal chat
freeturtle status            # Show daemon status
freeturtle send "message"    # Send a message to the running CEO
freeturtle setup             # Reconfigure LLM provider
freeturtle connect farcaster # Set up Farcaster signer
freeturtle webhooks          # Set up Neynar webhooks (mentions, replies, watched users/channels)
freeturtle approvals         # List pending approval requests
freeturtle approve <id>      # Approve a pending action
freeturtle reject <id>       # Reject a pending action
freeturtle health            # Verify daemon is healthy
freeturtle update            # Update to the latest version
freeturtle install-service   # Install as a system service (launchd on macOS, systemd on Linux)
```

## Modules

### Workspace (always loaded)

Read and write files in the CEO's own workspace. This is how the CEO modifies itself — updating its identity, voice, goals, config, memory, and notes.

| Tool | Description |
|------|-------------|
| `read_file` | Read any file in the workspace |
| `write_file` | Write or overwrite a file (soul.md/config.md/.env require approval) |
| `edit_file` | Find-and-replace within a file (soul.md/config.md/.env require approval) |
| `list_files` | List files and directories |

All paths are sandboxed to `~/.freeturtle/` — the CEO cannot escape its workspace.

### Farcaster

Post and read casts via the Neynar API.

| Tool | Description |
|------|-------------|
| `post_cast` | Post a cast, optionally to a channel with embeds |
| `read_channel` | Read recent casts from a channel |
| `read_mentions` | Read notifications and mentions |
| `reply_to_cast` | Reply to a cast by hash |
| `delete_cast` | Delete a cast (requires founder approval) |

**Env:** `NEYNAR_API_KEY`, `FARCASTER_SIGNER_UUID`, `FARCASTER_FID`

#### Webhooks

FreeTurtle can listen for Farcaster events in real-time via Neynar webhooks. Set up during `freeturtle init` or later with `freeturtle webhooks`.

Supported event types:
- **Mentions** — someone @'s your CEO
- **Replies** — someone replies to your CEO's casts
- **Specific users** — watch casts from certain accounts
- **Channels** — watch new casts in Farcaster channels

The daemon runs a built-in HTTP server that receives webhook events, filters spam (Neynar user score), rate-limits per user, deduplicates, and routes events through the CEO.

**Env:** `WEBHOOK_ENABLED`, `WEBHOOK_PORT`, `NEYNAR_WEBHOOK_SECRET` (optional), `WEBHOOK_WATCH_FIDS` (optional)

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
| `commit_file` | Create or update a file via commit (main branch requires approval) |

**Env:** `GITHUB_TOKEN`

### Onchain

Read smart contracts, balances, and transactions on Base.

| Tool | Description |
|------|-------------|
| `read_contract` | Read data from a smart contract |
| `get_balance` | Get ETH balance of an address |
| `get_transactions` | Get recent transactions (requires BaseScan key) |

**Env:** `RPC_URL`, `BLOCK_EXPLORER_API_KEY` (optional)

## Configuration

FreeTurtle stores everything in `~/.freeturtle/`:

```
~/.freeturtle/
├── soul.md              # CEO identity and voice
├── config.md            # Modules, cron schedules, LLM settings
├── .env                 # API keys and secrets
└── workspace/
    ├── HEARTBEAT.md     # Heartbeat checklist
    ├── memory/
    │   ├── posting-log.json
    │   ├── post-queue.json
    │   └── session-notes/
    ├── audit/           # Daily audit logs
    ├── approvals/       # Pending/resolved approval requests
    └── strategy/
```

### soul.md

Defines who your CEO is — name, voice, knowledge, goals, and boundaries. Written in plain Markdown. Edit it anytime.

### config.md

Controls the daemon. Markdown format:

```markdown
## LLM
- provider: claude_api
- model: claude-sonnet-4-5
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

## Policy
### github
- approval_required_branches: main

### approvals
- timeout_seconds: 300
- fail_mode: deny
```

The setup wizard (`freeturtle setup`) supports five LLM providers: Claude Pro/Max (subscription), ChatGPT Plus/Pro (subscription), Anthropic API, OpenAI API, and OpenRouter.

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

## Self-Modification

FreeTurtle CEOs can modify their own behavior at runtime. Everything that defines the CEO — identity, voice, goals, config, memory — is a file in the workspace, and the CEO has tools to read and write those files.

Examples of what you can tell your CEO:

- **"Be more direct and honest"** — CEO edits the Voice section of `soul.md` (requires your approval)
- **"Remember that @rish posts interesting stuff"** — CEO writes a note to `workspace/memory/notes.md`
- **"Change posting to every 4 hours"** — CEO edits the cron schedule in `config.md` (requires approval, takes effect on restart)
- **"Add a goal about growing the Discord"** — CEO edits the Goals section of `soul.md` (requires approval)
- **"Write a brief on this week's engagement"** — CEO writes to `workspace/strategy/`

Changes to core files (`soul.md`, `config.md`, `.env`) always require founder approval. Memory and notes writes go through freely.

## Policy & Approvals

FreeTurtle enforces per-module allowlists and requires founder approval for destructive actions.

### Policy Config

Add a `## Policy` section to `config.md`:

```markdown
## Policy
### github
- allowed_repos: myorg/myrepo, myorg/other-repo
- allowed_paths: strategy/, docs/
- approval_required_branches: main

### farcaster
- allowed_channels: tortoise, music

### onchain
- allowed_contracts: 0x1234...
- allowed_read_functions: balanceOf, totalSupply

### approvals
- timeout_seconds: 300
- fail_mode: deny
```

**Allowlist rules:**
- Not set — allow all (no restriction)
- Empty list — deny everything
- Populated list — only allow listed values

### Approval Flow

Some actions require founder approval before execution:

- `delete_cast` — always requires approval
- `commit_file` to a protected branch (default: `main`) — requires approval
- `write_file` / `edit_file` to `soul.md`, `config.md`, or `.env` — requires approval

When approval is needed, FreeTurtle notifies you via Telegram/terminal with the approval ID. You can then:

```bash
freeturtle approvals          # See pending requests
freeturtle approve <id>       # Allow the action
freeturtle reject <id>        # Block the action
```

If no decision is made within the timeout (default 5 minutes), the action is denied (configurable via `fail_mode`).

### Audit Log

Every task run is logged to `workspace/audit/YYYY-MM-DD/{runId}.json` with:
- Tool calls made (with redacted inputs)
- Duration, retries, approval decisions
- Success/error status

### Reliability

All external API calls (Neynar, GitHub, Postgres, BaseScan, RPC) are wrapped with:
- Automatic retry with exponential backoff + jitter
- Timeout protection (30s default)
- Smart error classification (retry on 429/5xx/network errors, fail fast on 4xx)

## Safety Architecture

FreeTurtle is designed to be safe to run locally:

- **No shell execution** — the CEO cannot run arbitrary commands
- **Sandboxed workspace** — file access is restricted to `~/.freeturtle/`, path traversal is blocked
- **Protected self-modification** — changes to soul.md, config.md, and .env require founder approval
- **Closed tool set** — only the tools defined by enabled modules are available
- **Policy allowlists** — per-module restrictions on repos, paths, channels, contracts
- **Founder approval** — destructive actions require explicit approval before execution
- **Read-only database** — all SQL runs in read-only transactions
- **Read-only onchain** — no wallet, no signing, no transactions
- **Founder-only chat** — Telegram only responds to the configured founder ID
- **Webhook spam filtering** — Neynar user score, per-user rate limiting, duplicate detection
- **Audit trail** — every tool call is logged with redacted inputs

## Security Best Practices

### Secrets

Your `.env` file contains API keys and tokens. FreeTurtle automatically sets it to `chmod 600` (read-only by the file owner) when writing it.

- **Never commit `.env` to git.** It's in `.gitignore` by default — don't override this.
- **Never paste secrets into AI coding tools.** Tools like Claude Code, Codex, Cursor, and Copilot may log or transmit your input. If an AI tool asks you to paste an API key, token, or recovery phrase into chat — don't. Enter secrets only through FreeTurtle's setup wizard, which writes directly to `.env` on your local machine.
- **Rotate keys if exposed.** If a secret is accidentally committed, posted, or shared, revoke it immediately and generate a new one. Treat every key as compromised the moment it leaves your machine.
- **Your Farcaster recovery phrase is the most sensitive secret.** It controls the entire account. FreeTurtle only uses it once during `connect farcaster` to sign a key request locally — it is never stored or transmitted.

### SSH Keys

- Download your SSH private key when creating the instance — you can't retrieve it later
- Store it securely (e.g. `~/.ssh/`) with `chmod 400`
- Don't share it or commit it to any repository
- If lost, you lose access to the server

### Git

- `.env` is in `.gitignore` — don't remove it
- If you version-control your `~/.freeturtle/` config, exclude `.env`
- If you accidentally commit secrets, rotate them immediately — git history is permanent

### Firewall

- Oracle Cloud has two firewalls: the cloud security list AND the OS-level iptables
- Only open ports you actually need
- SSH (port 22) is open by default — everything else is closed
- See the [Oracle setup guide](docs/oracle-cloud-setup.md) for details

### Cloud Provider Access

Your cloud provider (Oracle, Railway, Fly.io, DigitalOcean, etc.) has full access to the underlying infrastructure — they can technically read any file on your VM. This is true of all cloud computing and is covered by their terms of service. For most use cases this is fine. If this is unacceptable for your threat model, run FreeTurtle on hardware you physically control (e.g. a Raspberry Pi or a spare laptop).

## The Two-Turtle Vision (v0.2)

The current v0.1 is a single-process CEO. v0.2 will split it into two:

- **Inner Turtle** — has all the tools, writes to an outbox, never posts directly
- **Outer Turtle** — reads the outbox, reviews actions, executes approved ones

This creates **security by architecture, not by instruction**. The inner turtle can reason freely without risk because it literally cannot post or commit — only propose. The outer turtle is a simple approval layer.

This pattern, proven by tortOS, means you can give your CEO powerful tools without worrying about rogue actions.

## tortOS — Proof of Concept

FreeTurtle generalizes the patterns proven by [tortOS](https://tortoise.xyz), which runs the Tortoise music platform on Farcaster/Base:

- Autonomous posting and community engagement
- Weekly strategy briefs
- Database queries for platform analytics
- GitHub issue management
- All controlled by a soul config and readable memory files

tortOS has been running autonomously for months. FreeTurtle packages those patterns into a framework anyone can use.

## Roadmap

- **v0.1** — Single-process CEO (this release)
- **v0.2** — Two-turtle architecture (inner/outer split, outbox, approval queue)
- **v0.3** — XMTP integration (public-facing DMs)
- **Future** — Hosted dashboard, multi-CEO management

## License

Apache 2.0 — see [LICENSE](./LICENSE).
