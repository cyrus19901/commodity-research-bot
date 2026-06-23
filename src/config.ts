import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const ANTHROPIC_API_KEY = required('ANTHROPIC_API_KEY');
export const GORDON_PLATFORM_URL = process.env['GORDON_PLATFORM_URL'] ?? 'https://api.withgordon.ai';
export const GORDON_AGENT_API_KEY = required('GORDON_AGENT_API_KEY');
export const GORDON_AGENT_API_SECRET = required('GORDON_AGENT_API_SECRET');

export const PYTH_HERMES_URL = 'https://hermes.pyth.network/v2/updates/price/latest';
export const PYTH_FEEDS: Record<string, string> = {
  XAU: process.env['PYTH_FEED_XAU'] ?? '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
  XAG: process.env['PYTH_FEED_XAG'] ?? '0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e',
  XPD: process.env['PYTH_FEED_XPD'] ?? '0x9a4df90b25497f66b1afb012467e316e801ca3d839456db028892fe8c70c8016',
  XPT: process.env['PYTH_FEED_XPT'] ?? '0x9855c0b93c5ebedc2c10a9f96cb5035b2b6f914eb20b82e7e796d6c8b2a4d8e',
};

export const POLL_INTERVAL_MS = parseInt(process.env['POLL_INTERVAL_SECONDS'] ?? '60', 10) * 1000;
export const MOVE_THRESHOLD = parseFloat(process.env['MOVE_THRESHOLD'] ?? '0.01');
export const CASCADE_THRESHOLD = parseFloat(process.env['CASCADE_THRESHOLD'] ?? '0.02');
export const ALERT_WEBHOOK_URL = process.env['ALERT_WEBHOOK_URL'] ?? '';

export const UNTITLED_BASE = 'https://intelligence.untitledfinancial.com';
