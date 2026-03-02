# FreeTurtle Config

## LLM
- provider: anthropic
- model: claude-sonnet-4-5-20250929
- max_tokens: 4096

## Cron
### post
- schedule: 0 */8 * * *
- prompt: Check for any queued posts. If there's a new upload worth sharing, share it. Otherwise write an original post.

### strategy
- schedule: 0 4 * * 0
- prompt: Analyze posting history, engagement, platform data. Search the web for relevant signals. Write a strategy brief.
- output: strategy/{{date}}.md

## Channels
### telegram
- enabled: true

### terminal
- enabled: true

## Modules
### farcaster
- enabled: true
- channel: tortoise

### database
- enabled: false

### github
- enabled: false

### onchain
- enabled: false
