// Pure analysis utilities — safe on client and server.
export type PricePoint = { t: number; p: number; v: number };

export function sma(arr: number[], n: number): number {
  if (arr.length < n) return arr[arr.length - 1] ?? 0;
  const s = arr.slice(-n).reduce((a, b) => a + b, 0);
  return s / n;
}

export function rsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const ch = prices[i] - prices[i - 1];
    if (ch >= 0) gains += ch; else losses -= ch;
  }
  const rs = gains / Math.max(losses, 1e-9);
  return 100 - 100 / (1 + rs);
}

export function macd(prices: number[]): { macd: number; signal: number; hist: number } {
  const ema = (n: number) => {
    const k = 2 / (n + 1);
    let e = prices[0];
    for (let i = 1; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
    return e;
  };
  const m = ema(12) - ema(26);
  const signal = m * 0.9;
  return { macd: m, signal, hist: m - signal };
}

export function stdev(arr: number[]): number {
  if (!arr.length) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

export function returns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) r.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  return r;
}

export interface NewsLite { headline: string; summary: string; datetime: number; }

const POS = ["beat", "beats", "surge", "soar", "record", "growth", "upgrade", "buy", "outperform", "strong", "profit", "gain", "bullish", "rally", "raise", "raised", "exceed"];
const NEG = ["miss", "misses", "plunge", "slump", "fall", "decline", "downgrade", "sell", "underperform", "weak", "loss", "drop", "bearish", "cut", "lower", "fraud", "lawsuit", "investigation", "warn"];

export function sentimentScore(news: NewsLite[]): { score: number; positive: number; negative: number; neutral: number } {
  if (!news.length) return { score: 0, positive: 0, negative: 0, neutral: 0 };
  let pos = 0, neg = 0;
  const now = Date.now() / 1000;
  let weighted = 0, weightTotal = 0;
  for (const n of news) {
    const text = `${n.headline} ${n.summary ?? ""}`.toLowerCase();
    let s = 0;
    for (const w of POS) if (text.includes(w)) s += 1;
    for (const w of NEG) if (text.includes(w)) s -= 1;
    const ageDays = Math.max(1, (now - n.datetime) / 86400);
    const w = 1 / Math.sqrt(ageDays);
    weighted += s * w; weightTotal += w;
    if (s > 0) pos++; else if (s < 0) neg++;
  }
  const raw = weightTotal ? weighted / weightTotal : 0;
  return {
    score: Math.max(-1, Math.min(1, raw / 3)),
    positive: pos, negative: neg, neutral: news.length - pos - neg,
  };
}
