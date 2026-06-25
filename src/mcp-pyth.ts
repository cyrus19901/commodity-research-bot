/**
 * Pyth MCP Server — exposes Pyth Hermes price feeds as MCP tools.
 *
 * Tools:
 *   get_metal_prices — returns live XAU, XAG, XPD, XPT spot prices from Pyth Hermes.
 *   get_price_move  — takes prev/curr price and returns % change + triggers research flag.
 *
 * Add to ~/.cursor/mcp.json:
 *   "pyth": {
 *     "type": "stdio",
 *     "command": "node",
 *     "args": ["--import", "tsx/esm", "/path/to/commodity-research-bot/src/mcp-pyth.ts"]
 *   }
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const HERMES = 'https://hermes.pyth.network/v2/updates/price/latest';

// Feed IDs from https://pyth.network/price-feeds (filter: Metal)
const FEEDS: Record<string, string> = {
  XAU: '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
  XAG: '0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e',
  XPD: '0x80367e9664197f37d89a07a804dffd2101c479c7c4e8490501bc9d9e1e7f9021',
  XPT: '0x398e4bbc7cbf89d6648c21e08019d878967677753b3096799595c78f805a34e5',
};

interface HermesResponse {
  parsed: Array<{
    id: string;
    price: { price: string; conf: string; expo: number; publish_time: number };
  }>;
}

async function fetchPythPrices(): Promise<Record<string, { price: number; conf: number; publishTime: number }>> {
  // Build query string manually — URLSearchParams percent-encodes `[]` which breaks Pyth's parser
  const query = Object.values(FEEDS).map(id => `ids[]=${id}`).join('&');
  const res = await fetch(`${HERMES}?${query}`);
  if (!res.ok) throw new Error(`Pyth Hermes ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as HermesResponse;

  const idToSymbol: Record<string, string> = {};
  for (const [sym, id] of Object.entries(FEEDS)) {
    idToSymbol[id.replace('0x', '').toLowerCase()] = sym;
  }

  const result: Record<string, { price: number; conf: number; publishTime: number }> = {};
  for (const p of data.parsed) {
    const symbol = idToSymbol[p.id.toLowerCase()] ?? p.id;
    const scale = Math.pow(10, p.price.expo);
    result[symbol] = {
      price: parseInt(p.price.price, 10) * scale,
      conf: parseInt(p.price.conf, 10) * scale,
      publishTime: p.price.publish_time,
    };
  }
  return result;
}

const server = new Server(
  { name: 'pyth-metals', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_metal_prices',
      description:
        'Fetch live spot prices for XAU (Gold), XAG (Silver), XPD (Palladium), ' +
        'and XPT (Platinum) from Pyth Hermes. Returns USD price, ±confidence interval, ' +
        'and publish timestamp for each metal.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_price_move',
      description:
        'Calculate the % change between two prices and assess whether it exceeds ' +
        'the research threshold (default 1%). Use this to decide if a move warrants ' +
        'calling Gordon intelligence endpoints.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Metal symbol, e.g. XAU' },
          prev_price: { type: 'number', description: 'Previous price in USD' },
          curr_price: { type: 'number', description: 'Current price in USD' },
          threshold_pct: {
            type: 'number',
            description: 'Move threshold in % (default 1.0)',
          },
        },
        required: ['symbol', 'prev_price', 'curr_price'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === 'get_metal_prices') {
    const prices = await fetchPythPrices();
    const rows = Object.entries(prices).map(([sym, p]) => ({
      symbol: sym,
      price_usd: Math.round(p.price * 100) / 100,
      confidence_usd: Math.round(p.conf * 100) / 100,
      publish_time: new Date(p.publishTime * 1000).toISOString(),
    }));
    return {
      content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
    };
  }

  if (name === 'get_price_move') {
    const { symbol, prev_price, curr_price, threshold_pct = 1.0 } = args as {
      symbol: string;
      prev_price: number;
      curr_price: number;
      threshold_pct?: number;
    };
    const pct = ((curr_price - prev_price) / prev_price) * 100;
    const absPct = Math.abs(pct);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            symbol,
            prev_price,
            curr_price,
            pct_change: Math.round(pct * 1000) / 1000,
            abs_pct: Math.round(absPct * 1000) / 1000,
            direction: pct > 0 ? 'up' : 'down',
            threshold_pct,
            exceeds_threshold: absPct >= threshold_pct,
            cascade_threshold: absPct >= 2.0,
          }),
        },
      ],
    };
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
