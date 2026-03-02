# FreeTurtle Config

## LLM
- provider: claude_api
- model: claude-sonnet-4-5-20250929
- max_tokens: 4096
- api_key_env: ANTHROPIC_API_KEY
- oauth_token_env: ANTHROPIC_AUTH_TOKEN

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
