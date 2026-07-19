// Pure Geometric Brownian Motion Monte Carlo — SSR-safe, no deps.
export interface MCParams {
  spot: number;
  mu: number;       // per-bar drift (log-return mean)
  sigma: number;    // per-bar volatility (log-return stdev)
  horizon: number;  // number of bars forward
  paths: number;    // simulation count
  seed?: number;
}

export interface MCResult {
  horizon: number;
  paths: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
  probAbove: number; // P(final > spot)
  fan: { bar: number; p10: number; p50: number; p90: number }[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxMuller(rand: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantile(sorted: number[], q: number) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

export function runMonteCarlo(p: MCParams): MCResult {
  const rand = mulberry32(p.seed ?? 0xC0FFEE);
  const N = Math.max(50, Math.min(20000, p.paths));
  const H = Math.max(1, Math.min(500, p.horizon));
  const finals: number[] = new Array(N);
  const perBar: number[][] = Array.from({ length: H }, () => new Array(N));
  const drift = p.mu - 0.5 * p.sigma * p.sigma;

  for (let i = 0; i < N; i++) {
    let s = p.spot;
    for (let t = 0; t < H; t++) {
      const z = boxMuller(rand);
      s = s * Math.exp(drift + p.sigma * z);
      perBar[t][i] = s;
    }
    finals[i] = s;
  }

  const sortedFinal = [...finals].sort((a, b) => a - b);
  const fan = perBar.map((arr, i) => {
    const s = [...arr].sort((a, b) => a - b);
    return { bar: i + 1, p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) };
  });
  const mean = finals.reduce((a, b) => a + b, 0) / N;
  const probAbove = finals.filter((x) => x > p.spot).length / N;

  return {
    horizon: H,
    paths: N,
    p10: quantile(sortedFinal, 0.1),
    p25: quantile(sortedFinal, 0.25),
    p50: quantile(sortedFinal, 0.5),
    p75: quantile(sortedFinal, 0.75),
    p90: quantile(sortedFinal, 0.9),
    mean,
    probAbove,
    fan,
  };
}
