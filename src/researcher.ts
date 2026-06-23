import Anthropic from '@anthropic-ai/sdk';
import { Gordon } from '@withgordon/core';
import {
  ANTHROPIC_API_KEY,
  GORDON_PLATFORM_URL,
  GORDON_AGENT_API_KEY,
  GORDON_AGENT_API_SECRET,
  UNTITLED_BASE,
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
  commodityIntelligence: unknown;
  macroStress: unknown;
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

// Gordon micro-units: 1_000_000 = $1.00
const USD_PER_UNIT = 1 / 1_000_000;

export async function researchMove(event: MoveEvent): Promise<ResearchReport> {
  const gordon = new Gordon({
    evaluatorUrl: GORDON_PLATFORM_URL,
    platformUrl: GORDON_PLATFORM_URL,
    agentApiKey: GORDON_AGENT_API_KEY,
    agentApiSecret: GORDON_AGENT_API_SECRET,
  });

  const pctAbs = Math.abs(event.pctChange);
  const direction = event.pctChange > 0 ? 'up' : 'down';
  const metal = METAL_NAMES[event.symbol] ?? event.symbol;

  // Always call commodity + macro-stress ($0.25 + $0.15 = $0.40 base)
  // Add cascade for moves >= CASCADE_THRESHOLD ($0.75 extra)
  const callCascade = pctAbs >= CASCADE_THRESHOLD;

  let totalCostUnits = 0;

  // ── Commodity intelligence (6h cache, $0.25) ──────────────────────────────
  const commodityRes = await gordon.fetch(
    `${UNTITLED_BASE}/v1/intelligence/commodity`,
    {
      method: 'GET',
      serviceId: 'untitledfinancial',
      operationId: 'intelligence.commodity',
      maxPaymentUnits: 300_000, // $0.30 ceiling
    },
  );
  if (!commodityRes.response.ok) {
    throw new Error(`commodity endpoint failed: ${commodityRes.response.status}`);
  }
  const commodityIntelligence = await commodityRes.response.json();
  totalCostUnits += commodityRes.receipt?.amount_units ?? 250_000;

  // ── Macro-stress (1h cache, $0.15) ────────────────────────────────────────
  const macroRes = await gordon.fetch(
    `${UNTITLED_BASE}/v1/intelligence/macro-stress`,
    {
      method: 'GET',
      serviceId: 'untitledfinancial',
      operationId: 'intelligence.macro-stress',
      maxPaymentUnits: 200_000, // $0.20 ceiling
    },
  );
  if (!macroRes.response.ok) {
    throw new Error(`macro-stress endpoint failed: ${macroRes.response.status}`);
  }
  const macroStress = await macroRes.response.json();
  totalCostUnits += macroRes.receipt?.amount_units ?? 150_000;

  // ── Cascade — only on large moves (2h cache, $0.75) ──────────────────────
  let cascade: unknown | null = null;
  if (callCascade) {
    const cascadeRes = await gordon.fetch(
      `${UNTITLED_BASE}/v1/intelligence/cascade`,
      {
        method: 'GET',
        serviceId: 'untitledfinancial',
        operationId: 'intelligence.cascade',
        maxPaymentUnits: 850_000, // $0.85 ceiling
      },
    );
    if (cascadeRes.response.ok) {
      cascade = await cascadeRes.response.json();
      totalCostUnits += cascadeRes.receipt?.amount_units ?? 750_000;
    }
  }

  // ── Claude synthesises a research report ──────────────────────────────────
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const prompt = `
${metal} (${event.symbol}) just moved ${direction} ${(pctAbs * 100).toFixed(2)}% in one minute.

Price: $${event.prevPrice.toFixed(2)} → $${event.currPrice.toFixed(2)}
Time: ${event.timestamp.toISOString()}

Here is structured market intelligence from Untitled Financial:

## Commodity Stress Index
${JSON.stringify(commodityIntelligence, null, 2)}

## Macro Stress Regime
${JSON.stringify(macroStress, null, 2)}

${cascade ? `## Cascade / Shock Propagation\n${JSON.stringify(cascade, null, 2)}` : ''}

Write a concise research brief (3–5 sentences) for a client explaining:
1. What the current macro/commodity regime is (use the classification labels from the data).
2. The most likely driver(s) of this specific move, given the regime.
3. Whether this looks like a priced-in move or a surprise shock.
4. What to watch next.

Be specific — cite the regime labels and scores from the data, not generic commentary.
`;

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
    commodityIntelligence,
    macroStress,
    cascade,
    summary,
    costUsd: totalCostUnits * USD_PER_UNIT,
  };
}
