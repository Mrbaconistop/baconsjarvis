import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fhNews } from "./finnhub.server";
import { sentimentScore, type NewsLite } from "./analytics";

export type EventType = "earnings" | "fda" | "war" | "macro" | "merger" | "none";

export interface ScoredHeadline {
  headline: string;
  datetime: number;
  url: string;
  score: number;         // -1..1
  event_type: EventType;
  impact: number;        // 0..1
}

export interface NewsSentimentResult {
  ok: boolean;
  source: "groq" | "keyword";
  aggregate: number;              // -1..1 weighted mean
  headlines: ScoredHeadline[];
  events: { type: EventType; count: number; avgImpact: number }[];
  error?: string;
}

// Historical-analog impact table (rough %-move magnitudes)
const EVENT_ANALOGS: Record<EventType, number> = {
  earnings: 0.06,
  fda: 0.15,
  war: 0.05,
  macro: 0.03,
  merger: 0.20,
  none: 0.0,
};

function keywordEvent(text: string): EventType {
  const t = text.toLowerCase();
  if (/(earning|eps|revenue|beat|miss|guidance|quarter)/.test(t)) return "earnings";
  if (/(fda|clinical|trial|approval|phase [123])/.test(t)) return "fda";
  if (/(war|invasion|missile|strike|troops|ceasefire|conflict|sanction)/.test(t)) return "war";
  if (/(fed|inflation|cpi|jobs report|rate hike|rate cut|tariff|recession)/.test(t)) return "macro";
  if (/(acquire|acquisition|merger|takeover|buyout)/.test(t)) return "merger";
  return "none";
}

async function scoreWithGroq(headlines: NewsLite[]): Promise<ScoredHeadline[] | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key || !headlines.length) return null;

  const list = headlines.slice(0, 20).map((h, i) => `${i + 1}. ${h.headline}`).join("\n");
  const prompt = `You are a financial-news sentiment classifier. For each numbered headline, output ONE JSON line:
{"i":<num>,"score":<-1..1>,"event":"earnings|fda|war|macro|merger|none","impact":<0..1>}

Score = market-impact sentiment for the stock (negative bad, positive good).
Impact = expected magnitude of price move (0=nil, 1=huge).
Output ONLY the JSON lines, no prose.

Headlines:
${list}`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
        temperature: 0,
        max_tokens: 900,
        messages: [
          { role: "system", content: "You output only JSON lines, no explanation." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    const out: ScoredHeadline[] = [];
    for (const line of text.split("\n")) {
      const m = line.match(/\{[^}]+\}/);
      if (!m) continue;
      try {
        const obj = JSON.parse(m[0]);
        const idx = Number(obj.i) - 1;
        const h = headlines[idx];
        if (!h) continue;
        const evRaw = String(obj.event ?? "none");
        const event_type: EventType = (
          ["earnings", "fda", "war", "macro", "merger", "none"].includes(evRaw) ? evRaw : "none"
        ) as EventType;
        out.push({
          headline: h.headline,
          datetime: h.datetime,
          url: (h as any).url ?? "",
          score: Math.max(-1, Math.min(1, Number(obj.score) || 0)),
          event_type,
          impact: Math.max(0, Math.min(1, Number(obj.impact) || 0)),
        });
      } catch { /* skip */ }
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function keywordFallback(headlines: NewsLite[]): ScoredHeadline[] {
  return headlines.slice(0, 20).map((h) => {
    const text = `${h.headline} ${h.summary ?? ""}`;
    const s = sentimentScore([h]).score;
    const event_type = keywordEvent(text);
    return {
      headline: h.headline,
      datetime: h.datetime,
      url: (h as any).url ?? "",
      score: s,
      event_type,
      impact: event_type === "none" ? Math.abs(s) * 0.3 : EVENT_ANALOGS[event_type],
    };
  });
}

export const scoreNewsSentiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ symbol: z.string().min(1).max(10) }).parse(i),
  )
  .handler(async ({ data }): Promise<NewsSentimentResult> => {
    const symbol = data.symbol.toUpperCase();
    let raw: NewsLite[] = [];
    try {
      const items = await fhNews(symbol);
      raw = (items ?? []).map((n: any) => ({
        headline: n.headline,
        summary: n.summary,
        datetime: n.datetime,
        url: n.url,
      })) as NewsLite[];
    } catch (e: any) {
      return { ok: false, source: "keyword", aggregate: 0, headlines: [], events: [], error: e?.message };
    }

    if (!raw.length) return { ok: true, source: "keyword", aggregate: 0, headlines: [], events: [] };

    const groq = await scoreWithGroq(raw);
    const scored = groq ?? keywordFallback(raw);

    const now = Date.now() / 1000;
    let wSum = 0, wTot = 0;
    for (const s of scored) {
      const ageDays = Math.max(1, (now - s.datetime) / 86400);
      const w = (1 / Math.sqrt(ageDays)) * (0.5 + s.impact);
      wSum += s.score * w;
      wTot += w;
    }
    const aggregate = wTot ? Math.max(-1, Math.min(1, wSum / wTot)) : 0;

    const eventMap = new Map<EventType, { count: number; impactSum: number }>();
    for (const s of scored) {
      const b = eventMap.get(s.event_type) ?? { count: 0, impactSum: 0 };
      b.count += 1;
      b.impactSum += s.impact;
      eventMap.set(s.event_type, b);
    }
    const events = [...eventMap.entries()]
      .filter(([t]) => t !== "none")
      .map(([type, b]) => ({ type, count: b.count, avgImpact: b.impactSum / b.count }))
      .sort((a, b) => b.avgImpact - a.avgImpact);

    return { ok: true, source: groq ? "groq" : "keyword", aggregate, headlines: scored, events };
  });
