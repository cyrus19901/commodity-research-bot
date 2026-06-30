/**
 * Endpoint smoke-test — validates Gordon can reach untitledfinancial + stableenrich
 * without needing an Anthropic key.
 *
 * Usage:
 *   GORDON_AGENT_API_KEY=... GORDON_AGENT_API_SECRET=... npx tsx scripts/test-endpoints.ts
 */
import { Gordon } from '@withgordon/core';

const GORDON_PLATFORM_URL = process.env['GORDON_PLATFORM_URL'] ?? 'https://api.withgordon.ai';
const GORDON_AGENT_API_KEY = process.env['GORDON_AGENT_API_KEY'] ?? '';
const GORDON_AGENT_API_SECRET = process.env['GORDON_AGENT_API_SECRET'] ?? '';

if (!GORDON_AGENT_API_KEY || !GORDON_AGENT_API_SECRET) {
  console.error('Set GORDON_AGENT_API_KEY and GORDON_AGENT_API_SECRET env vars');
  process.exit(1);
}

const gordon = new Gordon({
  platformUrl: GORDON_PLATFORM_URL,
  agentApiKey: GORDON_AGENT_API_KEY,
  agentApiSecret: GORDON_AGENT_API_SECRET,
});

async function test(label: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${label} ... `);
  try {
    await fn();
    console.log('✓');
  } catch (err) {
    console.log(`✗  ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log('\n=== Gordon Endpoint Smoke Test ===\n');
console.log('Agent key:', GORDON_AGENT_API_KEY.slice(0, 20) + '...');
console.log();

// ── 1. Check balance ──────────────────────────────────────────────────────────
console.log('1. Account');
await test('balance', async () => {
  const res = await fetch(`${GORDON_PLATFORM_URL}/agent/balance`, {
    headers: {
      'x-agent-api-key': GORDON_AGENT_API_KEY,
      'x-agent-api-secret': GORDON_AGENT_API_SECRET,
    },
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body)}`);
  const bal = (body.balance_units as number ?? 0) / 1_000_000;
  console.log(`   → balance $${bal.toFixed(4)}`);
});

// ── 2. Check enabled services ─────────────────────────────────────────────────
console.log('\n2. Enabled services');
await test('list', async () => {
  const res = await fetch(`${GORDON_PLATFORM_URL}/agent/services`, {
    headers: {
      'x-agent-api-key': GORDON_AGENT_API_KEY,
      'x-agent-api-secret': GORDON_AGENT_API_SECRET,
    },
  });
  const body = await res.json() as unknown;
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body)}`);
  const services = (body as Array<{slug: string}>);
  console.log(`   → ${services.map(s => s.slug).join(', ')}`);
  const hasStable = services.some(s => s.slug === 'stableenrich');
  if (!hasStable) throw new Error('stableenrich NOT enabled — enable it in Gordon dashboard');
  const hasUntitled = services.some(s => s.slug === 'untitledfinancial');
  if (!hasUntitled) console.warn('   ⚠  untitledfinancial not enabled (optional enrichment)');
});

// ── 3. Untitled Financial — commodity stress ───────────────────────────────────
console.log('\n3. Untitled Financial');
await test('commodity stress', async () => {
  const res = await gordon.fetch('https://intelligence.untitledfinancial.com/v1/intelligence/commodity', {
    method: 'GET',
    serviceId: 'untitledfinancial',
    operationId: 'intelligence.commodity',
    maxPaymentUnits: 300_000,
  });
  if (!res.response.ok) {
    const body = await res.response.text();
    throw new Error(`${res.response.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.response.json() as Record<string, unknown>;
  const cost = (res.receipt?.amount_units ?? 250_000) / 1_000_000;
  console.log(`   → paid $${cost.toFixed(4)}  keys: ${Object.keys(data).join(', ')}`);
});

await test('currency stress', async () => {
  const res = await gordon.fetch('https://intelligence.untitledfinancial.com/v1/intelligence/currency-stress', {
    method: 'GET',
    serviceId: 'untitledfinancial',
    operationId: 'intelligence.currency-stress',
    maxPaymentUnits: 300_000,
  });
  if (!res.response.ok) {
    const body = await res.response.text();
    throw new Error(`${res.response.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.response.json() as Record<string, unknown>;
  const cost = (res.receipt?.amount_units ?? 250_000) / 1_000_000;
  console.log(`   → paid $${cost.toFixed(4)}  keys: ${Object.keys(data).join(', ')}`);
});

await test('macro stress', async () => {
  const res = await gordon.fetch('https://intelligence.untitledfinancial.com/v1/intelligence/macro-stress', {
    method: 'GET',
    serviceId: 'untitledfinancial',
    operationId: 'intelligence.macro-stress',
    maxPaymentUnits: 200_000,
  });
  if (!res.response.ok) {
    const body = await res.response.text();
    throw new Error(`${res.response.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.response.json() as Record<string, unknown>;
  const cost = (res.receipt?.amount_units ?? 150_000) / 1_000_000;
  console.log(`   → paid $${cost.toFixed(4)}  keys: ${Object.keys(data).join(', ')}`);
});

// ── 4. StableEnrich — exa/answer ─────────────────────────────────────────────
console.log('\n4. StableEnrich');
await test('exa search (market context)', async () => {
  const res = await gordon.fetch('https://stableenrich.dev/api/exa/search', {
    method: 'POST',
    serviceId: 'stableenrich',
    operationId: 'api.exa.search',
    maxPaymentUnits: 15_000,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'gold price move reason today June 2026', numResults: 3, type: 'auto' }),
  });
  if (!res.response.ok) {
    const body = await res.response.text();
    throw new Error(`${res.response.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.response.json() as Record<string, unknown>;
  const cost = (res.receipt?.amount_units ?? 10_000) / 1_000_000;
  const results = data['results'] as Array<Record<string, string>> ?? [];
  console.log(`   → paid $${cost.toFixed(4)}  got ${results.length} results`);
  if (results[0]) console.log(`   → "${results[0]['title']?.slice(0, 80)}"`);
});

console.log('\n=== Done ===\n');
