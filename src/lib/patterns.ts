// Pattern detection, autotune, multi-type predictor & backtesting.
import { sma, rsi, macd, stdev, returns, sentimentScore, type NewsLite } from "./analytics";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export function toOHLC(series: { t: number; p: number; v: number }[]): Candle[] {
  if (!series.length) return [];
  const out: Candle[] = [];
  let h = 2166136261;
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  for (let i = 0; i < series.length; i++) {
    const prev = series[i - 1]?.p ?? series[i].p;
    const c = series[i].p;
    const o = prev;
    const spread = Math.abs(c - o) + Math.max(c, o) * (0.005 + rand() * 0.012);
    const top = Math.max(o, c) + spread * rand() * 0.7;
    const bot = Math.min(o, c) - spread * rand() * 0.7;
    out.push({ t: series[i].t, o, h: top, l: Math.max(0, bot), c, v: series[i].v });
  }
  return out;
}

export interface DetectedPattern {
  id: string;
  kind: "candle" | "chart" | "breakout";
  label: string;
  index: number;
  t: number;
  bullish: boolean;
  strength: number;
  target?: number;
  stop?: number;
  description: string;
}

const body = (c: Candle) => Math.abs(c.c - c.o);
const range = (c: Candle) => Math.max(1e-9, c.h - c.l);
const upperWick = (c: Candle) => c.h - Math.max(c.o, c.c);
const lowerWick = (c: Candle) => Math.min(c.o, c.c) - c.l;

export function detectCandlePatterns(c: Candle[]): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  for (let i = 2; i < c.length; i++) {
    const a = c[i - 2], b = c[i - 1], k = c[i];
    const br = body(k) / range(k);
    if (br < 0.1 && range(k) > 0) out.push({ id: `doji-${i}`, kind: "candle", label: "Doji", index: i, t: k.t, bullish: false, strength: 0.4, description: "Indecision — body < 10% of range." });
    if (br < 0.35 && lowerWick(k) > body(k) * 2 && upperWick(k) < body(k) && k.c >= k.o) out.push({ id: `hammer-${i}`, kind: "candle", label: "Hammer", index: i, t: k.t, bullish: true, strength: 0.65, description: "Long lower wick, rejection of lows." });
    if (br < 0.35 && upperWick(k) > body(k) * 2 && lowerWick(k) < body(k) && k.c <= k.o) out.push({ id: `shoot-${i}`, kind: "candle", label: "Shooting Star", index: i, t: k.t, bullish: false, strength: 0.65, description: "Long upper wick, rejection of highs." });
    if (b.c < b.o && k.c > k.o && k.c >= b.o && k.o <= b.c && body(k) > body(b) * 1.05) out.push({ id: `engulfB-${i}`, kind: "candle", label: "Bullish Engulfing", index: i, t: k.t, bullish: true, strength: 0.75, description: "Bull body fully engulfs prior bear body." });
    if (b.c > b.o && k.c < k.o && k.o >= b.c && k.c <= b.o && body(k) > body(b) * 1.05) out.push({ id: `engulfS-${i}`, kind: "candle", label: "Bearish Engulfing", index: i, t: k.t, bullish: false, strength: 0.75, description: "Bear body fully engulfs prior bull body." });
    if (a.c < a.o && body(b) < body(a) * 0.5 && k.c > k.o && k.c > (a.o + a.c) / 2) out.push({ id: `morn-${i}`, kind: "candle", label: "Morning Star", index: i, t: k.t, bullish: true, strength: 0.8, description: "Three-bar bullish reversal." });
    if (a.c > a.o && body(b) < body(a) * 0.5 && k.c < k.o && k.c < (a.o + a.c) / 2) out.push({ id: `eve-${i}`, kind: "candle", label: "Evening Star", index: i, t: k.t, bullish: false, strength: 0.8, description: "Three-bar bearish reversal." });
    if (br > 0.92) {
      const bull = k.c > k.o;
      out.push({ id: `maru${bull ? "B" : "S"}-${i}`, kind: "candle", label: bull ? "Bullish Marubozu" : "Bearish Marubozu", index: i, t: k.t, bullish: bull, strength: 0.7, description: "Full body, no wicks — strong conviction." });
    }
  }
  return out;
}

function pivots(c: Candle[], lookback: number) {
  const highs: number[] = [], lows: number[] = [];
  for (let i = lookback; i < c.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (c[j].h >= c[i].h) isHigh = false;
      if (c[j].l <= c[i].l) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

export function detectChartPatterns(c: Candle[], lookback = 5): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  if (c.length < lookback * 4) return out;
  const { highs, lows } = pivots(c, lookback);
  for (let i = 1; i < highs.length; i++) {
    const A = highs[i - 1], B = highs[i];
    if (B - A < 8 || B - A > 80) continue;
    const pa = c[A].h, pb = c[B].h;
    if (Math.abs(pa - pb) / pa > 0.025) continue;
    const neckIdx = lows.find((x) => x > A && x < B);
    if (neckIdx == null) continue;
    const neck = c[neckIdx].l;
    if (c[c.length - 1].c < neck) {
      const target = neck - (pa - neck);
      out.push({ id: `dt-${B}`, kind: "chart", label: "Double Top", index: B, t: c[B].t, bullish: false, strength: 0.75, target, stop: pa, description: "Two equal highs with broken neckline." });
    }
  }
  for (let i = 1; i < lows.length; i++) {
    const A = lows[i - 1], B = lows[i];
    if (B - A < 8 || B - A > 80) continue;
    const pa = c[A].l, pb = c[B].l;
    if (Math.abs(pa - pb) / pa > 0.025) continue;
    const neckIdx = highs.find((x) => x > A && x < B);
    if (neckIdx == null) continue;
    const neck = c[neckIdx].h;
    if (c[c.length - 1].c > neck) {
      const target = neck + (neck - pa);
      out.push({ id: `db-${B}`, kind: "chart", label: "Double Bottom", index: B, t: c[B].t, bullish: true, strength: 0.78, target, stop: pa, description: "Two equal lows with broken neckline." });
    }
  }
  for (let i = 2; i < highs.length; i++) {
    const L = highs[i - 2], H = highs[i - 1], R = highs[i];
    if (H - L < 5 || R - H < 5) continue;
    const pL = c[L].h, pH = c[H].h, pR = c[R].h;
    if (pH <= pL || pH <= pR) continue;
    if (Math.abs(pL - pR) / pL > 0.05) continue;
    const neckLows = lows.filter((x) => x > L && x < R);
    if (neckLows.length < 2) continue;
    const neck = (c[neckLows[0]].l + c[neckLows[neckLows.length - 1]].l) / 2;
    const target = neck - (pH - neck);
    out.push({ id: `hs-${R}`, kind: "chart", label: "Head & Shoulders", index: R, t: c[R].t, bullish: false, strength: 0.82, target, stop: pH, description: "Classic bearish reversal." });
  }
  for (let i = 2; i < lows.length; i++) {
    const L = lows[i - 2], H = lows[i - 1], R = lows[i];
    if (H - L < 5 || R - H < 5) continue;
    const pL = c[L].l, pH = c[H].l, pR = c[R].l;
    if (pH >= pL || pH >= pR) continue;
    if (Math.abs(pL - pR) / pL > 0.05) continue;
    const neckHighs = highs.filter((x) => x > L && x < R);
    if (neckHighs.length < 2) continue;
    const neck = (c[neckHighs[0]].h + c[neckHighs[neckHighs.length - 1]].h) / 2;
    const target = neck + (neck - pH);
    out.push({ id: `ihs-${R}`, kind: "chart", label: "Inverse H&S", index: R, t: c[R].t, bullish: true, strength: 0.82, target, stop: pH, description: "Bullish reversal." });
  }
  if (highs.length >= 3 && lows.length >= 3) {
    const lastH = highs.slice(-3), lastL = lows.slice(-3);
    const hSlope = (c[lastH[2]].h - c[lastH[0]].h) / Math.max(1, lastH[2] - lastH[0]);
    const lSlope = (c[lastL[2]].l - c[lastL[0]].l) / Math.max(1, lastL[2] - lastL[0]);
    if (hSlope < 0 && lSlope > 0) out.push({ id: `tri-sym-${c.length}`, kind: "chart", label: "Symmetrical Triangle", index: c.length - 1, t: c[c.length - 1].t, bullish: c[c.length - 1].c > (c[c.length - 10]?.c ?? c[c.length - 1].c), strength: 0.55, description: "Converging highs and lows." });
    else if (Math.abs(hSlope) < 1e-3 && lSlope > 0) out.push({ id: `tri-asc-${c.length}`, kind: "chart", label: "Ascending Triangle", index: c.length - 1, t: c[c.length - 1].t, bullish: true, strength: 0.7, description: "Flat resistance, rising support." });
    else if (hSlope < 0 && Math.abs(lSlope) < 1e-3) out.push({ id: `tri-desc-${c.length}`, kind: "chart", label: "Descending Triangle", index: c.length - 1, t: c[c.length - 1].t, bullish: false, strength: 0.7, description: "Flat support, falling resistance." });
  }
  if (c.length > 25) {
    const a = c[c.length - 25].c, b = c[c.length - 15].c;
    const impulse = (b - a) / a;
    const recent = c.slice(-12).map((x) => x.c);
    const consol = (Math.max(...recent) - Math.min(...recent)) / Math.min(...recent);
    if (Math.abs(impulse) > 0.05 && consol < 0.035) {
      const bullish = impulse > 0;
      out.push({ id: `flag-${c.length}`, kind: "chart", label: bullish ? "Bull Flag" : "Bear Flag", index: c.length - 1, t: c[c.length - 1].t, bullish, strength: 0.7, target: c[c.length - 1].c * (1 + impulse * 0.8), description: "Sharp move followed by tight pullback." });
    }
  }
  return out;
}

export function detectBreakouts(c: Candle[], window = 40): DetectedPattern[] {
  if (c.length < window + 2) return [];
  const seg = c.slice(-window);
  const n = seg.length;
  const xs = seg.map((_, i) => i);
  const ys = seg.map((s) => s.c);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = num / Math.max(1e-9, den);
  const intercept = my - slope * mx;
  const resid = ys.map((y, i) => y - (intercept + slope * i));
  const sd = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / n);
  const last = ys[n - 1];
  const fit = intercept + slope * (n - 1);
  const z = (last - fit) / Math.max(1e-9, sd);
  if (Math.abs(z) > 1.5) {
    const bullish = z > 0;
    return [{ id: `brk-${c.length}`, kind: "breakout", label: bullish ? "Trendline Breakout ↑" : "Trendline Breakdown ↓", index: c.length - 1, t: c[c.length - 1].t, bullish, strength: Math.min(1, Math.abs(z) / 3), description: `Close is ${z.toFixed(2)}σ ${bullish ? "above" : "below"} the ${window}-bar regression.` }];
  }
  return [];
}

export function detectAllPatterns(c: Candle[]): DetectedPattern[] {
  return [...detectCandlePatterns(c), ...detectChartPatterns(c), ...detectBreakouts(c)];
}

export interface PatternReliability { label: string; total: number; hits: number; hitRate: number; avgReturnPct: number; avgMagnitudePct: number; }

export function reliabilityByPattern(c: Candle[], patterns: DetectedPattern[], forwardBars = 5): PatternReliability[] {
  const buckets = new Map<string, { total: number; hits: number; rets: number[]; mags: number[] }>();
  for (const p of patterns) {
    const fwdIdx = p.index + forwardBars;
    if (fwdIdx >= c.length) continue;
    const ret = (c[fwdIdx].c - c[p.index].c) / c[p.index].c;
    const aligned = p.bullish ? ret : -ret;
    const b = buckets.get(p.label) ?? { total: 0, hits: 0, rets: [], mags: [] };
    b.total += 1;
    if (aligned > 0) b.hits += 1;
    b.rets.push(aligned);
    b.mags.push(Math.abs(ret));
    buckets.set(p.label, b);
  }
  return [...buckets.entries()].map(([label, b]) => ({
    label, total: b.total, hits: b.hits,
    hitRate: b.total ? b.hits / b.total : 0,
    avgReturnPct: b.rets.length ? b.rets.reduce((a, b) => a + b, 0) / b.rets.length : 0,
    avgMagnitudePct: b.mags.length ? b.mags.reduce((a, b) => a + b, 0) / b.mags.length : 0,
  })).sort((a, b) => b.hitRate - a.hitRate);
}

export interface TuneParams { smaFast: number; smaSlow: number; rsiPeriod: number; rsiOversold: number; rsiOverbought: number; bbWidth: number; }
export const DEFAULT_PARAMS: TuneParams = { smaFast: 20, smaSlow: 50, rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70, bbWidth: 2 };

export interface TuneResult { best: TuneParams; score: number; trades: number; improvement: number; iterations: number; defaultScore: number; }

function scoreParams(c: Candle[], p: TuneParams, forward = 5): { score: number; trades: number } {
  const closes = c.map((x) => x.c);
  let hits = 0, total = 0;
  for (let i = Math.max(p.smaSlow, p.rsiPeriod) + 1; i < c.length - forward; i++) {
    const window = closes.slice(0, i + 1);
    const fast = sma(window, p.smaFast);
    const slow = sma(window, p.smaSlow);
    const r = rsi(window, p.rsiPeriod);
    let signal: 0 | 1 | -1 = 0;
    if (fast > slow && r < p.rsiOverbought && r > p.rsiOversold) signal = 1;
    else if (fast < slow && r > p.rsiOversold) signal = -1;
    const mean = sma(window, 20);
    const sd = stdev(window.slice(-20));
    if (window[window.length - 1] < mean - p.bbWidth * sd) signal = 1;
    if (window[window.length - 1] > mean + p.bbWidth * sd) signal = -1;
    if (signal === 0) continue;
    const ret = (c[i + forward].c - c[i].c) / c[i].c;
    if (Math.sign(ret) === signal) hits += 1;
    total += 1;
  }
  return { score: total ? hits / total : 0, trades: total };
}

export function autotune(c: Candle[], onProgress?: (done: number, total: number) => void): TuneResult {
  const grid: TuneParams[] = [];
  for (const smaFast of [10, 15, 20]) for (const smaSlow of [40, 50, 100]) {
    for (const rsiPeriod of [10, 14, 21]) for (const rsiOversold of [25, 30, 35]) {
      for (const rsiOverbought of [65, 70, 75]) for (const bbWidth of [1.8, 2, 2.5]) {
        if (smaFast >= smaSlow) continue;
        grid.push({ smaFast, smaSlow, rsiPeriod, rsiOversold, rsiOverbought, bbWidth });
      }
    }
  }
  let best = grid[0]; let bestScore = 0; let bestTrades = 0;
  for (let i = 0; i < grid.length; i++) {
    const r = scoreParams(c, grid[i]);
    if (r.trades >= 8 && r.score > bestScore) { bestScore = r.score; best = grid[i]; bestTrades = r.trades; }
    onProgress?.(i + 1, grid.length);
  }
  const def = scoreParams(c, DEFAULT_PARAMS);
  return { best, score: bestScore, trades: bestTrades, defaultScore: def.score, improvement: bestScore - def.score, iterations: grid.length };
}

export type PredictorMode = "candlestick" | "indicator" | "pattern" | "ml";

export interface PredictorResult {
  mode: PredictorMode;
  direction: "up" | "down" | "flat";
  probability: number;
  horizonBars: number;
  targetPrice?: number;
  explanation: string;
  contributors: { label: string; weight: number }[];
}

export function predictCandlestick(c: Candle[], news: NewsLite[]): PredictorResult {
  const recent = detectCandlePatterns(c).slice(-6);
  let bull = 0, bear = 0;
  const contrib: { label: string; weight: number }[] = [];
  for (const p of recent) {
    const w = p.strength * (1 - (c.length - 1 - p.index) / 10);
    if (w <= 0) continue;
    if (p.bullish) bull += w; else bear += w;
    contrib.push({ label: p.label, weight: p.bullish ? w : -w });
  }
  const sent = sentimentScore(news).score;
  bull += Math.max(0, sent) * 0.5;
  bear += Math.max(0, -sent) * 0.5;
  const total = bull + bear;
  const prob = total > 0 ? bull / total : 0.5;
  const lastClose = c[c.length - 1].c;
  return {
    mode: "candlestick",
    direction: prob > 0.55 ? "up" : prob < 0.45 ? "down" : "flat",
    probability: prob > 0.5 ? prob : 1 - prob,
    horizonBars: 1,
    targetPrice: lastClose * (1 + (prob - 0.5) * 0.04),
    explanation: `${Math.round((prob > 0.5 ? prob : 1 - prob) * 100)}% bias from ${recent.length} recent candle pattern(s).`,
    contributors: contrib,
  };
}

export function predictIndicator(c: Candle[], p: TuneParams, news: NewsLite[] = []): PredictorResult {
  const closes = c.map((x) => x.c);
  const fast = sma(closes, p.smaFast);
  const slow = sma(closes, p.smaSlow);
  const r = rsi(closes, p.rsiPeriod);
  const m = macd(closes);
  const last = closes[closes.length - 1];
  const mean = sma(closes, 20);
  const sd = stdev(closes.slice(-20));
  const z = (last - mean) / Math.max(1e-9, sd);
  const seg = closes.slice(-Math.min(20, closes.length));
  const slope = seg.length > 1 ? (seg[seg.length - 1] - seg[0]) / seg[0] / seg.length : 0;
  const sent = sentimentScore(news);
  let bull = 0, bear = 0;
  const contrib: { label: string; weight: number }[] = [];
  if (fast > slow) { bull += 1; contrib.push({ label: "SMA fast > slow", weight: 1 }); }
  else { bear += 1; contrib.push({ label: "SMA fast < slow", weight: -1 }); }
  if (r < p.rsiOversold) { bull += 1.5; contrib.push({ label: `RSI ${r.toFixed(0)} oversold`, weight: 1.5 }); }
  if (r > p.rsiOverbought) { bear += 1.5; contrib.push({ label: `RSI ${r.toFixed(0)} overbought`, weight: -1.5 }); }
  if (m.hist > 0) { bull += 0.8; contrib.push({ label: "MACD histogram +", weight: 0.8 }); }
  else { bear += 0.8; contrib.push({ label: "MACD histogram −", weight: -0.8 }); }
  if (z < -p.bbWidth) { bull += 1; contrib.push({ label: `Below lower BB (${z.toFixed(2)}σ)`, weight: 1 }); }
  if (z > p.bbWidth) { bear += 1; contrib.push({ label: `Above upper BB (${z.toFixed(2)}σ)`, weight: -1 }); }
  const slopeW = Math.max(-1.2, Math.min(1.2, slope * 80));
  if (Math.abs(slopeW) > 0.05) {
    if (slopeW > 0) bull += slopeW; else bear += -slopeW;
    contrib.push({ label: `20-bar trend slope`, weight: slopeW });
  }
  if (news.length) {
    let sW = sent.score * 1.0;
    if (sent.negative === 0 && sent.positive >= 3) sW = Math.max(sW, 0.8);
    else if (sent.positive === 0 && sent.negative >= 3) sW = Math.min(sW, -0.8);
    if (sW > 0) bull += sW; else bear += -sW;
    contrib.push({ label: `News sentiment (${sent.positive}↑/${sent.negative}↓)`, weight: sW });
  }
  const total = bull + bear;
  const prob = total > 0 ? bull / total : 0.5;
  return {
    mode: "indicator",
    direction: prob > 0.55 ? "up" : prob < 0.45 ? "down" : "flat",
    probability: prob > 0.5 ? prob : 1 - prob,
    horizonBars: 5,
    targetPrice: last * (1 + (prob - 0.5) * 0.06),
    explanation: `Tuned indicator stack (RSI ${p.rsiPeriod}, SMA ${p.smaFast}/${p.smaSlow}) + trend + news is ${prob > 0.5 ? "bullish" : "bearish"}.`,
    contributors: contrib,
  };
}

export function predictPatternCompletion(c: Candle[]): PredictorResult {
  const chart = detectChartPatterns(c);
  const active = chart[chart.length - 1];
  const last = c[c.length - 1].c;
  if (!active || active.target == null) {
    return { mode: "pattern", direction: "flat", probability: 0.5, horizonBars: 20, explanation: "No active chart pattern with a measured move.", contributors: [] };
  }
  const move = (active.target - last) / last;
  return {
    mode: "pattern",
    direction: move > 0.005 ? "up" : move < -0.005 ? "down" : "flat",
    probability: 0.5 + active.strength * 0.3,
    horizonBars: 20,
    targetPrice: active.target,
    explanation: `${active.label} active with measured target ${(move * 100).toFixed(1)}% away.`,
    contributors: [{ label: active.label, weight: active.bullish ? 1 : -1 }],
  };
}

export function predictML(c: Candle[], news: NewsLite[]): PredictorResult {
  const closes = c.map((x) => x.c);
  const r5 = closes.length > 5 ? (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6] : 0;
  const r20 = closes.length > 20 ? (closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21] : 0;
  const r = rsi(closes);
  const m = macd(closes);
  const vol = stdev(returns(closes));
  const sent = sentimentScore(news).score;
  const z = r5 * 6 + r20 * 3 + (50 - r) / 20 + Math.sign(m.hist) * 0.5 + sent * 0.8;
  const prob = 1 / (1 + Math.exp(-z));
  const horizon = 5;
  const last = closes[closes.length - 1];
  return {
    mode: "ml",
    direction: prob > 0.55 ? "up" : prob < 0.45 ? "down" : "flat",
    probability: prob > 0.5 ? prob : 1 - prob,
    horizonBars: horizon,
    targetPrice: last * (1 + (prob - 0.5) * 0.08 + Math.sign(prob - 0.5) * vol * Math.sqrt(horizon)),
    explanation: `Logistic blend of momentum, RSI, MACD, vol, sentiment → P(up)=${(prob * 100).toFixed(0)}%.`,
    contributors: [
      { label: "5-bar momentum", weight: r5 * 6 },
      { label: "20-bar momentum", weight: r20 * 3 },
      { label: "RSI bias", weight: (50 - r) / 20 },
      { label: "MACD hist", weight: Math.sign(m.hist) * 0.5 },
      { label: "News sentiment", weight: sent * 0.8 },
    ],
  };
}

export function runPredictor(mode: PredictorMode, c: Candle[], news: NewsLite[], params: TuneParams): PredictorResult {
  switch (mode) {
    case "candlestick": return predictCandlestick(c, news);
    case "indicator": return predictIndicator(c, params, news);
    case "pattern": return predictPatternCompletion(c);
    case "ml": return predictML(c, news);
  }
}

export interface NewsLink {
  pattern: DetectedPattern;
  matched: { headline: string; datetime: number; sentiment: "positive" | "negative" | "neutral"; category: string }[];
}

const NPOS = ["beat", "beats", "surge", "soar", "record", "growth", "upgrade", "buy", "outperform", "strong", "profit", "rally", "raise"];
const NNEG = ["miss", "plunge", "slump", "fall", "decline", "downgrade", "sell", "weak", "loss", "drop", "bearish", "cut", "lower", "lawsuit", "investigation", "warn"];
const CATS: Record<string, string[]> = {
  earnings: ["earnings", "eps", "revenue", "quarter", "guidance"],
  "M&A": ["acquire", "acquisition", "merger", "takeover", "buyout"],
  macro: ["fed", "inflation", "cpi", "jobs", "rate", "tariff"],
  product: ["launch", "product", "release", "unveil"],
  legal: ["lawsuit", "sec", "investigation", "settle"],
};

function classifyNews(text: string): { sentiment: "positive" | "negative" | "neutral"; category: string } {
  const t = text.toLowerCase();
  let s = 0;
  for (const w of NPOS) if (t.includes(w)) s += 1;
  for (const w of NNEG) if (t.includes(w)) s -= 1;
  const sentiment: "positive" | "negative" | "neutral" = s > 0 ? "positive" : s < 0 ? "negative" : "neutral";
  let category = "general";
  for (const [k, words] of Object.entries(CATS)) if (words.some((w) => t.includes(w))) { category = k; break; }
  return { sentiment, category };
}

export function linkNewsToPatterns(patterns: DetectedPattern[], news: NewsLite[], windowDays = 1): NewsLink[] {
  const win = windowDays * 86400_000;
  return patterns.map((p) => {
    const matched = news
      .filter((n) => Math.abs(n.datetime * 1000 - p.t) <= win)
      .map((n) => {
        const cls = classifyNews(`${n.headline} ${n.summary ?? ""}`);
        return { headline: n.headline, datetime: n.datetime, ...cls };
      });
    return { pattern: p, matched };
  });
}

export interface NewsCorrelation { patternLabel: string; category: string; total: number; bullishMatches: number; bearishMatches: number; netBias: number; }

export function correlateNewsPatterns(links: NewsLink[]): NewsCorrelation[] {
  const map = new Map<string, NewsCorrelation>();
  for (const l of links) {
    for (const m of l.matched) {
      const key = `${l.pattern.label}|${m.category}`;
      const c = map.get(key) ?? { patternLabel: l.pattern.label, category: m.category, total: 0, bullishMatches: 0, bearishMatches: 0, netBias: 0 };
      c.total += 1;
      if (m.sentiment === "positive") c.bullishMatches += 1;
      if (m.sentiment === "negative") c.bearishMatches += 1;
      map.set(key, c);
    }
  }
  return [...map.values()].map((c) => ({ ...c, netBias: c.total ? (c.bullishMatches - c.bearishMatches) / c.total : 0 }))
    .sort((a, b) => b.total - a.total);
}

export function patternScore(patterns: DetectedPattern[], reliability: PatternReliability[]): { score: number; bias: "bullish" | "bearish" | "neutral"; reasoning: string } {
  const relMap = new Map(reliability.map((r) => [r.label, r]));
  const recent = patterns.slice(-12);
  let bull = 0, bear = 0;
  for (const p of recent) {
    const rel = relMap.get(p.label)?.hitRate ?? 0.5;
    const score = p.strength * rel;
    if (p.bullish) bull += score; else bear += score;
  }
  const total = bull + bear;
  const norm = total > 0 ? (bull - bear) / total : 0;
  const score = Math.round(50 + norm * 50);
  return {
    score,
    bias: norm > 0.1 ? "bullish" : norm < -0.1 ? "bearish" : "neutral",
    reasoning: `Composite of ${recent.length} recent pattern(s) weighted by per-ticker reliability.`,
  };
}

export interface BacktestStats {
  trades: number; wins: number; winRate: number; totalReturn: number; cagr: number; sharpe: number; maxDrawdown: number; profitFactor: number;
  equity: { t: number; v: number }[];
  trades_: { t: number; side: "buy" | "sell"; price: number; pnl?: number }[];
}

export function backtestStrategy(c: Candle[], p: TuneParams, holdBars = 5): BacktestStats {
  const closes = c.map((x) => x.c);
  let equity = 1;
  const equityCurve: { t: number; v: number }[] = [];
  const trades: { t: number; side: "buy" | "sell"; price: number; pnl?: number }[] = [];
  let wins = 0, losses = 0, grossWin = 0, grossLoss = 0;
  let position: { entryIdx: number; entryPrice: number; side: 1 | -1 } | null = null;
  const startTs = c[0]?.t ?? Date.now();

  for (let i = Math.max(p.smaSlow, p.rsiPeriod) + 1; i < c.length; i++) {
    if (position) {
      const held = i - position.entryIdx;
      if (held >= holdBars) {
        const exit = closes[i];
        const ret = ((exit - position.entryPrice) / position.entryPrice) * position.side;
        equity *= 1 + ret;
        const pnl = ret;
        trades.push({ t: c[i].t, side: position.side === 1 ? "sell" : "buy", price: exit, pnl });
        if (pnl > 0) { wins += 1; grossWin += pnl; } else { losses += 1; grossLoss += -pnl; }
        position = null;
      }
    }
    if (!position) {
      const window = closes.slice(0, i + 1);
      const fast = sma(window, p.smaFast);
      const slow = sma(window, p.smaSlow);
      const r = rsi(window, p.rsiPeriod);
      let signal: 0 | 1 | -1 = 0;
      if (fast > slow && r < p.rsiOverbought) signal = 1;
      else if (fast < slow && r > p.rsiOversold) signal = -1;
      if (signal !== 0) {
        position = { entryIdx: i, entryPrice: closes[i], side: signal };
        trades.push({ t: c[i].t, side: signal === 1 ? "buy" : "sell", price: closes[i] });
      }
    }
    equityCurve.push({ t: c[i].t, v: equity });
  }

  const dailyRets: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) dailyRets.push((equityCurve[i].v - equityCurve[i - 1].v) / Math.max(1e-9, equityCurve[i - 1].v));
  const meanR = dailyRets.reduce((a, b) => a + b, 0) / Math.max(1, dailyRets.length);
  const sdR = stdev(dailyRets);
  const sharpe = sdR > 0 ? (meanR / sdR) * Math.sqrt(252) : 0;
  let peak = 1, maxDD = 0;
  for (const e of equityCurve) { peak = Math.max(peak, e.v); maxDD = Math.max(maxDD, (peak - e.v) / peak); }
  const years = Math.max(1 / 252, (c[c.length - 1]?.t - startTs) / (365 * 86400_000));
  const cagr = equity > 0 ? Math.pow(equity, 1 / years) - 1 : -1;

  return {
    trades: trades.filter((t) => t.pnl != null).length,
    wins, winRate: wins / Math.max(1, wins + losses),
    totalReturn: equity - 1, cagr, sharpe, maxDrawdown: maxDD,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    equity: equityCurve, trades_: trades,
  };
}
