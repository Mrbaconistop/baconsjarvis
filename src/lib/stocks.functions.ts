import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Quote = { symbol: string; price: number };

async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
  const res = await fetch(url, {
    headers: {
      // Yahoo blocks default fetch UA; pretend to be a browser
      "User-Agent": "Mozilla/5.0 (compatible; JarvisBot/1.0)",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Quote provider returned ${res.status}`);
  const j: any = await res.json();
  const rows = j?.quoteResponse?.result ?? [];
  return rows.map((r: any) => ({
    symbol: String(r.symbol).toUpperCase(),
    price: Number(r.regularMarketPrice ?? r.postMarketPrice ?? r.preMarketPrice ?? 0),
  })).filter((q: Quote) => isFinite(q.price) && q.price > 0);
}

export const refreshStockPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: holdings, error } = await supabase
      .from("stock_holdings").select("id, ticker").eq("user_id", userId);
    if (error) throw new Error(error.message);
    const tickers = Array.from(new Set((holdings ?? []).map((h: any) => h.ticker.toUpperCase())));
    if (!tickers.length) return { updated: 0, prices: [] as Quote[] };

    let quotes: Quote[] = [];
    try {
      quotes = await fetchQuotes(tickers);
    } catch (e: any) {
      return { updated: 0, prices: [], error: e?.message ?? "Quote fetch failed" };
    }

    const now = new Date().toISOString();
    let updated = 0;
    for (const q of quotes) {
      const { error: upErr } = await supabase.from("stock_holdings")
        .update({ last_price_cents: Math.round(q.price * 100), last_price_at: now })
        .eq("user_id", userId).eq("ticker", q.symbol);
      if (!upErr) updated++;
    }
    return { updated, prices: quotes };
  });

export const quoteSymbols = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { symbols: string[] }) =>
    z.object({ symbols: z.array(z.string().min(1).max(10)).max(20) }).parse(input))
  .handler(async ({ data }) => {
    try {
      const prices = await fetchQuotes(data.symbols.map(s => s.toUpperCase()));
      return { ok: true as const, prices };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "Quote fetch failed", prices: [] as Quote[] };
    }
  });
