import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fhQuote, fhProfile, fhFinancials, fhNews, fhSearch, synthSeries, fetchHistorical } from "./finnhub.server";

const SymbolInput = z.object({ symbol: z.string().min(1).max(10).regex(/^[A-Za-z.\-]+$/) });

export const getStockSnapshot = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SymbolInput.parse(input))
  .handler(async ({ data }) => {
    const symbol = data.symbol.toUpperCase();
    try {
      const [quote, profile, financials, news] = await Promise.all([
        fhQuote(symbol),
        fhProfile(symbol).catch(() => ({} as any)),
        fhFinancials(symbol).catch(() => ({} as any)),
        fhNews(symbol).catch(() => [] as any[]),
      ]);
      const price = quote.c || quote.pc || 0;
      if (!price) return { ok: false as const, error: `No data for ${symbol}` };

      let series: Array<{ t: number; p: number; v: number }>;
      try {
        const candles = await fetchHistorical(symbol, "2y", "1d");
        if (!candles.length) throw new Error("empty");
        series = candles.map((c) => ({ t: c.t, p: c.c, v: c.v }));
        const lastT = series[series.length - 1].t;
        if (Date.now() - lastT > 60_000) series.push({ t: Date.now(), p: price, v: series[series.length - 1].v });
        else series[series.length - 1] = { t: Date.now(), p: price, v: series[series.length - 1].v };
      } catch {
        series = synthSeries(symbol, price, 365);
        series[series.length - 1] = { t: Date.now(), p: price, v: series[series.length - 1].v };
      }

      return {
        ok: true as const,
        symbol,
        quote,
        profile: {
          name: profile.name ?? symbol,
          industry: profile.finnhubIndustry ?? "—",
          logo: profile.logo ?? "",
          marketCap: profile.marketCapitalization ?? null,
          exchange: profile.exchange ?? "—",
          currency: profile.currency ?? "USD",
        },
        metrics: financials.metric ?? {},
        series,
        news: (news ?? []).slice(0, 12).map((n: any) => ({
          id: n.id, headline: n.headline, summary: n.summary, url: n.url,
          source: n.source, datetime: n.datetime, image: n.image,
        })),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Unknown error" };
    }
  });

export const searchSymbols = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ q: z.string().min(1).max(40) }).parse(input))
  .handler(async ({ data }) => {
    try {
      const r = await fhSearch(data.q);
      return {
        ok: true as const,
        results: r.result
          .filter((x) => x.type === "Common Stock" || !x.type)
          .slice(0, 10)
          .map((x) => ({ symbol: x.symbol, name: x.description })),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "search failed", results: [] as { symbol: string; name: string }[] };
    }
  });
