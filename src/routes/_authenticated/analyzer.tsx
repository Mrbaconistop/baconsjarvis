import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceLine, Legend } from "recharts";
import { format } from "date-fns";
import {
  Activity,
  ArrowLeft,
  Cpu,
  FileDown,
  Gauge,
  Layers,
  Loader2,
  Newspaper,
  Sparkles,
  Target,
  TrendingUp,
  Wand2,
  Plus,
  Trash2,
  Bell,
  BellOff,
  BookOpen,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { z } from "zod";

import { PageHeader } from "@/components/jarvis/HudBits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { getStockSnapshot, searchSymbols } from "@/lib/market.functions";
import {
  toOHLC,
  detectAllPatterns,
  reliabilityByPattern,
  autotune,
  runPredictor,
  linkNewsToPatterns,
  patternScore,
  backtestStrategy,
  DEFAULT_PARAMS,
  type TuneParams,
  type PredictorMode,
  type DetectedPattern,
} from "@/lib/patterns";
import { confluenceScore } from "@/lib/confluence";
import { calibratePrediction } from "@/lib/calibration";
import { sentimentScore } from "@/lib/analytics";
import {
  getAnalyzerConfig,
  setAnalyzerConfig,
  addStockAlert,
  listStockAlerts,
  removeStockAlert,
  addToWatchlist,
  removeFromWatchlist,
  getWatchlist,
  portfolioRisk,
  sectorPerformance,
  stockNewsSentiment,
} from "@/lib/jarvis.functions";
import { toast } from "sonner";
import { AnalyzerSettingsButton, loadPrefsLocal } from "@/components/jarvis/AnalyzerSettings";
import { OverlayLineEditor, loadOverlays, type OverlayLine } from "@/components/jarvis/ChartOverlayLines";
import { runMonteCarlo, type MCResult } from "@/lib/monte-carlo";
import { scoreNewsSentiment, type NewsSentimentResult } from "@/lib/news-sentiment.functions";
import { type AnalyzerPrefs } from "@/lib/analyzer-prefs.functions";
import { Badge } from "@/components/ui/badge";
import { Swords, Dice5 } from "lucide-react";
import { JarvisAnalyzerDock } from "@/components/jarvis/JarvisAnalyzerDock";

const SearchSchema = z.object({
  symbol: z.string().optional(),
  smaFast: z.coerce.number().optional(),
  smaSlow: z.coerce.number().optional(),
  rsiPeriod: z.coerce.number().optional(),
  rsiOversold: z.coerce.number().optional(),
  rsiOverbought: z.coerce.number().optional(),
  bbWidth: z.coerce.number().optional(),
  mode: z.enum(["candlestick", "indicator", "pattern", "ml"]).optional(),
  hold: z.coerce.number().optional(),
  cal: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/_authenticated/analyzer")({
  head: () => ({
    meta: [
      { title: "Analyzer — JARVIS" },
      { name: "description", content: "Pattern detection, autotune, and calibrated predictions." },
    ],
  }),
  validateSearch: (s) => SearchSchema.parse(s),
  component: AnalyzerPage,
});

type Snap = Awaited<ReturnType<typeof getStockSnapshot>>;
type SnapOk = Extract<Snap, { ok: true }>;

const fmtPct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const fmtMoney = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function AnalyzerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const snapFn = useServerFn(getStockSnapshot);
  const searchFn = useServerFn(searchSymbols);
  const getConfig = useServerFn(getAnalyzerConfig);
  const setConfig = useServerFn(setAnalyzerConfig);
  const addAlert = useServerFn(addStockAlert);
  const listAlerts = useServerFn(listStockAlerts);
  const removeAlert = useServerFn(removeStockAlert);
  const addWL = useServerFn(addToWatchlist);
  const removeWL = useServerFn(removeFromWatchlist);
  const getWL = useServerFn(getWatchlist);
  const getRisk = useServerFn(portfolioRisk);
  const getSector = useServerFn(sectorPerformance);
  const getNews = useServerFn(stockNewsSentiment);

  const [symbol, setSymbol] = useState((search.symbol ?? "NVDA").toUpperCase());
  const [pending, setPending] = useState(symbol);
  const [snap, setSnap] = useState<SnapOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ symbol: string; name: string }[]>([]);

  // User config
  const { data: configData } = useQuery({
    queryKey: ["analyzer-config"],
    queryFn: () => getConfig(),
  });
  const sensitivity = configData?.sensitivity || "balanced";
  const lookback = configData?.lookback || 365;

  // Watchlist & Alerts
  const { data: watchlist = [], refetch: refetchWL } = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => getWL(),
  });
  const { data: alerts = [], refetch: refetchAlerts } = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: () => listAlerts(),
  });

  const params: TuneParams = useMemo(
    () => ({
      smaFast: search.smaFast ?? DEFAULT_PARAMS.smaFast,
      smaSlow: search.smaSlow ?? DEFAULT_PARAMS.smaSlow,
      rsiPeriod: search.rsiPeriod ?? DEFAULT_PARAMS.rsiPeriod,
      rsiOversold: search.rsiOversold ?? DEFAULT_PARAMS.rsiOversold,
      rsiOverbought: search.rsiOverbought ?? DEFAULT_PARAMS.rsiOverbought,
      bbWidth: search.bbWidth ?? DEFAULT_PARAMS.bbWidth,
    }),
    [search],
  );

  const mode: PredictorMode = search.mode ?? "indicator";
  const holdBars = search.hold ?? 5;
  const calibrationOn = search.cal ?? true;

  const updateParams = (patch: Partial<TuneParams>) => {
    navigate({ search: (prev: any) => ({ ...prev, ...patch }), replace: true });
  };

  const [tuneProgress, setTuneProgress] = useState<{ done: number; total: number } | null>(null);
  const [tuneSummary, setTuneSummary] = useState<{
    score: number;
    defaultScore: number;
    improvement: number;
    trades: number;
  } | null>(null);

  const load = async (s: string) => {
    setLoading(true);
    setError(null);
    const r = await snapFn({ data: { symbol: s } });
    if (r.ok) {
      setSnap(r);
      setSymbol(r.symbol);
      navigate({ search: (p: any) => ({ ...p, symbol: r.symbol }), replace: true });
    } else setError(r.error);
    setLoading(false);
  };

  useEffect(() => {
    load(symbol); /* eslint-disable-next-line */
  }, []);

  useEffect(() => {
    if (!pending || pending === symbol) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      const r = await searchFn({ data: { q: pending } });
      if (r.ok) setResults(r.results);
    }, 250);
    return () => clearTimeout(id);
  }, [pending, symbol, searchFn]);

  const candles = useMemo(() => (snap ? toOHLC(snap.series.slice(-lookback)) : []), [snap, lookback]);
  const allPatterns = useMemo(() => detectAllPatterns(candles), [candles]);
  const reliability = useMemo(() => reliabilityByPattern(candles, allPatterns, 5), [candles, allPatterns]);
  const score = useMemo(() => patternScore(allPatterns, reliability), [allPatterns, reliability]);
  const newsLinks = useMemo(
    () => (snap ? linkNewsToPatterns(allPatterns.slice(-40), snap.news, 1) : []),
    [snap, allPatterns],
  );
  const prediction = useMemo(
    () => (snap && candles.length ? runPredictor(mode, candles, snap.news, params) : null),
    [snap, candles, mode, params],
  );
  const confluence = useMemo(() => (candles.length ? confluenceScore(candles) : null), [candles]);
  const calibrated = useMemo(() => {
    if (!snap || !prediction || !confluence) return null;
    return calibratePrediction({
      raw: prediction,
      patterns: allPatterns,
      reliability,
      confluence,
      news: snap.news,
      enabled: calibrationOn,
    });
  }, [snap, prediction, confluence, allPatterns, reliability, calibrationOn]);
  const backtestTuned = useMemo(
    () => (candles.length ? backtestStrategy(candles, params, holdBars) : null),
    [candles, params, holdBars],
  );
  const backtestDefault = useMemo(
    () => (candles.length ? backtestStrategy(candles, DEFAULT_PARAMS, holdBars) : null),
    [candles, holdBars],
  );

  const chartData = useMemo(() => {
    if (!candles.length) return [];
    return candles.slice(-180).map((c) => ({ t: c.t, c: c.c, h: c.h, l: c.l }));
  }, [candles]);

  const overlayDots = useMemo(() => {
    if (!candles.length) return [] as { t: number; price: number; pattern: DetectedPattern }[];
    const minT = candles.slice(-180)[0]?.t ?? 0;
    return allPatterns
      .filter((p) => p.t >= minT)
      .slice(-25)
      .map((p) => ({ t: p.t, price: candles[p.index]?.c ?? 0, pattern: p }));
  }, [allPatterns, candles]);

  const equityChart = useMemo(() => {
    if (!backtestTuned || !backtestDefault) return [];
    const byT = new Map<number, { t: number; tuned?: number; def?: number }>();
    for (const e of backtestTuned.equity) byT.set(e.t, { t: e.t, tuned: e.v });
    for (const e of backtestDefault.equity) {
      const row = byT.get(e.t) ?? { t: e.t };
      row.def = e.v;
      byT.set(e.t, row);
    }
    return [...byT.values()].sort((a, b) => a.t - b.t);
  }, [backtestTuned, backtestDefault]);

  const recommendation = useMemo(() => {
    if (!snap || !prediction || !candles.length) return null;
    const sent = sentimentScore(snap.news);
    const dir = prediction.direction === "up" ? 1 : prediction.direction === "down" ? -1 : 0;
    const conv = (prediction.probability - 0.5) * 2;
    const scoreBias = score.bias === "bullish" ? 1 : score.bias === "bearish" ? -1 : 0;
    const tunedEdge = backtestTuned ? backtestTuned.totalReturn : 0;
    let comp =
      dir * conv * 0.45 +
      scoreBias * (score.score / 100) * 0.25 +
      sent.score * 0.2 +
      Math.max(-0.3, Math.min(0.3, tunedEdge)) * 0.1;
    comp = Math.max(-1, Math.min(1, comp));
    let action: "BUY" | "SELL" | "HOLD" = "HOLD";
    if (comp > 0.18) action = "BUY";
    else if (comp < -0.18) action = "SELL";
    return { action, composite: comp };
  }, [snap, prediction, candles, score, backtestTuned]);

  const runTune = async () => {
    if (!candles.length) return;
    setTuneProgress({ done: 0, total: 1 });
    await new Promise((r) => setTimeout(r, 20));
    const res = autotune(candles, (done, total) => {
      if (done % 50 === 0 || done === total) setTuneProgress({ done, total });
    });
    updateParams(res.best);
    setTuneSummary({
      score: res.score,
      defaultScore: res.defaultScore,
      improvement: res.improvement,
      trades: res.trades,
    });
    setTuneProgress(null);
  };

  const exportCSV = () => {
    if (!snap) return;
    const rows: string[] = ["type,label,timestamp,bullish,strength,target,description"];
    for (const p of allPatterns) {
      rows.push(
        [
          p.kind,
          p.label,
          new Date(p.t).toISOString(),
          p.bullish,
          p.strength.toFixed(2),
          p.target?.toFixed(2) ?? "",
          `"${p.description}"`,
        ].join(","),
      );
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${snap.symbol}-patterns.csv`;
    a.click();
  };

  // ---- New state for compare, risk, sector, news ----
  const [compareSymbols, setCompareSymbols] = useState("");
  const [comparisonData, setComparisonData] = useState<any[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [riskData, setRiskData] = useState<any>(null);
  const [sectorData, setSectorData] = useState<any[]>([]);
  const [newsData, setNewsData] = useState<any>(null);
  const [alertTicker, setAlertTicker] = useState("");
  const [alertType, setAlertType] = useState<
    "price_above" | "price_below" | "sma_cross_above" | "sma_cross_below" | "rsi_above" | "rsi_below" | "volume_spike"
  >("price_above");
  const [alertValue, setAlertValue] = useState("");

  // ---- PatternFlow Pro: prefs, overlays, monte-carlo, sentiment ----
  const [prefs, setPrefs] = useState<AnalyzerPrefs>(() => loadPrefsLocal());
  const [overlayLines, setOverlayLines] = useState<OverlayLine[]>([]);
  const [mc, setMc] = useState<MCResult | null>(null);
  const [mcHorizon, setMcHorizon] = useState(20);
  const [mcRunning, setMcRunning] = useState(false);
  const [newsSent, setNewsSent] = useState<NewsSentimentResult | null>(null);
  const [newsFilter, setNewsFilter] = useState<"all" | "pos" | "neg" | "neu">("all");
  const scoreNewsFn = useServerFn(scoreNewsSentiment);

  const WAR_SECTORS = ["defense", "aerospace", "energy", "oil", "gas", "mining", "metals", "commodit"];
  const industryText = (snap?.profile.industry ?? "").toLowerCase();
  const warFlagged = prefs.warMode && WAR_SECTORS.some((s) => industryText.includes(s));

  useEffect(() => {
    if (!snap) return;
    setOverlayLines(loadOverlays(snap.symbol));
    setMc(null);
    setNewsSent(null);
    if (prefs.sentimentEnabled) {
      scoreNewsFn({ data: { symbol: snap.symbol } })
        .then((r) => setNewsSent(r))
        .catch(() => { /* silent */ });
    }
  }, [snap?.symbol, prefs.sentimentEnabled, scoreNewsFn]);

  const runMC = () => {
    if (!candles.length || !snap) return;
    setMcRunning(true);
    // Estimate per-bar drift + vol from last N daily log-returns
    const N = Math.min(180, candles.length - 1);
    const logs: number[] = [];
    for (let i = candles.length - N; i < candles.length; i++) {
      const prev = candles[i - 1]?.c;
      const cur = candles[i]?.c;
      if (prev && cur) logs.push(Math.log(cur / prev));
    }
    const mu = logs.reduce((a, b) => a + b, 0) / (logs.length || 1);
    const m = mu;
    const varr = logs.reduce((a, b) => a + (b - m) ** 2, 0) / (logs.length || 1);
    let sigma = Math.sqrt(varr);
    if (prefs.warMode) sigma *= 1.25; // wider distributions in war mode
    const res = runMonteCarlo({
      spot: candles[candles.length - 1].c,
      mu,
      sigma,
      horizon: mcHorizon,
      paths: 2500,
      seed: Math.floor(Date.now() / 1000),
    });
    setMc(res);
    setMcRunning(false);
  };

  // Reward score (past predictions): negative MSE of predictor vs realised over lookback.
  const rewardScore = useMemo(() => {
    if (!candles.length || candles.length < 40) return null;
    const H = 5;
    let n = 0, sqErr = 0, hits = 0;
    for (let i = 30; i < candles.length - H; i += 5) {
      const window = candles.slice(0, i);
      try {
        const p = runPredictor(mode, window, snap?.news ?? [], params);
        if (!p.targetPrice) continue;
        const actual = candles[i + H].c;
        const predRet = (p.targetPrice - window[window.length - 1].c) / window[window.length - 1].c;
        const actualRet = (actual - window[window.length - 1].c) / window[window.length - 1].c;
        sqErr += (predRet - actualRet) ** 2;
        n += 1;
        if (Math.sign(predRet) === Math.sign(actualRet)) hits += 1;
      } catch { /* skip */ }
    }
    if (!n) return null;
    const mse = sqErr / n;
    return {
      reward: -mse,
      mse,
      rmse: Math.sqrt(mse),
      hitRate: hits / n,
      samples: n,
    };
  }, [candles, mode, params, snap?.news]);

  // Reliability score for the current setup
  const reliabilityPct = useMemo(() => {
    const winrate = backtestTuned?.winRate ?? 0.5;
    const patStrength = Math.min(1, score.score / 100);
    const sentAlign = newsSent
      ? Math.max(0, (prediction?.direction === "up" ? 1 : -1) * newsSent.aggregate)
      : 0;
    return Math.round(Math.max(0, Math.min(1, winrate * 0.5 + patStrength * 0.35 + sentAlign * 0.15)) * 100);
  }, [backtestTuned, score, newsSent, prediction]);


  // ---- Handlers ----
  async function handleAddAlert() {
    if (!alertTicker || !alertValue) return toast.error("Ticker and value required");
    try {
      await addAlert({ data: { ticker: alertTicker, type: alertType, value: parseFloat(alertValue) } });
      toast.success("Alert added");
      refetchAlerts();
      setAlertTicker("");
      setAlertValue("");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleRemoveAlert(id: string) {
    try {
      await removeAlert({ data: { id } });
      refetchAlerts();
      toast.success("Alert removed");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleAddWL(sym: string) {
    try {
      await addWL({ data: { symbol: sym } });
      refetchWL();
      toast.success(`${sym} added to watchlist`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleRemoveWL(sym: string) {
    try {
      await removeWL({ data: { symbol: sym } });
      refetchWL();
      toast.success(`${sym} removed`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleCompare() {
    const syms = compareSymbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (syms.length < 2) return toast.error("Enter at least 2 symbols, comma-separated");
    try {
      const res = await Promise.all(
        syms.map(async (s) => {
          const r = await snapFn({ data: { symbol: s } });
          return r.ok ? { symbol: s, price: r.quote.c, change: r.quote.dp } : null;
        }),
      );
      setComparisonData(res.filter(Boolean));
      setShowCompare(true);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function fetchRisk() {
    try {
      const r = await getRisk();
      setRiskData(r);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function fetchSector() {
    try {
      const r = await getSector();
      setSectorData(r);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function fetchNews(sym: string) {
    try {
      const r = await getNews({ data: { symbol: sym } });
      setNewsData(r);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="min-h-full">
      <PageHeader
        tag="13"
        title="Pattern Analyzer"
        subtitle="Autotune, calibrated predictions, and multi-timeframe confluence. JARVIS can adjust parameters via chat."
        right={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Input
                value={pending}
                onChange={(e) => setPending(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    load(pending);
                    setResults([]);
                  }
                }}
                placeholder="Ticker…"
                className="font-mono w-32 sm:w-40 h-9 bg-background/60 border-arc/30"
              />
              {results.length > 0 && (
                <div className="absolute z-20 mt-1 w-64 rounded-md border border-arc/20 bg-background/95 backdrop-blur shadow-lg">
                  {results.map((r) => (
                    <button
                      key={r.symbol}
                      onClick={() => {
                        setPending(r.symbol);
                        load(r.symbol);
                        setResults([]);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-arc/10 text-sm"
                    >
                      <span className="font-mono text-arc">{r.symbol}</span>
                      <span className="text-xs text-muted-foreground truncate">{r.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button onClick={() => load(pending)} disabled={loading} size="sm" className="h-9">
              {loading ? <Loader2 className="animate-spin" size={14} /> : "Load"}
            </Button>
          </div>
        }
      />

      <div className="p-4 sm:p-8 space-y-4">
        {error && (
          <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </div>
        )}

        {snap && (
          <>
            {/* Top row: Score + Autotune */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Pattern Score" icon={<Target size={14} />}>
                <div className="flex items-baseline gap-3">
                  <div className="font-display text-4xl text-glow">{score.score}</div>
                  <div className="font-mono text-xs text-muted-foreground">/ 100</div>
                  <div
                    className={cn(
                      "ml-auto px-2 py-0.5 rounded text-[10px] uppercase font-mono tracking-widest border",
                      score.bias === "bullish"
                        ? "text-bullish border-bullish/40 bg-bullish/10"
                        : score.bias === "bearish"
                          ? "text-bearish border-bearish/40 bg-bearish/10"
                          : "text-arc border-arc/30 bg-arc/10",
                    )}
                  >
                    {score.bias}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{score.reasoning}</p>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <Stat label="Patterns" value={String(allPatterns.length)} />
                  <Stat label="News" value={String(snap.news.length)} />
                  <Stat label="Matched" value={String(newsLinks.filter((l) => l.matched.length).length)} />
                </div>
              </Panel>

              <Panel
                title="Autotune"
                icon={<Wand2 size={14} />}
                actions={
                  <Button size="sm" variant="outline" onClick={runTune} disabled={!!tuneProgress} className="h-7">
                    {tuneProgress ? (
                      <>
                        <Loader2 className="animate-spin mr-1.5" size={12} /> {tuneProgress.done}/{tuneProgress.total}
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-1.5" size={12} /> Grid search
                      </>
                    )}
                  </Button>
                }
              >
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                  <ParamSlider
                    label={`SMA fast · ${params.smaFast}`}
                    value={params.smaFast}
                    min={5}
                    max={50}
                    step={1}
                    onChange={(v) => updateParams({ smaFast: v })}
                  />
                  <ParamSlider
                    label={`SMA slow · ${params.smaSlow}`}
                    value={params.smaSlow}
                    min={20}
                    max={200}
                    step={5}
                    onChange={(v) => updateParams({ smaSlow: v })}
                  />
                  <ParamSlider
                    label={`RSI period · ${params.rsiPeriod}`}
                    value={params.rsiPeriod}
                    min={5}
                    max={30}
                    step={1}
                    onChange={(v) => updateParams({ rsiPeriod: v })}
                  />
                  <ParamSlider
                    label={`RSI oversold · ${params.rsiOversold}`}
                    value={params.rsiOversold}
                    min={10}
                    max={45}
                    step={1}
                    onChange={(v) => updateParams({ rsiOversold: v })}
                  />
                  <ParamSlider
                    label={`RSI overbought · ${params.rsiOverbought}`}
                    value={params.rsiOverbought}
                    min={55}
                    max={90}
                    step={1}
                    onChange={(v) => updateParams({ rsiOverbought: v })}
                  />
                  <ParamSlider
                    label={`BB width · ${params.bbWidth.toFixed(1)}σ`}
                    value={params.bbWidth * 10}
                    min={10}
                    max={40}
                    step={1}
                    onChange={(v) => updateParams({ bbWidth: v / 10 })}
                  />
                </div>
                {tuneSummary && (
                  <div className="grid grid-cols-4 gap-2 mt-3">
                    <Stat label="Best score" value={fmtPct(tuneSummary.score, 0)} />
                    <Stat label="Default" value={fmtPct(tuneSummary.defaultScore, 0)} />
                    <Stat
                      label="Δ vs default"
                      value={(tuneSummary.improvement >= 0 ? "+" : "") + fmtPct(tuneSummary.improvement)}
                      tone={tuneSummary.improvement >= 0 ? "bull" : "bear"}
                    />
                    <Stat label="Trades" value={String(tuneSummary.trades)} />
                  </div>
                )}
              </Panel>
            </div>

            {/* ---- NEW: Analyzer Controls (Sensitivity, Lookback) ---- */}
            <Panel title="Analyzer Controls" icon={<Cpu size={14} />}>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <label className="font-mono text-[10px] text-hud-dim">Sensitivity</label>
                  <select
                    value={sensitivity}
                    onChange={async (e) => {
                      const val = e.target.value as any;
                      await setConfig({ data: { sensitivity: val } });
                      toast.success(`Sensitivity set to ${val}`);
                    }}
                    className="w-full bg-background/40 border border-arc/20 rounded-md px-2 py-1 mt-1"
                  >
                    <option value="conservative">Conservative</option>
                    <option value="balanced">Balanced</option>
                    <option value="aggressive">Aggressive</option>
                  </select>
                </div>
                <div>
                  <label className="font-mono text-[10px] text-hud-dim">Lookback (days)</label>
                  <Slider
                    value={[lookback]}
                    min={60}
                    max={730}
                    step={30}
                    onValueChange={async ([v]) => {
                      await setConfig({ data: { lookback: v } });
                      navigate({ search: (p: any) => ({ ...p, lookback: v }), replace: true });
                    }}
                  />
                  <div className="text-xs text-hud-dim mt-1">{lookback} days</div>
                </div>
              </div>
            </Panel>

            {/* ---- PatternFlow Pro ---- */}
            <Panel
              title="PatternFlow Pro"
              icon={<Sparkles size={14} />}
              actions={
                <div className="flex items-center gap-2">
                  {prefs.warMode && (
                    <Badge variant="destructive" className="gap-1 text-[10px]">
                      <Swords size={10} /> WAR MODE
                    </Badge>
                  )}
                  {warFlagged && (
                    <Badge className="text-[10px] bg-critical/20 text-critical border border-critical/40">
                      War-linked sector
                    </Badge>
                  )}
                  <AnalyzerSettingsButton prefs={prefs} onChange={setPrefs} />
                </div>
              }
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Reliability" value={`${reliabilityPct}%`} tone={reliabilityPct >= 60 ? "bull" : reliabilityPct <= 40 ? "bear" : undefined} />
                    <Stat
                      label="Reward score"
                      value={rewardScore ? rewardScore.reward.toExponential(2) : "—"}
                      tone={rewardScore && rewardScore.reward > -0.005 ? "bull" : "bear"}
                    />
                    <Stat
                      label="Hit rate (past)"
                      value={rewardScore ? `${(rewardScore.hitRate * 100).toFixed(0)}%` : "—"}
                    />
                    <Stat
                      label="Sentiment"
                      value={newsSent ? (newsSent.aggregate >= 0 ? "+" : "") + (newsSent.aggregate * 100).toFixed(0) : "—"}
                      tone={newsSent && newsSent.aggregate > 0.1 ? "bull" : newsSent && newsSent.aggregate < -0.1 ? "bear" : undefined}
                    />
                  </div>
                  {newsSent && newsSent.events.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {newsSent.events.map((e) => (
                        <Badge key={e.type} variant="outline" className="text-[10px]">
                          {e.type} · {e.count} · {(e.avgImpact * 100).toFixed(0)}%
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Reward = −MSE of past predicted vs realised returns ({rewardScore?.samples ?? 0} samples).
                    Reliability blends backtest win rate, pattern strength, sentiment alignment.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-[10px] tracking-widest text-arc/70 uppercase">Monte Carlo · GBM</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">Horizon {mcHorizon}d</span>
                      <Slider
                        value={[mcHorizon]}
                        min={5}
                        max={120}
                        step={5}
                        onValueChange={([v]) => setMcHorizon(v)}
                        className="w-24"
                      />
                      <Button size="sm" onClick={runMC} disabled={mcRunning} className="h-7 text-xs">
                        {mcRunning ? <Loader2 size={12} className="animate-spin mr-1" /> : <Dice5 size={12} className="mr-1" />}
                        Simulate
                      </Button>
                    </div>
                  </div>
                  {mc ? (
                    <div className="grid grid-cols-3 gap-2">
                      <Stat label="P10" value={fmtMoney(mc.p10)} tone="bear" />
                      <Stat label="Median" value={fmtMoney(mc.p50)} />
                      <Stat label="P90" value={fmtMoney(mc.p90)} tone="bull" />
                      <Stat label="Mean" value={fmtMoney(mc.mean)} />
                      <Stat label="P(above)" value={`${(mc.probAbove * 100).toFixed(0)}%`} tone={mc.probAbove >= 0.5 ? "bull" : "bear"} />
                      <Stat label="Paths" value={mc.paths.toLocaleString()} />
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">Run the simulator to generate a probability distribution for the selected horizon.</p>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-arc/10">
                <OverlayLineEditor
                  symbol={snap.symbol}
                  currentPrice={snap.quote.c || snap.quote.pc || 0}
                  priceMin={Math.min(...chartData.map((d) => d.l ?? d.c))}
                  priceMax={Math.max(...chartData.map((d) => d.h ?? d.c))}
                  onChange={setOverlayLines}
                />
              </div>
            </Panel>

            {/* Chart */}
            <Panel title={`Price · ${snap.symbol}`} icon={<Activity size={14} />}>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer>
                  <ComposedChart data={chartData}>
                    <XAxis
                      dataKey="t"
                      tickFormatter={(t) => format(t, "MMM d")}
                      stroke="var(--muted-foreground)"
                      fontSize={10}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                      stroke="var(--muted-foreground)"
                      fontSize={10}
                    />
                    <Tooltip
                      labelFormatter={(t) => format(Number(t), "MMM d, yyyy")}
                      formatter={(val: any, name: string) => {
                        const map: Record<string, string> = { c: "Close", h: "High", l: "Low" };
                        return [fmtMoney(Number(val)), map[name] ?? name];
                      }}
                      contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                    />
                    <Area type="monotone" dataKey="h" stroke="none" fill="hsl(var(--arc) / 0.05)" />
                    <Area type="monotone" dataKey="l" stroke="none" fill="hsl(var(--background))" />
                    <Line type="monotone" dataKey="c" stroke="hsl(var(--arc))" dot={false} strokeWidth={1.5} />
                    {overlayLines.map((ol) => (
                      <ReferenceLine
                        key={ol.id}
                        y={ol.price}
                        stroke={ol.color ?? "hsl(var(--arc))"}
                        strokeDasharray="4 3"
                        label={{ value: `${ol.label ?? ""} $${ol.price.toFixed(2)}`, position: "right", fontSize: 10, fill: "hsl(var(--arc))" }}
                      />
                    ))}
                    {mc && (
                      <>
                        <ReferenceLine y={mc.p50} stroke="hsl(var(--arc))" strokeDasharray="2 2" label={{ value: `MC med $${mc.p50.toFixed(2)}`, position: "left", fontSize: 9, fill: "hsl(var(--arc))" }} />
                        <ReferenceLine y={mc.p10} stroke="hsl(var(--bearish))" strokeDasharray="1 3" />
                        <ReferenceLine y={mc.p90} stroke="hsl(var(--bullish))" strokeDasharray="1 3" />
                      </>
                    )}
                    {overlayDots.map((d, i) => (
                      <ReferenceDot
                        key={i}
                        x={d.t}
                        y={d.price}
                        r={4}
                        fill={d.pattern.bullish ? "hsl(var(--bullish))" : "hsl(var(--bearish))"}
                        stroke="hsl(var(--background))"
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>


            {/* ---- NEW: Compare Stocks ---- */}
            <Panel title="Compare Stocks" icon={<TrendingUp size={14} />}>
              <div className="flex gap-2">
                <Input
                  value={compareSymbols}
                  onChange={(e) => setCompareSymbols(e.target.value)}
                  placeholder="AAPL, MSFT, GOOGL"
                  className="flex-1"
                />
                <Button onClick={handleCompare} size="sm">
                  Compare
                </Button>
              </div>
              {showCompare && comparisonData.length > 0 && (
                <div className="mt-3 space-y-1">
                  {comparisonData.map((c) => (
                    <div
                      key={c.symbol}
                      className="flex items-center justify-between text-sm border-b border-arc/10 py-1"
                    >
                      <span className="font-mono">{c.symbol}</span>
                      <span>${c.price?.toFixed(2)}</span>
                      <span className={c.change >= 0 ? "text-bullish" : "text-bearish"}>
                        {(c.change || 0).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* Predictor + Calibration */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                title="Predictor"
                icon={<Cpu size={14} />}
                actions={
                  <div className="flex gap-1">
                    {(["candlestick", "indicator", "pattern", "ml"] as const).map((m) => (
                      <Button
                        key={m}
                        size="sm"
                        variant={mode === m ? "default" : "ghost"}
                        onClick={() => navigate({ search: (p: any) => ({ ...p, mode: m }), replace: true })}
                        className="h-7 text-xs capitalize"
                      >
                        {m}
                      </Button>
                    ))}
                  </div>
                }
              >
                {prediction && (
                  <div className="space-y-3">
                    <div className="flex items-baseline gap-3">
                      <div
                        className={cn(
                          "font-display text-3xl",
                          prediction.direction === "up"
                            ? "text-bullish"
                            : prediction.direction === "down"
                              ? "text-bearish"
                              : "text-arc",
                        )}
                      >
                        {prediction.direction === "up" ? "↑" : prediction.direction === "down" ? "↓" : "→"}{" "}
                        {(prediction.probability * 100).toFixed(0)}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        confidence · {prediction.horizonBars}-bar horizon
                      </div>
                    </div>
                    {prediction.targetPrice && (
                      <div className="text-sm">
                        Target: <span className="font-mono text-arc">{fmtMoney(prediction.targetPrice)}</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">{prediction.explanation}</p>
                    <div className="space-y-1 text-xs">
                      {prediction.contributors.slice(0, 6).map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-40 truncate text-muted-foreground">{c.label}</span>
                          <div className="flex-1 h-1.5 bg-arc/10 rounded relative overflow-hidden">
                            <div
                              className={cn("absolute top-0 h-full", c.weight >= 0 ? "bg-bullish" : "bg-bearish")}
                              style={{
                                width: `${Math.min(50, Math.abs(c.weight) * 25)}%`,
                                left: c.weight >= 0 ? "50%" : `${50 - Math.min(50, Math.abs(c.weight) * 25)}%`,
                              }}
                            />
                            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-arc/30" />
                          </div>
                          <span className="w-10 text-right font-mono">{c.weight.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Panel>

              <Panel
                title="Calibrated Prediction"
                icon={<Gauge size={14} />}
                actions={
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Calibration
                    <Switch
                      checked={calibrationOn}
                      onCheckedChange={(v) => navigate({ search: (p: any) => ({ ...p, cal: v }), replace: true })}
                    />
                  </label>
                }
              >
                {calibrated && confluence && (
                  <div className="space-y-3">
                    <div
                      className={cn(
                        "font-display text-3xl",
                        calibrated.direction === "up"
                          ? "text-bullish"
                          : calibrated.direction === "down"
                            ? "text-bearish"
                            : "text-arc",
                      )}
                    >
                      {calibrated.direction === "up" ? "↑" : calibrated.direction === "down" ? "↓" : "→"}{" "}
                      {calibrated.confidencePct}%
                    </div>
                    <p className="text-xs text-muted-foreground">{calibrated.explanation}</p>
                    <div className="space-y-1">
                      {calibrated.steps.map((s, i) => (
                        <div key={i} className="text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-44 truncate text-muted-foreground">{s.label}</span>
                            <span
                              className={cn(
                                "font-mono w-16 text-right",
                                s.delta >= 0 ? "text-bullish" : "text-bearish",
                              )}
                            >
                              {(s.delta >= 0 ? "+" : "") + (s.delta * 100).toFixed(1)}pp
                            </span>
                          </div>
                          <p className="ml-2 text-[10px] text-muted-foreground/70">{s.reason}</p>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 border-t border-arc/10">
                      <div className="font-mono text-[10px] tracking-widest text-arc/70 mb-2 flex items-center gap-2">
                        <Layers size={10} /> TIMEFRAMES
                      </div>
                      <div className="space-y-1">
                        {confluence.buckets.map((b) => (
                          <div key={b.timeframe} className="flex items-center gap-2 text-xs">
                            <span className="w-8 font-mono text-arc">{b.timeframe}</span>
                            <div className="flex-1 h-1.5 bg-arc/10 rounded relative overflow-hidden">
                              <div
                                className={cn("absolute top-0 h-full", b.bias >= 0 ? "bg-bullish" : "bg-bearish")}
                                style={{
                                  width: `${Math.min(50, Math.abs(b.bias) * 50)}%`,
                                  left: b.bias >= 0 ? "50%" : `${50 - Math.min(50, Math.abs(b.bias) * 50)}%`,
                                }}
                              />
                              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-arc/30" />
                            </div>
                            <span className="w-10 text-right font-mono text-muted-foreground">
                              {b.patterns.length}p
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">
                        {Math.round(confluence.agreement * 100)}% of timeframes lean {confluence.dominantDirection}.
                      </p>
                    </div>
                  </div>
                )}
              </Panel>
            </div>

            {/* Recommendation */}
            {recommendation && (
              <Panel title="Recommendation" icon={<TrendingUp size={14} />}>
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      "font-display text-4xl",
                      recommendation.action === "BUY"
                        ? "text-bullish"
                        : recommendation.action === "SELL"
                          ? "text-bearish"
                          : "text-arc",
                    )}
                  >
                    {recommendation.action}
                  </div>
                  <div className="text-xs text-muted-foreground flex-1">
                    Composite {recommendation.composite >= 0 ? "+" : ""}
                    {(recommendation.composite * 100).toFixed(0)} — aggregated from predictor, pattern score, sentiment,
                    and backtest. Not financial advice.
                  </div>
                </div>
              </Panel>
            )}

            {/* Backtest */}
            <Panel
              title="Backtest"
              icon={<Activity size={14} />}
              actions={
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Hold {holdBars}d</span>
                  <Slider
                    value={[holdBars]}
                    min={1}
                    max={20}
                    step={1}
                    onValueChange={(v) => navigate({ search: (p: any) => ({ ...p, hold: v[0] }), replace: true })}
                    className="w-32"
                  />
                </div>
              }
            >
              {backtestTuned && backtestDefault && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
                    <Stat label="Trades" value={String(backtestTuned.trades)} />
                    <Stat
                      label="Win rate"
                      value={fmtPct(backtestTuned.winRate, 0)}
                      tone={backtestTuned.winRate >= 0.5 ? "bull" : "bear"}
                    />
                    <Stat
                      label="Total return"
                      value={(backtestTuned.totalReturn >= 0 ? "+" : "") + fmtPct(backtestTuned.totalReturn)}
                      tone={backtestTuned.totalReturn >= 0 ? "bull" : "bear"}
                    />
                    <Stat label="Sharpe" value={backtestTuned.sharpe.toFixed(2)} />
                    <Stat label="Max DD" value={fmtPct(backtestTuned.maxDrawdown)} tone="bear" />
                  </div>
                  <div className="h-56">
                    <ResponsiveContainer>
                      <ComposedChart data={equityChart}>
                        <XAxis
                          dataKey="t"
                          tickFormatter={(t) => format(t, "MMM d")}
                          stroke="var(--muted-foreground)"
                          fontSize={10}
                        />
                        <YAxis
                          domain={["auto", "auto"]}
                          tickFormatter={(v) => `${(Number(v) * 100 - 100).toFixed(0)}%`}
                          stroke="var(--muted-foreground)"
                          fontSize={10}
                        />
                        <Tooltip
                          labelFormatter={(t) => format(Number(t), "MMM d, yyyy")}
                          formatter={(v: any, n: string) => [
                            fmtPct(Number(v) - 1),
                            n === "tuned" ? "Tuned" : "Default",
                          ]}
                          contentStyle={{
                            background: "hsl(var(--background))",
                            border: "1px solid hsl(var(--border))",
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Line type="monotone" dataKey="tuned" stroke="hsl(var(--arc))" dot={false} strokeWidth={1.5} />
                        <Line
                          type="monotone"
                          dataKey="def"
                          stroke="hsl(var(--muted-foreground))"
                          dot={false}
                          strokeDasharray="3 3"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Tuned Δ default:{" "}
                    <span
                      className={cn(
                        "font-mono",
                        backtestTuned.totalReturn - backtestDefault.totalReturn >= 0 ? "text-bullish" : "text-bearish",
                      )}
                    >
                      {backtestTuned.totalReturn - backtestDefault.totalReturn >= 0 ? "+" : ""}
                      {fmtPct(backtestTuned.totalReturn - backtestDefault.totalReturn)}
                    </span>{" "}
                    on total return.
                  </p>
                </>
              )}
            </Panel>

            {/* ---- NEW: Watchlist & Alerts ---- */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Watchlist" icon={<BookOpen size={14} />}>
                <div className="space-y-2">
                  {watchlist.length === 0 && <div className="text-xs text-hud-dim">No symbols watched yet.</div>}
                  {watchlist.map((sym: string) => (
                    <div key={sym} className="flex items-center justify-between text-sm border-b border-arc/10 py-1">
                      <span className="font-mono">{sym}</span>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => load(sym)}>
                          Load
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleRemoveWL(sym)}>
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <Input
                      value={pending}
                      onChange={(e) => setPending(e.target.value.toUpperCase())}
                      placeholder="Add symbol"
                      className="flex-1"
                    />
                    <Button size="sm" onClick={() => handleAddWL(pending)}>
                      Add
                    </Button>
                  </div>
                </div>
              </Panel>

              <Panel title="Stock Alerts" icon={<Bell size={14} />}>
                <div className="space-y-2">
                  {alerts.length === 0 && <div className="text-xs text-hud-dim">No alerts set.</div>}
                  {alerts.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between text-sm border-b border-arc/10 py-1">
                      <div>
                        <span className="font-mono">{a.ticker}</span>
                        <span className="ml-2 text-hud-dim text-xs">
                          {a.type.replace(/_/g, " ")} {a.value}
                        </span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => handleRemoveAlert(a.id)}>
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  ))}
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <Input
                      value={alertTicker}
                      onChange={(e) => setAlertTicker(e.target.value.toUpperCase())}
                      placeholder="Ticker"
                      className="col-span-1"
                    />
                    <select
                      value={alertType}
                      onChange={(e) => setAlertType(e.target.value as any)}
                      className="bg-background/40 border border-arc/20 rounded-md px-2 py-1 text-xs col-span-1"
                    >
                      <option value="price_above">Price ↑</option>
                      <option value="price_below">Price ↓</option>
                      <option value="sma_cross_above">SMA cross ↑</option>
                      <option value="sma_cross_below">SMA cross ↓</option>
                      <option value="rsi_above">RSI ↑</option>
                      <option value="rsi_below">RSI ↓</option>
                      <option value="volume_spike">Volume spike</option>
                    </select>
                    <Input
                      value={alertValue}
                      onChange={(e) => setAlertValue(e.target.value)}
                      placeholder="Value"
                      className="col-span-1"
                    />
                  </div>
                  <Button size="sm" onClick={handleAddAlert} className="w-full">
                    Add Alert
                  </Button>
                </div>
              </Panel>
            </div>

            {/* ---- NEW: Portfolio Risk & Sector Performance ---- */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Portfolio Risk" icon={<Activity size={14} />}>
                <Button size="sm" onClick={fetchRisk} className="mb-2">
                  Refresh
                </Button>
                {riskData && !riskData.error ? (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <Stat label="Sharpe" value={riskData.sharpe?.toFixed(2) || "—"} />
                    <Stat label="Volatility" value={riskData.volatility ? fmtPct(riskData.volatility) : "—"} />
                    <Stat label="VaR (95%)" value={riskData.var95 ? fmtPct(riskData.var95) : "—"} />
                    <Stat label="Max Drawdown" value={riskData.maxDrawdown ? fmtPct(riskData.maxDrawdown) : "—"} />
                  </div>
                ) : (
                  <div className="text-xs text-hud-dim">{riskData?.error || "No holdings data"}</div>
                )}
              </Panel>

              <Panel title="Sector Performance" icon={<TrendingUp size={14} />}>
                <Button size="sm" onClick={fetchSector} className="mb-2">
                  Refresh
                </Button>
                {sectorData.length > 0 ? (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {sectorData.map((s: any) => (
                      <div
                        key={s.sector}
                        className="flex items-center justify-between text-xs border-b border-arc/5 py-1"
                      >
                        <span>{s.sector}</span>
                        <span className={s.change >= 0 ? "text-bullish" : "text-bearish"}>
                          {s.change?.toFixed(2) || "—"}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-hud-dim">Fetch sector ETFs (XLE, XLF, etc.)</div>
                )}
              </Panel>
            </div>

            {/* ---- NEW: Stock News Sentiment ---- */}
            <Panel title="Stock News" icon={<Newspaper size={14} />}>
              <div className="flex gap-2">
                <Input
                  value={pending}
                  onChange={(e) => setPending(e.target.value.toUpperCase())}
                  placeholder="Ticker for news"
                  className="flex-1"
                />
                <Button size="sm" onClick={() => fetchNews(pending)}>
                  Fetch
                </Button>
              </div>
              {newsData && (
                <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                  <div className="text-xs text-hud-dim">
                    Sentiment: {newsData.sentiment?.score?.toFixed(2)} (positive: {newsData.sentiment?.positive},
                    negative: {newsData.sentiment?.negative})
                  </div>
                  {newsData.news?.slice(0, 5).map((n: any, i: number) => (
                    <div key={i} className="text-xs border-b border-arc/5 py-1">
                      <div className="font-medium">{n.headline}</div>
                      <div className="text-hud-dim truncate">{n.summary}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* Reliability & Patterns */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                title="Recent Patterns"
                icon={<Sparkles size={14} />}
                actions={
                  <Button size="sm" variant="ghost" onClick={exportCSV} className="h-7 text-xs">
                    <FileDown size={12} className="mr-1.5" /> CSV
                  </Button>
                }
              >
                <div className="text-xs">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 font-mono text-[10px] tracking-widest text-arc/70 border-b border-arc/10 pb-1 mb-1">
                    <span>PATTERN</span>
                    <span>DATE</span>
                    <span>STR</span>
                    <span>BIAS</span>
                  </div>
                  {[...allPatterns]
                    .reverse()
                    .slice(0, 10)
                    .map((p) => (
                      <div key={p.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 py-1 border-b border-arc/5">
                        <span className="truncate">{p.label}</span>
                        <span className="font-mono text-muted-foreground text-[10px]">{format(p.t, "MMM d")}</span>
                        <span className="font-mono text-[10px]">{(p.strength * 100).toFixed(0)}</span>
                        <span className={cn("text-[10px]", p.bullish ? "text-bullish" : "text-bearish")}>
                          {p.bullish ? "↑" : "↓"}
                        </span>
                      </div>
                    ))}
                  {!allPatterns.length && <div className="py-2 text-muted-foreground">No patterns detected.</div>}
                </div>
              </Panel>

              <Panel title="Reliability" icon={<Target size={14} />}>
                <div className="text-xs">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 font-mono text-[10px] tracking-widest text-arc/70 border-b border-arc/10 pb-1 mb-1">
                    <span>PATTERN</span>
                    <span>N</span>
                    <span>HIT</span>
                    <span>AVG</span>
                  </div>
                  {reliability.map((r) => (
                    <div key={r.label} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 py-1 border-b border-arc/5">
                      <span className="truncate">{r.label}</span>
                      <span className="font-mono text-[10px]">{r.total}</span>
                      <span
                        className={cn(
                          "font-mono text-[10px]",
                          r.hitRate >= 0.55 ? "text-bullish" : r.hitRate <= 0.45 ? "text-bearish" : "",
                        )}
                      >
                        {fmtPct(r.hitRate, 0)}
                      </span>
                      <span
                        className={cn("font-mono text-[10px]", r.avgReturnPct >= 0 ? "text-bullish" : "text-bearish")}
                      >
                        {(r.avgReturnPct >= 0 ? "+" : "") + fmtPct(r.avgReturnPct)}
                      </span>
                    </div>
                  ))}
                  {!reliability.length && <div className="py-2 text-muted-foreground">Need more history.</div>}
                </div>
              </Panel>
            </div>

            {/* News × Patterns */}
            <Panel title="News × Patterns" icon={<Newspaper size={14} />}>
              <div className="grid gap-2 md:grid-cols-2">
                {newsLinks
                  .filter((l) => l.matched.length)
                  .slice(-6)
                  .reverse()
                  .map((l, i) => (
                    <div key={i} className="rounded border border-arc/10 p-2 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn("font-medium", l.pattern.bullish ? "text-bullish" : "text-bearish")}>
                          {l.pattern.label}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                          {format(l.pattern.t, "MMM d")}
                        </span>
                      </div>
                      {l.matched.slice(0, 2).map((m, j) => (
                        <div key={j} className="text-[11px] text-muted-foreground truncate">
                          <span
                            className={cn(
                              "mr-1",
                              m.sentiment === "positive"
                                ? "text-bullish"
                                : m.sentiment === "negative"
                                  ? "text-bearish"
                                  : "text-arc",
                            )}
                          >
                            {m.sentiment[0].toUpperCase()}
                          </span>
                          {m.headline}
                        </div>
                      ))}
                    </div>
                  ))}
                {!newsLinks.some((l) => l.matched.length) && (
                  <p className="text-xs text-muted-foreground col-span-2">No news matched pattern windows.</p>
                )}
              </div>
            </Panel>

            <p className="text-[10px] text-muted-foreground text-center pt-2">
              Real daily closes from Yahoo Finance · synthetic OHLC · reliability from this series only. Not financial
              advice.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Helper Components (unchanged) ----
function Panel({
  title,
  icon,
  actions,
  children,
}: {
  title?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-arc/15 bg-background/40 backdrop-blur p-4">
      {(title || actions) && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-arc uppercase">
            {icon}
            {title}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded border border-arc/10 bg-arc/5 px-2 py-1.5">
      <div className="font-mono text-[9px] tracking-widest text-arc/70 uppercase">{label}</div>
      <div
        className={cn(
          "font-display text-sm mt-0.5",
          tone === "bull" ? "text-bullish" : tone === "bear" ? "text-bearish" : "",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="text-[10px] font-mono text-muted-foreground mb-1">{label}</div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}
