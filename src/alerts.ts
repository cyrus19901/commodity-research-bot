import { ALERT_WEBHOOK_URL } from './config.js';
import type { ResearchReport } from './researcher.js';

const METAL_EMOJI: Record<string, string> = {
  XAU: '🥇', XAG: '🪙', XPD: '⚙️', XPT: '💎',
};

export function formatReport(report: ResearchReport): string {
  const { event, summary, costUsd } = report;
  const emoji = METAL_EMOJI[event.symbol] ?? '📊';
  const sign = event.pctChange > 0 ? '+' : '';
  const pct = (event.pctChange * 100).toFixed(2);

  return [
    `${emoji} ${event.symbol}/USD  ${sign}${pct}%  ${event.timestamp.toISOString()}`,
    `Price: $${event.prevPrice.toFixed(2)} → $${event.currPrice.toFixed(2)}`,
    ``,
    summary,
    ``,
    `Research cost: $${costUsd.toFixed(4)} USDC via Gordon x402`,
  ].join('\n');
}

export async function sendAlert(report: ResearchReport): Promise<void> {
  const text = formatReport(report);
  console.log('\n' + '='.repeat(60));
  console.log(text);
  console.log('='.repeat(60) + '\n');

  if (!ALERT_WEBHOOK_URL) return;

  // Slack/Discord-compatible webhook payload
  await fetch(ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}
