# PatternFlow Analyzer Upgrade

Everything lands in the existing `/analyzer` route + `patterns.ts` / `analytics.ts` / `calibration.ts`. No new routes, no new tables — settings piggyback on `user_facts` (already used for LLM config) plus `localStorage` mirror.

## 1. Settings Panel (gear icon in Patterns + Predictor tabs)

New `src/components/jarvis/AnalyzerSettings.tsx` (Sheet from the right). Persisted via new server fns `getAnalyzerPrefs` / `setAnalyzerPrefs` in `src/lib/analyzer-prefs.functions.ts` writing to `user_facts` with key `analyzer_prefs`. Mirrored to `localStorage` for instant load.

Controls:
- Indicators: SMA, EMA, RSI, MACD, Bollinger, VWAP, Fibonacci — each with on/off + period input.
- Sensitivity slider 0–100 (scales `DEFAULT_PARAMS` tolerances in `patterns.ts`).
- Lookback: 1m / 3m / 6m / 1y / 5y (drives Yahoo range in `fetchHistorical`).
- News sentiment toggle + weight slider 0–100%.
- War Mode toggle (see §6).

Live-applied — no reload.

## 2. Reward-Based Prediction

Extend `src/lib/patterns.ts` with `rewardScore(predicted, actual) = -((predicted-actual)/actual)^2` and a rolling history table in `localStorage` (`analyzer_pred_history`) keyed by symbol. Prediction card gets:
- Price target + 1σ CI (from historical volatility).
- Reliability score = weighted avg of backtest win rate, pattern strength, sentiment alignment.
- Reward score = mean reward of last 20 predictions for this symbol.
- "Run Monte Carlo" button → 5,000 GBM paths in a Web Worker–free simple loop (client-side, fast), returns P10/P50/P90 and shown as shaded fan on chart.

## 3. News + LLM Sentiment

Server fn `scoreNewsSentiment` in `src/lib/news-sentiment.functions.ts`:
- Pull last 14d headlines via existing `fhNews`.
- Batch to Groq `llama-3.1-8b-instant` (already wired via `ai-gateway.server.ts`) with a strict JSON schema: `{score:-1..1, event_type:"earnings"|"fda"|"war"|"macro"|"none", impact:0..1}`.
- Fallback to existing keyword `sentimentScore` if Groq unreachable / no key.
- Special-event flags surfaced in prediction card as pill badges with historical-analog impact number (simple lookup table for earnings/FDA/war).

Fed into `calibratePrediction` via the existing `sentimentAdjust` path, weighted by the settings slider.

## 4. Backtesting

Already have `backtestStrategy` in `patterns.ts` — surface it in a new "Backtest" collapsible on the Predictor card. Computes over the selected lookback:
- Win rate, avg return, Sharpe (add Sharpe helper to `analytics.ts`).
- Rendered as small stat grid + equity curve sparkline.

## 5. UI

- Gear icons in Patterns + Predictor tab headers → open the Sheet.
- Draggable horizontal overlay lines on the Recharts chart: click empty area of chart to add, drag to move, right-click to delete. Stored per-symbol in `localStorage`. Implemented as SVG overlay layered on the chart container (Recharts doesn't natively support this, so it's a positioned overlay reading the chart's Y-scale via a ref).
- Indicator toggles reflect settings live — chart re-renders SMA/EMA/BB/VWAP lines from `useMemo`.

## 6. War Mode

Boolean pref. When on:
- Sentiment weight × 1.5 (capped 100%).
- Symbols matching a defense/energy/commodity list (LMT, RTX, NOC, GD, XOM, CVX, HAL, GLD, USO, …) get a red "WAR-EXPOSED" pill and reliability floor +10%.
- Stop-loss ATR multiplier in `backtestStrategy` tightened from 2.0 → 1.5 (surfaced in backtest output).

## Files touched / created

```text
NEW  src/lib/analyzer-prefs.functions.ts   # get/set prefs on user_facts
NEW  src/lib/news-sentiment.functions.ts   # Groq-backed sentiment + event flags
NEW  src/lib/monte-carlo.ts                # pure GBM sim (SSR-safe)
NEW  src/components/jarvis/AnalyzerSettings.tsx
NEW  src/components/jarvis/ChartOverlayLines.tsx
EDIT src/lib/analytics.ts                  # + sharpe(), + volatility()
EDIT src/lib/patterns.ts                   # + rewardScore, sensitivity scaling, warMode hook
EDIT src/lib/calibration.ts                # honor sentiment weight + war-mode boost
EDIT src/routes/_authenticated/analyzer.tsx # gear buttons, wiring, MC button, backtest panel, overlays
```

No DB migration. No new secrets — reuses `GROQ_API_KEY` and `FINNHUB_API_KEY`.

## Out of scope (call out before I build)

- No new "Patterns" / "Predictor" *routes* — they're tabs inside `/analyzer` today; the gear lives on those tab headers.
- Monte Carlo runs client-side (fast enough, zero credits). If you'd rather it be a server fn, say so.
- Draggable overlays are simple horizontal lines; full trendline/fib drawing is a bigger job.

Confirm and I'll ship it in one pass.
