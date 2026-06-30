/**
 * Quick smoke-test for the multi-source research agent.
 * Fires a synthetic XAU/USD 2.1% move and prints the full report.
 * Run with: npx tsx src/test-agent.ts
 */

import 'dotenv/config';
import { runResearchAgent } from './agent.js';
import type { MoveEvent } from './researcher.js';

const event: MoveEvent = {
  symbol: 'XAU/USD',
  prevPrice: 3180.00,
  currPrice: 3246.78,
  pctChange: 0.021,
  timestamp: new Date(),
};

console.log('='.repeat(60));
console.log('SMOKE TEST — multi-source commodity research agent');
console.log('='.repeat(60));
console.log(`Event: ${event.symbol} +${(event.pctChange * 100).toFixed(2)}%`);
console.log(`Price: $${event.prevPrice} → $${event.currPrice}`);
console.log(`Time:  ${event.timestamp.toISOString()}`);
console.log('='.repeat(60));
console.log('');

try {
  const report = await runResearchAgent(event);

  console.log('');
  console.log('='.repeat(60));
  console.log('RESEARCH REPORT');
  console.log('='.repeat(60));
  console.log('');
  console.log('SUMMARY:');
  console.log(report.summary);
  console.log('');
  console.log(`TOTAL COST: $${report.costUsd.toFixed(4)} USDC`);
  console.log('');
  console.log('SIGNALS COLLECTED:');
  console.log('  marketContext:          ', report.marketContext ? '✓' : '✗ (null)');
  console.log('  macroStress:            ', report.macroStress ? '✓' : '✗ (null)');
  console.log('  currencyStress:         ', report.currencyStress ? '✓' : '✗ (null)');
  console.log('  commodityIntelligence:  ', report.commodityIntelligence ? '✓' : '✗ (null)');
  console.log('  cascade:                ', report.cascade ? '✓ (≥2% triggered)' : '— (not triggered)');
  console.log('');

  if (report.marketContext) {
    console.log('RAW MARKET CONTEXT (first 500 chars):');
    console.log(JSON.stringify(report.marketContext, null, 2).slice(0, 500) + '...');
  }
} catch (err) {
  console.error('AGENT ERROR:', err);
  process.exit(1);
}
