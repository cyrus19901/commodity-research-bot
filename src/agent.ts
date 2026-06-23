/**
 * Claude agentic researcher — Claude drives which Untitled Financial endpoints
 * to call (via Gordon x402) and synthesises the research brief itself.
 *
 * Tools exposed to the agent:
 *   get_commodity_intelligence  — commodity stress index ($0.25, 6h cache)
 *   get_macro_stress            — macro regime signals ($0.15, 1h cache)
 *   get_cascade_shocks          — cascade / shock propagation ($0.75, 2h cache)
 *
 * Each tool is backed by the Gordon SDK; Claude decides when to call them
 * based on the severity of the price move.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Gordon } from '@withgordon/core';
import {
  ANTHROPIC_API_KEY,
  GORDON_PLATFORM_URL,
  GORDON_AGENT_API_KEY,
  GORDON_AGENT_API_SECRET,
  UNTITLED_BASE,
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
    name: 'get_cascade_shocks',
    description:
      'Fetch cascade / shock-propagation signals from Untitled Financial. ' +
      'Shows how stress is spreading across asset classes. Use this for moves ' +
      'of 2% or larger to assess systemic risk. Cost: $0.75 USDC (2-hour cache).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

// ── Gordon tool executor ─────────────────────────────────────────────────────

async function executeGordonTool(
  gordon: Gordon,
  toolName: string,
): Promise<{ result: unknown; costUnits: number }> {
  const endpointMap: Record<string, { path: string; operationId: string; maxUnits: number; fallbackUnits: number }> = {
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
    get_cascade_shocks: {
      path: '/v1/intelligence/cascade',
      operationId: 'intelligence.cascade',
      maxUnits: 850_000,
      fallbackUnits: 750_000,
    },
  };

  const cfg = endpointMap[toolName];
  if (!cfg) throw new Error(`Unknown tool: ${toolName}`);

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

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a commodity markets research analyst.
When you receive a price-move alert you must:
1. Always call get_commodity_intelligence and get_macro_stress to establish the regime context.
2. Call get_cascade_shocks ONLY if the move is 2% or larger (systemic risk threshold).
3. After gathering intelligence, write a concise research brief (3–5 sentences) that:
   - States the current macro/commodity regime using the exact classification labels from the data.
   - Identifies the most likely driver(s) of this specific move given the regime.
   - Assesses whether the move looks priced-in or a surprise shock.
   - Flags what to watch next.
Be specific — cite regime labels, scores, and stress indices from the data. No generic commentary.`;

const USD_PER_UNIT = 1 / 1_000_000;

// ── Main agent entry point ───────────────────────────────────────────────────

export async function runResearchAgent(event: MoveEvent): Promise<ResearchReport> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const gordon = new Gordon({
    evaluatorUrl: GORDON_PLATFORM_URL,
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
  let cascade: unknown = null;
  let summary = '';

  // ── Agentic tool-use loop ─────────────────────────────────────────────────
  while (true) {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    // Append Claude's response to the conversation
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // Extract final text from response
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
          const { result, costUnits } = await executeGordonTool(gordon, toolUse.name);
          totalCostUnits += costUnits;

          // Cache results for the report
          if (toolUse.name === 'get_commodity_intelligence') commodityIntelligence = result;
          if (toolUse.name === 'get_macro_stress') macroStress = result;
          if (toolUse.name === 'get_cascade_shocks') cascade = result;

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

      // Feed tool results back into the conversation
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason — bail out
    console.warn(`[agent] unexpected stop_reason: ${response.stop_reason}`);
    break;
  }

  return {
    event,
    commodityIntelligence,
    macroStress,
    cascade,
    summary: summary || '(no summary produced)',
    costUsd: totalCostUnits * USD_PER_UNIT,
  };
}
