// Analyzer-to-Predictor Calibration Engine
import type { DetectedPattern, PatternReliability, PredictorResult } from "./patterns";
import type { ConfluenceResult } from "./confluence";
import { sentimentScore, type NewsLite } from "./analytics";

export interface CalibrationInput {
  raw: PredictorResult;
  patterns: DetectedPattern[];
  reliability: PatternReliability[];
  confluence: ConfluenceResult;
  news: NewsLite[];
  enabled?: boolean;
}

export interface XaiStep { label: string; delta: number; reason: string; }

export interface CalibratedResult {
  enabled: boolean;
  rawProbability: number;
  calibratedProbability: number;
  direction: "up" | "down" | "flat";
  confidencePct: number;
  reliabilityFactor: number;
  confluenceBoost: number;
  sentimentAdjust: number;
  steps: XaiStep[];
  activePatterns: DetectedPattern[];
  explanation: string;
}

function signedProb(raw: PredictorResult): number {
  if (raw.direction === "up") return 0.5 + (raw.probability - 0.5);
  if (raw.direction === "down") return 0.5 - (raw.probability - 0.5);
  return 0.5;
}

export function calibratePrediction(input: CalibrationInput): CalibratedResult {
  const { raw, patterns, reliability, confluence, news, enabled = true } = input;
  const rawSigned = signedProb(raw);
  const steps: XaiStep[] = [];
  steps.push({ label: `Raw ${raw.mode} model`, delta: rawSigned - 0.5, reason: raw.explanation });

  if (!enabled) {
    return {
      enabled: false,
      rawProbability: rawSigned,
      calibratedProbability: rawSigned,
      direction: rawSigned > 0.55 ? "up" : rawSigned < 0.45 ? "down" : "flat",
      confidencePct: Math.round(Math.abs(rawSigned - 0.5) * 200),
      reliabilityFactor: 1, confluenceBoost: 0, sentimentAdjust: 0,
      steps, activePatterns: [], explanation: "Calibration disabled — showing raw model output.",
    };
  }

  const active = patterns.slice(-6);
  const relMap = new Map(reliability.map((r) => [r.label, r]));
  const rawBullish = rawSigned > 0.5;
  let agreeRel = 0, agreeN = 0, disagreeRel = 0, disagreeN = 0;
  for (const p of active) {
    const r = relMap.get(p.label)?.hitRate ?? 0.5;
    if (p.bullish === rawBullish) { agreeRel += r; agreeN += 1; }
    else { disagreeRel += r; disagreeN += 1; }
  }
  const agreeAvg = agreeN ? agreeRel / agreeN : 0.5;
  const disagreeAvg = disagreeN ? disagreeRel / disagreeN : 0;
  const reliabilityFactor = Math.max(0.25, Math.min(1.2, 0.5 + agreeAvg * 0.7 - disagreeAvg * 0.4));
  let prob = 0.5 + (rawSigned - 0.5) * reliabilityFactor;
  steps.push({
    label: "Pattern reliability",
    delta: prob - rawSigned,
    reason: `${agreeN} active agree (${(agreeAvg * 100).toFixed(0)}% hit-rate)` +
      (disagreeN ? `, ${disagreeN} disagree (${(disagreeAvg * 100).toFixed(0)}%)` : "") +
      ` → factor ×${reliabilityFactor.toFixed(2)}.`,
  });

  let confluenceBoost = 0;
  if (confluence.score >= 3) {
    const dirAlign = (confluence.dominantDirection === "bullish" && rawBullish) ||
                     (confluence.dominantDirection === "bearish" && !rawBullish);
    confluenceBoost = (dirAlign ? 1 : -1) * (confluence.score / 5) * 0.15;
    const before = prob;
    prob = Math.max(0.02, Math.min(0.98, prob + confluenceBoost));
    steps.push({
      label: `Multi-timeframe confluence ${confluence.score}/5`,
      delta: prob - before,
      reason: `${confluence.dominantDirection} across ${Math.round(confluence.agreement * 100)}% of timeframes — ${dirAlign ? "reinforces" : "contradicts"} model.`,
    });
  }

  const sent = sentimentScore(news);
  let sentimentAdjust = 0;
  if (news.length >= 3 && Math.abs(sent.score) > 0.1) {
    sentimentAdjust = Math.max(-0.1, Math.min(0.1, sent.score * 0.1));
    const before = prob;
    prob = Math.max(0.02, Math.min(0.98, prob + sentimentAdjust));
    steps.push({
      label: "News sentiment",
      delta: prob - before,
      reason: `${news.length} headlines, net sentiment ${(sent.score * 100).toFixed(0)} (${sent.positive}↑ / ${sent.negative}↓).`,
    });
  }

  const direction: "up" | "down" | "flat" = prob > 0.55 ? "up" : prob < 0.45 ? "down" : "flat";
  const confidencePct = Math.round(Math.abs(prob - 0.5) * 200);
  const explanation =
    `Calibrated ${direction.toUpperCase()} ${confidencePct}% — raw ${raw.mode} model ` +
    `(${Math.round(Math.abs(rawSigned - 0.5) * 200)}%) adjusted by reliability ×${reliabilityFactor.toFixed(2)}` +
    (confluenceBoost !== 0 ? `, confluence ${confluenceBoost > 0 ? "+" : ""}${(confluenceBoost * 100).toFixed(0)}pp` : "") +
    (sentimentAdjust !== 0 ? `, sentiment ${sentimentAdjust > 0 ? "+" : ""}${(sentimentAdjust * 100).toFixed(0)}pp` : "") + ".";

  return {
    enabled: true,
    rawProbability: rawSigned,
    calibratedProbability: prob,
    direction, confidencePct,
    reliabilityFactor, confluenceBoost, sentimentAdjust,
    steps, activePatterns: active, explanation,
  };
}
