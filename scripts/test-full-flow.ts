/**
 * Full-flow test: simulates a gold price move and runs researchMove() data collection.
 * Skips Claude synthesis — just validates Gordon SDK + StableEnrich payment work end-to-end.
 *
 * Usage:
 *   GORDON_AGENT_API_KEY=... GORDON_AGENT_API_SECRET=... npx tsx scripts/test-full-flow.ts
 */
import { Gordon } from '@withgordon/core';

const GORDON_PLATFORM_URL = process.env['GORDON_PLATFORM_URL'] ?? 'https://api.withgordon.ai';
const GORDON_AGENT_API_KEY = process.env['GORDON_AGENT_API_KEY'] ?? '';
const GORDON_AGENT_API_SECRET = process.env['GORDON_AGENT_API_SECRET'] ?? '';
const STABLEENRICH_BASE = 'https://stableenrich.dev';
const UNTITLED_BASE = 'https://intelligence.untitledfinancial.com';

if (!GORDON_AGENT_API_KEY || !GORDON_AGENT_API_SECRET) {
  console.error('Set GORDON_AGENT_API_KEY and GORDON_AGENT_API_SECRET');
  process.exit(1);
}

const gordon = new Gordon({
  platformUrl: GORDON_PLATFORM_URL,
  agentApiKey: GORDON_AGENT_API_KEY,
  agentApiSecret: GORDON_AGENT_API_SECRET,
});

// Simulated move: Gold down 1.2% today
const event = {
  symbol: 'XAU',
  prevPrice: 3320.50,
  currPrice: 3280.70,
  pctChange: -0.012,
  timestamp: new Date(),
};

const pctAbs = Math.abs(event.pctChange);
const direction = event.pctChange > 0 ? 'up' : 'down';
const metal = 'Gold';

console.log('\n=== Commodity Research Bot — Full Flow Test ===\n');
console.log(`Simulated move: ${metal} (${event.symbol}) ${direction} ${(pctAbs * 100).toFixed(2)}%`);
console.log(`Price: $${event.prevPrice} → $${event.currPrice}`);
console.log(`Time: ${event.timestamp.toISOString()}\n`);

let totalCostUsd = 0;

// ── 1. StableEnrich (primary) ─────────────────────────────────────────────────
console.log('1. StableEnrich — live market context');
try {
  const query = `${metal} price ${direction} ${(pctAbs * 100).toFixed(2)}% reason today ${event.timestamp.toISOString().slice(0, 10)}`;
  console.log(`   Query: "${query}"`);

  const seRes = await gordon.fetch(`${STABLEENRICH_BASE}/api/exa/search`, {
    method: 'POST',
    serviceId: 'stableenrich',
    operationId: 'api.exa.search',
    maxPaymentUnits: 15_000,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, numResults: 5, type: 'auto' }),
  });

  if (seRes.response.ok) {
    const data = await seRes.response.json() as Record<string, unknown>;
    const cost = (seRes.receipt?.amount_units ?? 10_000) / 1_000_000;
    totalCostUsd += cost;
    const results = data['results'] as Array<Record<string, string>> ?? [];
    console.log(`   ✓  paid $${cost.toFixed(4)}  got ${results.length} results`);
    results.slice(0, 2).forEach(r => console.log(`   - ${r['title']?.slice(0, 80)}`));
  } else {
    const body = await seRes.response.text();
    console.log(`   ✗  ${seRes.response.status}: ${body.slice(0, 100)}`);
  }
} catch (err) {
  console.log(`   ✗  ${err instanceof Error ? err.message : String(err)}`);
}

// ── 2. Untitled Financial (optional enrichment) ───────────────────────────────
console.log('\n2. Untitled Financial — optional structured signals');
const ufEndpoints = [
  { label: 'commodity stress', path: '/v1/intelligence/commodity', op: 'intelligence.commodity', maxUnits: 300_000 },
  { label: 'macro stress',     path: '/v1/intelligence/macro-stress', op: 'intelligence.macro-stress', maxUnits: 200_000 },
  { label: 'currency stress',  path: '/v1/intelligence/currency-stress', op: 'intelligence.currency-stress', maxUnits: 300_000 },
];

for (const ep of ufEndpoints) {
  try {
    const res = await gordon.fetch(`${UNTITLED_BASE}${ep.path}`, {
      method: 'GET',
      serviceId: 'untitledfinancial',
      operationId: ep.op,
      maxPaymentUnits: ep.maxUnits,
    });
    if (res.response.ok) {
      const cost = (res.receipt?.amount_units ?? 0) / 1_000_000;
      totalCostUsd += cost;
      console.log(`   ✓  ${ep.label} — paid $${cost.toFixed(4)}`);
    } else {
      const body = await res.response.text();
      console.log(`   ✗  ${ep.label} — ${res.response.status}: ${body.slice(0, 80)}`);
    }
  } catch (err) {
    console.log(`   ✗  ${ep.label} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n=== Total data cost: $${totalCostUsd.toFixed(4)} ===`);
console.log('(Claude synthesis skipped — add ANTHROPIC_API_KEY to test full report generation)\n');
