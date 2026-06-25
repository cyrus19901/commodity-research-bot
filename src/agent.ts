/**
 * Claude agentic researcher — Claude drives which intelligence endpoints to
 * call and synthesises the research brief itself.
 *
 * Tools exposed to the agent:
 *   get_commodity_intelligence  — Untitled Financial commodity stress ($0.25, 6h cache)
 *   get_macro_stress            — Untitled Financial macro regime ($0.15, 1h cache)
 *   get_currency_stress         — Untitled Financial USD/G10 regime ($0.25, 3h cache)
 *   get_cascade_shocks          — Untitled Financial shock propagation ($0.75, 2h cache)
 *   search_market_context       — StableEnrich exa/answer live web search ($0.01)
 */

import Anthropic from '@anthropic-ai/sdk';
import { Gordon } from '@withgordon/core';
import {
  ANTHROPIC_API_KEY,
  GORDON_PLATFORM_URL,
  GORDON_AGENT_API_KEY,
  GORDON_AGENT_API_SECRET,
  UNTITLED_BASE,
  STABLEENRICH_BASE,
} from './config.js';
import type { MoveEvent, ResearchReport } from './researcher.js';

// ── Tool schemas ─────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_commodity_intelligence',
    description:
      'Fetch the current commodity stress index from Untitled Financial. ' +
      'Returns JSON with commodity-level stress scores, regime classification, ' +
      'and cross-commodity correlations. Cost: $0.25 USDC (6-hour cache).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_macro_stress',
    description:
      'Fetch the macro-stress regime from Untitled Financial. ' +
      'Returns JSON classifying the current macro environment (risk-on/off, ' +
      'liquidity conditions, central bank stance). Cost: $0.15 USDC (1-hour cache).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_currency_stress',
    description:
      'Fetch G10 + EM currency stress, dollar regime, and capital flow direction from Untitled Financial. ' +
      'Critical for precious metals research — gold and silver move inversely to USD strength. ' +
      'Cost: $0.25 USDC (3-hour cache).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_cascade_shocks',
    description:
      'Fetch cascade / shock-propagation signals from Untitled Financial. ' +
      'Shows how stress is spreading across asset classes. Use this for moves ' +
      'of 2% or larger to assess systemic risk. Cost: $0.75 USDC (2-hour cache).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_market_context',
    description:
      'Search the live web for breaking news and analyst commentary explaining a market move. ' +
      'Uses Exa AI-powered search via StableEnrich to return a synthesised answer. ' +
      'Always call this to ground the structured signals in real-world event context. ' +
      'Cost: $0.01 USDC.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query. Be specific — include the metal name, direction, and approximate time. ' +
            'Example: "gold price spike reason today June 2026" or "palladium drop cause this week".',
        },
      },
      required: ['query'],
    },
  },
];

// ── Untitled Financial endpoint config ───────────────────────────────────────

const UNTITLED_ENDPOINTS: Record<string, {
  path: string; operationId: string; maxUnits: number; fallbackUnits: number;
}> = {
  get_commodity_intelligence: {
    path: '/v1/intelligence/commodity',
    operationId: 'intelligence.commodity',
    maxUnits: 300_000,
    fallbackUnits: 250_000,
  },
  get_macro_stress: {
    path: '/v1/intelligence/macro-stress',
    operationId: 'intelligence.macro-stress',
    maxUnits: 200_000,
    fallbackUnits: 150_000,
  },
  get_currency_stress: {
    path: '/v1/intelligence/currency-stress',
    operationId: 'intelligence.currency-stress',
    maxUnits: 300_000,
    fallbackUnits: 250_000,
  },
  get_cascade_shocks: {
    path: '/v1/intelligence/cascade',
    operationId: 'intelligence.cascade',
    maxUnits: 850_000,
    fallbackUnits: 750_000,
  },
};

// ── Tool executors ────────────────────────────────────────────────────────────

async function executeUntitledTool(
  gordon: Gordon,
  toolName: string,
): Promise<{ result: unknown; costUnits: number }> {
  const cfg = UNTITLED_ENDPOINTS[toolName];
  if (!cfg) throw new Error(`Unknown Untitled tool: ${toolName}`);

  const res = await gordon.fetch(`${UNTITLED_BASE}${cfg.path}`, {
    method: 'GET',
    serviceId: 'untitledfinancial',
    operationId: cfg.operationId,
    maxPaymentUnits: cfg.maxUnits,
  });

  if (!res.response.ok) {
    const body = await res.response.text();
    throw new Error(`${toolName} failed ${res.response.status}: ${body}`);
  }

  const result = await res.response.json();
  return { result, costUnits: res.receipt?.amount_units ?? cfg.fallbackUnits };
}

async function executeStableEnrichSearch(
  gordon: Gordon,
  query: string,
): Promise<{ result: unknown; costUnits: number }> {
  const res = await gordon.fetch(`${STABLEENRICH_BASE}/api/exa/answer`, {
    method: 'POST',
    serviceId: 'stableenrich',
    operationId: 'exa.answer',
    maxPaymentUnits: 15_000, // $0.015 ceiling (list price $0.01)
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.response.ok) {
    const body = await res.response.text();
    throw new Error(`search_market_context failed ${res.response.status}: ${body}`);
  }

  const result = await res.response.json();
  return { result, costUnits: res.receipt?.amount_units ?? 10_000 };
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a commodity markets research analyst with access to live structured signals and live web search.

When you receive a price-move alert, follow this sequence:
1. Call get_commodity_intelligence, get_macro_stress, and get_currency_stress in parallel to establish the full structured regime context.
   Currency stress is especially important for XAU and XAG — precious metals move inversely to USD strength.
2. Call search_market_context with a specific query (include the metal, direction, and date) to get live breaking news and analyst commentary that explains the WHY behind the move.
3. Call get_cascade_shocks ONLY if the move is 2% or larger to assess systemic risk.
4. After gathering all signals, write a concise research brief (3–5 sentences) that:
   - States the current macro/commodity/currency regime using the exact classification labels from the structured data.
   - Identifies the most likely driver(s) of this move — cross-reference the structured regime with the live web context.
   - Assesses whether this is a priced-in move or a surprise shock.
   - Flags the key thing to watch next.

Be specific: cite regime labels, scores, and stress indices from the structured data AND reference what the web search found. No generic commentary.`;

const USD_PER_UNIT = 1 / 1_000_000;

// ── Main agent entry point ───────────────────────────────────────────────────

export async function runResearchAgent(event: MoveEvent): Promise<ResearchReport> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const gordon = new Gordon({
    platformUrl: GORDON_PLATFORM_URL,
    agentApiKey: GORDON_AGENT_API_KEY,
    agentApiSecret: GORDON_AGENT_API_SECRET,
  });

  const pctAbs = Math.abs(event.pctChange);
  const direction = event.pctChange > 0 ? 'up' : 'down';

  const userMessage =
    `PRICE ALERT: ${event.symbol} moved ${direction} ${(pctAbs * 100).toFixed(2)}% in one minute.\n` +
    `Price: $${event.prevPrice.toFixed(2)} → $${event.currPrice.toFixed(2)}\n` +
    `Time: ${event.timestamp.toISOString()}\n\n` +
    `Please research this move now. The move is ${pctAbs >= 0.02 ? '≥2% — also check cascade shocks' : '<2% — cascade shocks not needed'}.`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let totalCostUnits = 0;
  let commodityIntelligence: unknown = null;
  let macroStress: unknown = null;
  let currencyStress: unknown = null;
  let cascade: unknown = null;
  let marketContext: unknown = null;
  let summary = '';

  // ── Agentic tool-use loop ─────────────────────────────────────────────────
  while (true) {
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      summary = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`[agent] calling tool: ${toolUse.name}`);
        let toolResult: string;

        try {
          let result: unknown;
          let costUnits: number;

          if (toolUse.name === 'search_market_context') {
            const input = toolUse.input as { query: string };
            ({ result, costUnits } = await executeStableEnrichSearch(gordon, input.query));
            marketContext = result;
          } else {
            ({ result, costUnits } = await executeUntitledTool(gordon, toolUse.name));
            if (toolUse.name === 'get_commodity_intelligence') commodityIntelligence = result;
            if (toolUse.name === 'get_macro_stress') macroStress = result;
            if (toolUse.name === 'get_currency_stress') currencyStress = result;
            if (toolUse.name === 'get_cascade_shocks') cascade = result;
          }

          totalCostUnits += costUnits;
          toolResult = JSON.stringify(result, null, 2);
          console.log(`[agent] ${toolUse.name} ok — $${(costUnits * USD_PER_UNIT).toFixed(4)}`);
        } catch (err) {
          toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`[agent] ${toolUse.name} failed:`, toolResult);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: toolResult,
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    console.warn(`[agent] unexpected stop_reason: ${response.stop_reason}`);
    break;
  }

  return {
    event,
    commodityIntelligence,
    macroStress,
    currencyStress,
    cascade,
    marketContext,
    summary: summary || '(no summary produced)',
    costUsd: totalCostUnits * USD_PER_UNIT,
  };
}
