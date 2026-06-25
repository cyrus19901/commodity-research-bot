import Anthropic from '@anthropic-ai/sdk';
import { Gordon } from '@withgordon/core';
import {
  ANTHROPIC_API_KEY,
  GORDON_PLATFORM_URL,
  GORDON_AGENT_API_KEY,
  GORDON_AGENT_API_SECRET,
  UNTITLED_BASE,
  STABLEENRICH_BASE,
  CASCADE_THRESHOLD,
} from './config.js';

export interface MoveEvent {
  symbol: string;      // XAU, XAG, etc.
  prevPrice: number;
  currPrice: number;
  pctChange: number;   // e.g. 0.013 = +1.3%
  timestamp: Date;
}

export interface ResearchReport {
  event: MoveEvent;
  marketContext: unknown | null;     // StableEnrich — live web context (primary)
  commodityIntelligence: unknown | null; // Untitled Financial — optional enrichment
  macroStress: unknown | null;
  currencyStress: unknown | null;
  cascade: unknown | null;
  summary: string;
  costUsd: number;
}

const METAL_NAMES: Record<string, string> = {
  XAU: 'Gold',
  XAG: 'Silver',
  XPD: 'Palladium',
  XPT: 'Platinum',
};

const USD_PER_UNIT = 1 / 1_000_000;

export async function researchMove(event: MoveEvent): Promise<ResearchReport> {
  const gordon = new Gordon({
    platformUrl: GORDON_PLATFORM_URL,
    agentApiKey: GORDON_AGENT_API_KEY,
    agentApiSecret: GORDON_AGENT_API_SECRET,
  });

  const pctAbs = Math.abs(event.pctChange);
  const direction = event.pctChange > 0 ? 'up' : 'down';
  const metal = METAL_NAMES[event.symbol] ?? event.symbol;
  const callCascade = pctAbs >= CASCADE_THRESHOLD;

  let totalCostUnits = 0;

  // ── StableEnrich (primary) — live web context via Exa ────────────────────
  // Always called. Provides real-time news and analyst commentary on the move.
  let marketContext: unknown | null = null;
  try {
    const query = `${metal} price ${direction} ${(pctAbs * 100).toFixed(2)}% reason today ${event.timestamp.toISOString().slice(0, 10)}`;
    const seRes = await gordon.fetch(`${STABLEENRICH_BASE}/api/exa/answer`, {
      method: 'POST',
      serviceId: 'stableenrich',
      operationId: 'exa.answer',
      maxPaymentUnits: 15_000,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (seRes.response.ok) {
      marketContext = await seRes.response.json();
      totalCostUnits += seRes.receipt?.amount_units ?? 10_000;
    } else {
      console.warn(`[research] stableenrich unavailable: ${seRes.response.status}`);
    }
  } catch (err) {
    console.warn(`[research] stableenrich skipped:`, err instanceof Error ? err.message : err);
  }

  // ── Untitled Financial (optional enrichment) ──────────────────────────────
  // All UF calls are best-effort. If their x402 payment issue is ever resolved,
  // this structured intelligence will automatically enrich reports.
  let commodityIntelligence: unknown | null = null;
  try {
    const res = await gordon.fetch(`${UNTITLED_BASE}/v1/intelligence/commodity`, {
      method: 'GET',
      serviceId: 'untitledfinancial',
      operationId: 'intelligence.commodity',
      maxPaymentUnits: 300_000,
    });
    if (res.response.ok) {
      commodityIntelligence = await res.response.json();
      totalCostUnits += res.receipt?.amount_units ?? 250_000;
    } else {
      console.warn(`[research] UF commodity unavailable: ${res.response.status}`);
    }
  } catch (err) {
    console.warn(`[research] UF commodity skipped:`, err instanceof Error ? err.message : err);
  }

  let macroStress: unknown | null = null;
  try {
    const res = await gordon.fetch(`${UNTITLED_BASE}/v1/intelligence/macro-stress`, {
      method: 'GET',
      serviceId: 'untitledfinancial',
      operationId: 'intelligence.macro-stress',
      maxPaymentUnits: 200_000,
    });
    if (res.response.ok) {
      macroStress = await res.response.json();
      totalCostUnits += res.receipt?.amount_units ?? 150_000;
    }
  } catch { /* best-effort */ }

  let currencyStress: unknown | null = null;
  try {
    const res = await gordon.fetch(`${UNTITLED_BASE}/v1/intelligence/currency-stress`, {
      method: 'GET',
      serviceId: 'untitledfinancial',
      operationId: 'intelligence.currency-stress',
      maxPaymentUnits: 300_000,
    });
    if (res.response.ok) {
      currencyStress = await res.response.json();
      totalCostUnits += res.receipt?.amount_units ?? 250_000;
    }
  } catch { /* best-effort */ }

  let cascade: unknown | null = null;
  if (callCascade) {
    try {
      const res = await gordon.fetch(`${UNTITLED_BASE}/v1/intelligence/cascade`, {
        method: 'GET',
        serviceId: 'untitledfinancial',
        operationId: 'intelligence.cascade',
        maxPaymentUnits: 850_000,
      });
      if (res.response.ok) {
        cascade = await res.response.json();
        totalCostUnits += res.receipt?.amount_units ?? 750_000;
      }
    } catch { /* best-effort */ }
  }

  // ── Claude synthesises a research report ──────────────────────────────────
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const ufSection = [
    commodityIntelligence && `## Commodity Stress Index\n${JSON.stringify(commodityIntelligence, null, 2)}`,
    macroStress && `## Macro Stress Regime\n${JSON.stringify(macroStress, null, 2)}`,
    currencyStress && `## Currency / Dollar Regime\n${JSON.stringify(currencyStress, null, 2)}`,
    cascade && `## Cascade / Shock Propagation\n${JSON.stringify(cascade, null, 2)}`,
  ].filter(Boolean).join('\n\n');

  const seAnswer = marketContext
    ? (marketContext as Record<string, unknown>)['answer'] as string ?? JSON.stringify(marketContext)
    : null;

  const prompt = `
${metal} (${event.symbol}) just moved ${direction} ${(pctAbs * 100).toFixed(2)}% in one minute.

Price: $${event.prevPrice.toFixed(2)} → $${event.currPrice.toFixed(2)}
Time: ${event.timestamp.toISOString()}

${seAnswer ? `## Live Market Context (Exa web search)\n${seAnswer}` : ''}

${ufSection || '(No structured regime data available — rely on live context above.)'}

Write a concise research brief (3–5 sentences) for a client explaining:
1. The most likely driver(s) of this specific move — metals are USD-denominated and move inversely to dollar strength.
2. What the current macro/commodity regime looks like based on available data.
3. Whether this looks like a priced-in move or a surprise shock.
4. What to watch next.

Be specific. Use regime labels and scores from the structured data where available. Use the live context for recent news and catalysts.
`.trim();

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const summary = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('\n')
    .trim();

  return {
    event,
    marketContext,
    commodityIntelligence,
    macroStress,
    currencyStress,
    cascade,
    summary,
    costUsd: totalCostUnits * USD_PER_UNIT,
  };
}
