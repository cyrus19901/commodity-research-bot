/**
 * Claude agentic researcher — multi-source news + structured signals.
 *
 * Search tools (all via StableEnrich x402):
 *   search_news_headlines  — Exa news search, raw headlines + URLs ($0.01)
 *   search_google_news     — Serper Google News, different index ($0.04)
 *   fetch_article_content  — Exa contents, full article text from URL ($0.002)
 *   synthesise_web_answer  — Exa answer, AI-synthesised narrative ($0.01)
 *
 * Structured signal tools (Untitled Financial via Gordon):
 *   get_macro_stress       — macro regime ($0.15, 1h cache)
 *   get_currency_stress    — USD/G10 regime ($0.25, 3h cache)
 *   get_commodity_intelligence — commodity stress ($0.25, 6h cache)
 *   get_cascade_shocks     — shock propagation ($0.75, 2h cache)
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

// ── Metal metadata — drivers and authoritative sources per symbol ─────────────

const SYMBOL_META: Record<string, {
  name: string;
  alias: string;
  drivers: string[];
  domains: string[];
}> = {
  'XAU/USD': {
    name: 'gold',
    alias: 'XAU',
    drivers: [
      'US dollar weakness or strength',
      'Federal Reserve interest rate policy and real yields',
      'inflation expectations CPI PCE',
      'geopolitical risk safe haven demand',
      'US Treasury yield curve inversion',
      'ETF flows GLD IAU',
      'central bank gold buying or selling',
    ],
    domains: ['kitco.com', 'ft.com', 'mining.com', 'marketwatch.com', 'investing.com'],
  },
  'XAG/USD': {
    name: 'silver',
    alias: 'XAG',
    drivers: [
      'gold correlation and gold-silver ratio',
      'US dollar weakness or strength',
      'industrial demand solar panels electronics EVs',
      'inflation and real yields',
      'manufacturing PMI data',
    ],
    domains: ['kitco.com', 'silverinstitute.org', 'ft.com', 'marketwatch.com', 'investing.com'],
  },
  'XPD/USD': {
    name: 'palladium',
    alias: 'XPD',
    drivers: [
      'Russia supply disruption sanctions export restrictions',
      'auto industry production sales catalytic converters',
      'emissions regulations',
      'substitution with platinum',
      'mine supply South Africa Russia',
    ],
    domains: ['kitco.com', 'mining.com', 'ft.com', 'marketwatch.com', 'investing.com'],
  },
  'XPT/USD': {
    name: 'platinum',
    alias: 'XPT',
    drivers: [
      'auto industry catalytic converter demand',
      'hydrogen fuel cell economy green energy policy',
      'South Africa mine supply and labor strikes',
      'jewelry demand',
      'palladium substitution',
      'diesel vehicle sales Europe',
    ],
    domains: ['kitco.com', 'mining.com', 'ft.com', 'marketwatch.com', 'investing.com'],
  },
};

// ── Query builders ────────────────────────────────────────────────────────────

function getMeta(symbol: string) {
  return SYMBOL_META[symbol] ?? {
    name: symbol,
    alias: symbol,
    drivers: ['macro conditions', 'supply and demand', 'currency moves'],
    domains: ['reuters.com', 'bloomberg.com', 'ft.com'],
  };
}

function buildNewsQuery(event: MoveEvent): string {
  const meta = getMeta(event.symbol);
  const pctAbs = Math.abs(event.pctChange);
  const direction = event.pctChange > 0 ? 'surged' : 'dropped';
  const magnitude = pctAbs >= 0.03 ? 'sharply' : pctAbs >= 0.02 ? 'significantly' : '';
  const date = event.timestamp.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const time = event.timestamp.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short',
  });
  const priceMove = `$${event.prevPrice.toFixed(2)} to $${event.currPrice.toFixed(2)}`;
  const driverList = meta.drivers.join(', ');

  return (
    `Why did ${meta.name} price ${magnitude} ${direction} ${(pctAbs * 100).toFixed(2)}% ` +
    `(${priceMove}) on ${date} around ${time}? ` +
    `What is the cause and catalyst behind this ${meta.alias} move today? ` +
    `Explain whether it was driven by: ${driverList}. ` +
    `Include breaking news, analyst commentary, and market reaction.`
  );
}

function buildGoogleNewsQuery(event: MoveEvent): string {
  const meta = getMeta(event.symbol);
  const direction = event.pctChange > 0 ? 'rises' : 'falls';
  const date = event.timestamp.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  return `${meta.name} price ${direction} ${date} reason why catalyst`;
}

// ── Tool schemas ──────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_news_headlines',
    description:
      'Search Exa for the latest news headlines and URLs explaining a commodity price move. ' +
      'Returns raw results: article titles, URLs, publish dates, and snippets from ' +
      'Kitco, Reuters, Bloomberg, FT, and Mining.com. ' +
      'Use the pre-built query from the alert verbatim. ' +
      'Call this FIRST — it finds the specific breaking news article. Cost: $0.01 USDC.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The pre-built news search query from the alert. Use verbatim.',
        },
        domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Domains to restrict search to e.g. ["kitco.com","reuters.com"]',
        },
      },
      required: ['query', 'domains'],
    },
  },
  {
    name: 'search_google_news',
    description:
      'Search Google News via Serper for headlines about the commodity move. ' +
      'Covers a different index than Exa — catches wires and regional sources Exa may miss. ' +
      'Returns titles, URLs, snippets, and publish times. Cost: $0.04 USDC.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Short Google News query e.g. "gold price rises June 30 2026 reason"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_article_content',
    description:
      'Fetch the full text of a specific news article URL found by search_news_headlines ' +
      'or search_google_news. Use on the single most relevant article to get the complete ' +
      'analyst commentary and catalyst detail. Cost: $0.002 USDC.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full URL of the article to fetch.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'synthesise_web_answer',
    description:
      'Get an AI-synthesised narrative answer explaining the commodity move from live web data. ' +
      'Complements raw headlines — use after search_news_headlines to get a coherent summary ' +
      'of what multiple sources are saying. Cost: $0.01 USDC.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The pre-built query from the alert. Use verbatim.',
        },
      },
      required: ['query'],
    },
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
      'Fetch G10 + EM currency stress, dollar regime, and capital flow direction. ' +
      'Critical for XAU and XAG — precious metals move inversely to USD strength. ' +
      'Cost: $0.25 USDC (3-hour cache).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_commodity_intelligence',
    description:
      'Fetch commodity stress index from Untitled Financial. ' +
      'Returns stress scores, regime classification, and cross-commodity correlations. ' +
      'Cost: $0.25 USDC (6-hour cache).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_cascade_shocks',
    description:
      'Fetch cascade / shock-propagation signals. Shows how stress is spreading across ' +
      'asset classes. Call ONLY for moves ≥2%. Cost: $0.75 USDC (2-hour cache).',
    input_schema: { type: 'object', properties: {}, required: [] },
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

// ── StableEnrich executors ────────────────────────────────────────────────────

async function stableEnrichPost(
  gordon: Gordon,
  path: string,
  operationId: string,
  body: unknown,
  maxUnits: number,
  fallbackUnits: number,
): Promise<{ result: unknown; costUnits: number }> {
  const res = await gordon.fetch(`${STABLEENRICH_BASE}${path}`, {
    method: 'POST',
    serviceId: 'stableenrich',
    operationId,
    maxPaymentUnits: maxUnits,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.response.ok) {
    const text = await res.response.text();
    throw new Error(`StableEnrich ${path} failed ${res.response.status}: ${text}`);
  }

  const result = await res.response.json();
  return { result, costUnits: res.receipt?.amount_units ?? fallbackUnits };
}

async function executeNewsHeadlines(
  gordon: Gordon,
  query: string,
  domains: string[],
): Promise<{ result: unknown; costUnits: number }> {
  return stableEnrichPost(
    gordon,
    '/api/exa/search',
    'api.exa.search',
    {
      query,
      numResults: 8,
      type: 'auto',
      category: 'news',
      includeDomains: domains,
    },
    12_000,
    10_000,
  );
}

async function executeGoogleNews(
  gordon: Gordon,
  query: string,
): Promise<{ result: unknown; costUnits: number }> {
  return stableEnrichPost(
    gordon,
    '/api/serper/news',
    'api.serper.news',
    { q: query, num: 8 },
    45_000,
    40_000,
  );
}

async function executeArticleContent(
  gordon: Gordon,
  url: string,
): Promise<{ result: unknown; costUnits: number }> {
  return stableEnrichPost(
    gordon,
    '/api/exa/contents',
    'api.exa.contents',
    { urls: [url] },
    3_000,
    2_000,
  );
}

async function executeSynthesiseAnswer(
  gordon: Gordon,
  query: string,
): Promise<{ result: unknown; costUnits: number }> {
  return stableEnrichPost(
    gordon,
    '/api/exa/answer',
    'api.exa.answer',
    { query },
    12_000,
    10_000,
  );
}

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

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a commodity markets research analyst. Your goal is to explain
exactly WHY a precious metal price moved — name the specific catalyst, not generic commentary.

You have four news tools and four structured signal tools. Follow this sequence:

STEP 1 — Find the news (all three in parallel):
  - search_news_headlines: use the pre-built query and domains from the alert verbatim.
    This hits Kitco, Reuters, Bloomberg, FT directly.
  - search_google_news: use the short Google News query from the alert.
    Catches wire services and regional sources Exa may miss.
  - synthesise_web_answer: use the pre-built query verbatim.
    Gives a coherent AI-synthesised narrative from multiple sources.

STEP 2 — Read the best article:
  If search_news_headlines returned a highly relevant article URL (from Kitco/Reuters/Bloomberg),
  call fetch_article_content on the single most relevant URL to get full analyst commentary.

STEP 3 — Get structured context (macro + currency in parallel):
  - get_macro_stress: confirms risk-on/off environment.
  - get_currency_stress: confirms dollar regime — critical for XAU/XAG.
  Call get_commodity_intelligence after if needed for cross-commodity correlations.
  Call get_cascade_shocks ONLY if the move is ≥2%.

STEP 4 — Write the research brief:
  Lead sentence: name the specific catalyst (e.g. "Gold surged after Fed Chair Powell
  signalled a pause in rate cuts at 10:28 AM EST, per Reuters").
  Second sentence: confirm with structured data (macro regime, currency stress, stress scores).
  Third sentence: assess surprise vs priced-in.
  Final sentence: the single most important thing to watch in the next 24 hours.

Rules:
- Never write "various factors" or "market conditions" — name the actual event.
- Cite article titles and sources by name.
- Cite regime labels and stress scores from structured data.
- If news tools return errors, say so and rely on structured signals only.`;

const USD_PER_UNIT = 1 / 1_000_000;

// ── Main agent entry point ────────────────────────────────────────────────────

export async function runResearchAgent(event: MoveEvent): Promise<ResearchReport> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const gordon = new Gordon({
    platformUrl: GORDON_PLATFORM_URL,
    agentApiKey: GORDON_AGENT_API_KEY,
    agentApiSecret: GORDON_AGENT_API_SECRET,
  });

  const meta = getMeta(event.symbol);
  const pctAbs = Math.abs(event.pctChange);
  const direction = event.pctChange > 0 ? 'up' : 'down';
  const newsQuery = buildNewsQuery(event);
  const googleQuery = buildGoogleNewsQuery(event);

  const userMessage =
    `PRICE ALERT: ${event.symbol} (${meta.name}) moved ${direction} ` +
    `${(pctAbs * 100).toFixed(2)}% in one minute.\n` +
    `Price: $${event.prevPrice.toFixed(2)} → $${event.currPrice.toFixed(2)}\n` +
    `Time: ${event.timestamp.toISOString()}\n` +
    `Cascade: ${pctAbs >= 0.02 ? '≥2% — call get_cascade_shocks' : '<2% — skip cascade'}\n\n` +
    `PRE-BUILT QUERIES (use verbatim):\n` +
    `  news_query:   "${newsQuery}"\n` +
    `  google_query: "${googleQuery}"\n` +
    `  domains:      ${JSON.stringify(meta.domains)}\n\n` +
    `Start with all three news tools in parallel (search_news_headlines, ` +
    `search_google_news, synthesise_web_answer), then structured signals.`;

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
      model: 'claude-opus-4-8',
      max_tokens: 2048,
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

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (toolUse) => {
          console.log(`[agent] → ${toolUse.name}`);
          let toolResult: string;

          try {
            let result: unknown;
            let costUnits: number;
            const input = toolUse.input as Record<string, unknown>;

            switch (toolUse.name) {
              case 'search_news_headlines':
                ({ result, costUnits } = await executeNewsHeadlines(
                  gordon,
                  input['query'] as string,
                  input['domains'] as string[],
                ));
                marketContext = result;
                break;

              case 'search_google_news':
                ({ result, costUnits } = await executeGoogleNews(
                  gordon,
                  input['query'] as string,
                ));
                break;

              case 'fetch_article_content':
                ({ result, costUnits } = await executeArticleContent(
                  gordon,
                  input['url'] as string,
                ));
                break;

              case 'synthesise_web_answer':
                ({ result, costUnits } = await executeSynthesiseAnswer(
                  gordon,
                  input['query'] as string,
                ));
                break;

              default:
                ({ result, costUnits } = await executeUntitledTool(gordon, toolUse.name));
                if (toolUse.name === 'get_commodity_intelligence') commodityIntelligence = result;
                if (toolUse.name === 'get_macro_stress') macroStress = result;
                if (toolUse.name === 'get_currency_stress') currencyStress = result;
                if (toolUse.name === 'get_cascade_shocks') cascade = result;
            }

            totalCostUnits += costUnits;
            toolResult = JSON.stringify(result, null, 2);
            console.log(`[agent] ✓ ${toolUse.name} — $${(costUnits * USD_PER_UNIT).toFixed(4)}`);
          } catch (err) {
            toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
            console.error(`[agent] ✗ ${toolUse.name}:`, toolResult);
          }

          return {
            type: 'tool_result' as const,
            tool_use_id: toolUse.id,
            content: toolResult,
          };
        }),
      );

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
