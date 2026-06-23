import { PYTH_HERMES_URL, PYTH_FEEDS } from './config.js';

export interface PriceSnapshot {
  symbol: string;
  feedId: string;
  price: number;       // USD
  confidence: number;  // ± USD
  publishTime: number; // unix seconds
}

interface HermesPriceData {
  price: string;
  conf: string;
  expo: number;
  publish_time: number;
}

interface HermesResponse {
  parsed: Array<{ id: string; price: HermesPriceData }>;
}

export async function fetchPrices(): Promise<PriceSnapshot[]> {
  const ids = Object.values(PYTH_FEEDS);
  const params = new URLSearchParams();
  for (const id of ids) params.append('ids[]', id);

  const res = await fetch(`${PYTH_HERMES_URL}?${params}`);
  if (!res.ok) throw new Error(`Pyth Hermes error: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as HermesResponse;

  const symbolByFeed = Object.fromEntries(
    Object.entries(PYTH_FEEDS).map(([sym, id]) => [id.toLowerCase(), sym])
  );

  return data.parsed.map(({ id, price: p }) => {
    const scale = Math.pow(10, p.expo);
    return {
      symbol: symbolByFeed[id.toLowerCase()] ?? id,
      feedId: id,
      price: parseInt(p.price, 10) * scale,
      confidence: parseInt(p.conf, 10) * scale,
      publishTime: p.publish_time,
    };
  });
}

export function pctChange(prev: number, curr: number): number {
  return (curr - prev) / prev;
}
