import { fetchPrices, pctChange } from './pyth.js';
import { researchMove } from './researcher.js';
import { runResearchAgent } from './agent.js';
import { sendAlert } from './alerts.js';
import { POLL_INTERVAL_MS, MOVE_THRESHOLD } from './config.js';

// Set RESEARCH_MODE=agent to use the Claude agentic loop (Claude picks endpoints).
// Defaults to 'sdk' (imperative Gordon SDK calls).
const RESEARCH_MODE = process.env['RESEARCH_MODE'] ?? 'agent';

// Previous-tick prices keyed by symbol
const prevPrices = new Map<string, number>();

async function tick(): Promise<void> {
  let prices;
  try {
    prices = await fetchPrices();
  } catch (err) {
    console.error('[pyth] fetch error:', err instanceof Error ? err.message : err);
    return;
  }

  for (const snap of prices) {
    const prev = prevPrices.get(snap.symbol);
    prevPrices.set(snap.symbol, snap.price);

    if (prev === undefined) continue; // first tick — no baseline yet

    const move = pctChange(prev, snap.price);
    if (Math.abs(move) < MOVE_THRESHOLD) continue;

    console.log(`[trigger] ${snap.symbol} moved ${(move * 100).toFixed(2)}% — starting research`);

    try {
      const moveEvent = {
        symbol: snap.symbol,
        prevPrice: prev,
        currPrice: snap.price,
        pctChange: move,
        timestamp: new Date(snap.publishTime * 1000),
      };
      const report = RESEARCH_MODE === 'agent'
        ? await runResearchAgent(moveEvent)
        : await researchMove(moveEvent);
      await sendAlert(report);
    } catch (err) {
      console.error(`[research] error for ${snap.symbol}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function main(): Promise<void> {
  console.log(`[bot] starting — mode: ${RESEARCH_MODE}, polling every ${POLL_INTERVAL_MS / 1000}s, threshold ${MOVE_THRESHOLD * 100}%`);
  console.log('[bot] metals tracked: XAU, XAG, XPD, XPT');

  // Run immediately then on interval
  await tick();
  setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
