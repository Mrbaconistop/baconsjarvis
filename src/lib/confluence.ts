// Multi-Timeframe Pattern Confluence
import { detectAllPatterns, type Candle, type DetectedPattern } from "./patterns";

export type Timeframe = "1h" | "4h" | "1d" | "1w";

export interface TimeframeBucket {
  timeframe: Timeframe;
  candles: Candle[];
  patterns: DetectedPattern[];
  bias: number;
}

function resample(candles: Candle[], group: number): Candle[] {
  if (group <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += group) {
    const slice = candles.slice(i, i + group);
    if (!slice.length) continue;
    out.push({
      t: slice[slice.length - 1].t,
      o: slice[0].o,
      c: slice[slice.length - 1].c,
      h: Math.max(...slice.map((s) => s.h)),
      l: Math.min(...slice.map((s) => s.l)),
      v: slice.reduce((a, b) => a + b.v, 0),
    });
  }
  return out;
}

function downsample(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const mid = (c.o + c.c) / 2;
    const range = c.h - c.l;
    out.push({ t: c.t - 12 * 3600 * 1000, o: c.o, c: mid, h: Math.max(c.o, mid) + range * 0.15, l: Math.min(c.o, mid) - range * 0.15, v: c.v / 2 });
    out.push({ t: c.t, o: mid, c: c.c, h: Math.max(mid, c.c) + range * 0.15, l: Math.min(mid, c.c) - range * 0.15, v: c.v / 2 });
  }
  return out;
}

function bucketBias(patterns: DetectedPattern[]): number {
  const recent = patterns.slice(-8);
  if (!recent.length) return 0;
  let bull = 0, bear = 0;
  for (const p of recent) { if (p.bullish) bull += p.strength; else bear += p.strength; }
  const total = bull + bear;
  return total > 0 ? (bull - bear) / total : 0;
}

export function buildTimeframes(daily: Candle[]): TimeframeBucket[] {
  if (!daily.length) return [];
  const weekly = resample(daily, 5);
  const fourH = downsample(daily.slice(-120));
  const oneH = downsample(fourH.slice(-60));
  const buckets: { tf: Timeframe; c: Candle[] }[] = [
    { tf: "1h", c: oneH },
    { tf: "4h", c: fourH },
    { tf: "1d", c: daily },
    { tf: "1w", c: weekly },
  ];
  return buckets.map((b) => {
    const patterns = detectAllPatterns(b.c);
    return { timeframe: b.tf, candles: b.c, patterns, bias: bucketBias(patterns) };
  });
}

export interface ConfluenceResult {
  score: number;
  netBias: number;
  agreement: number;
  buckets: TimeframeBucket[];
  dominantDirection: "bullish" | "bearish" | "neutral";
}

export function confluenceScore(daily: Candle[]): ConfluenceResult {
  const buckets = buildTimeframes(daily);
  if (!buckets.length) return { score: 0, netBias: 0, agreement: 0, buckets: [], dominantDirection: "neutral" };
  const biases = buckets.map((b) => b.bias);
  const net = biases.reduce((a, b) => a + b, 0) / biases.length;
  const dominant = net > 0.08 ? 1 : net < -0.08 ? -1 : 0;
  const agree = dominant === 0 ? 0 : biases.filter((b) => Math.sign(b) === dominant).length / biases.length;
  const score = Math.round(agree * 3 + Math.min(2, Math.abs(net) * 4));
  return { score, netBias: net, agreement: agree, buckets, dominantDirection: dominant > 0 ? "bullish" : dominant < 0 ? "bearish" : "neutral" };
}
