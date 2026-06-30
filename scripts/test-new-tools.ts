/**
 * Tests all 4 new StableEnrich tools added in the multi-source branch.
 * No Anthropic key needed — just verifies payments go through.
 *
 * Usage:
 *   GORDON_AGENT_API_KEY=... GORDON_AGENT_API_SECRET=... npx tsx scripts/test-new-tools.ts
 */
import { Gordon } from '@withgordon/core';

const GORDON_PLATFORM_URL = process.env['GORDON_PLATFORM_URL'] ?? 'https://api.withgordon.ai';
const GORDON_AGENT_API_KEY = process.env['GORDON_AGENT_API_KEY'] ?? '';
const GORDON_AGENT_API_SECRET = process.env['GORDON_AGENT_API_SECRET'] ?? '';
const BASE = 'https://stableenrich.dev';

if (!GORDON_AGENT_API_KEY || !GORDON_AGENT_API_SECRET) {
  console.error('Set GORDON_AGENT_API_KEY and GORDON_AGENT_API_SECRET');
  process.exit(1);
}

const gordon = new Gordon({
  platformUrl: GORDON_PLATFORM_URL,
  agentApiKey: GORDON_AGENT_API_KEY,
  agentApiSecret: GORDON_AGENT_API_SECRET,
});

const QUERY = 'Why did gold price surge 2.1% on June 30 2026 around 3:30 PM EST? What is the catalyst?';
const GOOGLE_QUERY = 'gold price rises June 30 2026 reason why catalyst';
const DOMAINS = ['kitco.com', 'ft.com', 'mining.com', 'marketwatch.com', 'investing.com'];

let firstArticleUrl: string | null = null;
let totalCost = 0;

console.log('\n=== Multi-Source StableEnrich Tool Test ===\n');

async function test(
  label: string,
  operationId: string,
  path: string,
  body: unknown,
  maxUnits: number,
  onResult?: (data: unknown) => void,
) {
  process.stdout.write(`${label} (${operationId}) ... `);
  try {
    const res = await gordon.fetch(`${BASE}${path}`, {
      method: 'POST',
      serviceId: 'stableenrich',
      operationId,
      maxPaymentUnits: maxUnits,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.response.ok) {
      const data = await res.response.json() as Record<string, unknown>;
      const cost = (res.receipt?.amount_units ?? 0) / 1_000_000;
      totalCost += cost;
      console.log(`✓  paid $${cost.toFixed(4)}`);
      onResult?.(data);
    } else {
      const text = await res.response.text();
      const err = JSON.parse(text || '{}') as Record<string, unknown>;
      console.log(`✗  ${res.response.status}: ${err['error'] ?? text.slice(0, 80)}`);
    }
  } catch (err) {
    console.log(`✗  ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── 1. Exa search (already working) ──────────────────────────────────────────
console.log('1. Exa News Search (existing)');
await test(
  '  api.exa.search',
  'api.exa.search',
  '/api/exa/search',
  { query: QUERY, numResults: 8, type: 'auto', category: 'news', includeDomains: DOMAINS },
  12_000,
  (data) => {
    const results = (data['results'] as Array<Record<string, string>>) ?? [];
    results.slice(0, 2).forEach(r => console.log(`     - ${r['title']?.slice(0, 70)}`));
    firstArticleUrl = results[0]?.['url'] ?? null;
  },
);

// ── 2. Serper Google News (new) ───────────────────────────────────────────────
console.log('\n2. Serper Google News (new)');
await test(
  '  api.serper.news',
  'api.serper.news',
  '/api/serper/news',
  { q: GOOGLE_QUERY, num: 8 },
  45_000,
  (data) => {
    const news = (data['news'] as Array<Record<string, string>>) ?? [];
    news.slice(0, 2).forEach(r => console.log(`     - ${r['title']?.slice(0, 70)}`));
  },
);

// ── 3. Exa article fetch (new) ────────────────────────────────────────────────
console.log('\n3. Exa Article Content Fetch (new)');
const urlToFetch = firstArticleUrl ?? 'https://www.kitco.com/news/';
console.log(`   Fetching: ${urlToFetch.slice(0, 60)}...`);
await test(
  '  api.exa.contents',
  'api.exa.contents',
  '/api/exa/contents',
  { urls: [urlToFetch] },
  3_000,
  (data) => {
    const results = (data['results'] as Array<Record<string, unknown>>) ?? [];
    const text = results[0]?.['text'] as string ?? '';
    if (text) console.log(`     preview: "${text.slice(0, 100)}..."`);
  },
);

// ── 4. Exa synthesised answer (new) ──────────────────────────────────────────
console.log('\n4. Exa Synthesised Answer (new)');
await test(
  '  api.exa.answer',
  'api.exa.answer',
  '/api/exa/answer',
  { query: QUERY },
  12_000,
  (data) => {
    const answer = data['answer'] as string ?? '';
    if (answer) console.log(`     answer: "${answer.slice(0, 150)}..."`);
  },
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n=== Total cost: $${totalCost.toFixed(4)} ===\n`);
