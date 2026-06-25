# commodity-research-bot

Monitors precious metal prices on Pyth Network and automatically researches significant moves using live web intelligence via [Gordon](https://withgordon.ai) x402 payments.

## How it works

1. **Pyth** polls XAU, XAG, XPD, XPT prices every 60 seconds via Hermes
2. A move ≥1% triggers research
3. **Gordon** pays [StableEnrich](https://stableenrich.dev) (Exa AI-powered live web search) for breaking news and analyst commentary explaining the move
4. **Optionally**, Gordon also calls [Untitled Financial](https://intelligence.untitledfinancial.com) for structured commodity/macro/currency stress signals
5. Claude synthesises a 3–5 sentence research brief and fires an alert

Two research modes:
- `agent` — Claude autonomously picks which endpoints to call (default)
- `scripted` — fixed sequential calls to StableEnrich → Untitled Financial

## Stack

| Component | Purpose |
|-----------|---------|
| [Pyth Hermes](https://hermes.pyth.network) | On-chain price oracles |
| [Gordon SDK](https://withgordon.ai) | x402 micropayment orchestration |
| [StableEnrich / Exa](https://stableenrich.dev) | Live web search (primary intelligence, ~$0.01/call) |
| [Untitled Financial](https://intelligence.untitledfinancial.com) | Structured stress signals (optional enrichment) |
| [Claude claude-opus-4-5](https://anthropic.com) | Research synthesis |
| [MCP Pyth server](src/mcp-pyth.ts) | Exposes Pyth prices as MCP tools for Cursor agents |

## Setup

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, GORDON_AGENT_API_KEY, GORDON_AGENT_API_SECRET
npm install
```

> **Note**: `@withgordon/core` is resolved from a local path (`../gordon/new-gordon/packages/core`). Clone the [Gordon repo](https://github.com/cyrus19901/gordon) alongside this one, or update `package.json` to point to the published npm version.

Enable **stableenrich** (required) and optionally **untitledfinancial** in your Gordon dashboard under Agent → Services.

## Running

```bash
# Watch mode — polls Pyth every 60s, researches moves ≥1%
npm run dev

# One-shot — same but exits after the first tick
npm start

# Smoke-test Gordon payments without Anthropic key
GORDON_AGENT_API_KEY=... GORDON_AGENT_API_SECRET=... npx tsx scripts/test-endpoints.ts

# Full data-fetch flow test (simulates a gold move, skips Claude synthesis)
GORDON_AGENT_API_KEY=... GORDON_AGENT_API_SECRET=... npx tsx scripts/test-full-flow.ts
```

## MCP Pyth server

`src/mcp-pyth.ts` is a standalone MCP server that exposes live Pyth prices as tools (`get_metal_prices`, `get_price_move`). Add to `~/.cursor/mcp.json`:

```json
"pyth-metals": {
  "type": "stdio",
  "command": "node",
  "args": ["--import", "tsx/esm", "/path/to/commodity-research-bot/src/mcp-pyth.ts"]
}
```

See `CURSOR_PROMPT.md` for a ready-to-paste Cursor agent prompt that uses both the Pyth MCP and Gordon to research live metal moves.

## Cost per research cycle

| Source | Cost |
|--------|------|
| StableEnrich (always) | ~$0.01 |
| Untitled Financial commodity + macro + currency | ~$0.65 (optional) |
| Untitled Financial cascade (moves ≥2% only) | ~$0.75 (optional) |
| Claude synthesis | ~$0.01–$0.05 |
