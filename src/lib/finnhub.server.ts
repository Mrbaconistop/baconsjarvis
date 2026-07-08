// Server-only Finnhub + Yahoo historical client.
const BASE = "https://finnhub.io/api/v1";

function key() {
  const k = process.env.FINNHUB_API_KEY;
  if (!k) throw new Error("FINNHUB_API_KEY is not configured");
  return k;
}

async function fh<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  url.searchParams.set("token", key());
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Finnhub ${path} failed [${res.status}]: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface Quote { c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number; }
export interface Profile { name?: string; ticker?: string; finnhubIndustry?: string; logo?: string; marketCapitalization?: number; weburl?: string; exchange?: string; currency?: string; }
export interface BasicFinancials { metric?: Record<string, number | undefined>; }
export interface NewsItem { id: number; category: string; datetime: number; headline: string; image: string; related: string; source: string; summary: string; url: string; }

export const fhQuote = (symbol: string) => fh<Quote>("/quote", { symbol });
export const fhProfile = (symbol: string) => fh<Profile>("/stock/profile2", { symbol });
export const fhFinancials = (symbol: string) => fh<BasicFinancials>("/stock/metric", { symbol, metric: "all" });
export const fhNews = (symbol: string) => fh<NewsItem[]>("/company-news", {
  symbol,
  from: new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10),
  to: new Date().toISOString().slice(0, 10),
});
export const fhSearch = (q: string) =>
  fh<{ count: number; result: Array<{ symbol: string; description: string; displaySymbol: string; type: string }> }>(
    "/search", { q }
  );

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; }

const _histCache = new Map<string, { at: number; data: Candle[] }>();
const HIST_TTL_MS = 15 * 60_000;

export async function fetchHistorical(
  symbol: string, range: "1y" | "2y" | "5y" = "2y", interval: "1d" | "1wk" = "1d",
): Promise<Candle[]> {
  const cacheKey = `${symbol}|${range}|${interval}`;
  const hit = _histCache.get(cacheKey);
  if (hit && Date.now() - hit.at < HIST_TTL_MS) return hit.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; JarvisAnalyzer/1.0)" } });
  if (!res.ok) throw new Error(`Yahoo chart failed [${res.status}]`);
  const json = await res.json() as any;
  const r = json?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error("No historical data");
  const ts: number[] = r.timestamp;
  const q = r.indicators?.quote?.[0] ?? {};
  const adj = r.indicators?.adjclose?.[0]?.adjclose as number[] | undefined;
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = adj?.[i] ?? q.close?.[i];
    const o = q.open?.[i] ?? c;
    const h = q.high?.[i] ?? c;
    const l = q.low?.[i] ?? c;
    const v = q.volume?.[i] ?? 0;
    if (c == null || isNaN(c)) continue;
    out.push({ t: ts[i] * 1000, o, h, l, c, v });
  }
  _histCache.set(cacheKey, { at: Date.now(), data: out });
  return out;
}

export function synthSeries(symbol: string, currentPrice: number, days: number): Array<{ t: number; p: number; v: number }> {
  let h = 2166136261;
  for (const ch of symbol) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out: Array<{ t: number; p: number; v: number }> = [];
  const vol = 0.012 + (rand() * 0.018);
  const drift = (rand() - 0.45) * 0.0008;
  let p = currentPrice;
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    const t = now - i * 86400_000;
    out.push({ t, p, v: 1_000_000 + Math.floor(rand() * 8_000_000) });
    const shock = (rand() - 0.5) * 2 * vol;
    p = p / (1 + drift + shock);
  }
  return out.reverse();
}
