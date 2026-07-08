/**
 * Stock price watcher.
 * 1) Checks each user's stock_holdings with note like "alert:>420" (legacy).
 * 2) Also checks user_facts for alert_rules (new: SMA cross, RSI, volume spike).
 * Uses Finnhub (existing FINNHUB_API_KEY) — free tier, no Lovable credits.
 */

import { sma, rsi, fetchHistorical } from "@/lib/jarvis.functions";

interface Holding {
  id: string;
  user_id: string;
  ticker: string;
  note: string | null;
  last_price_cents: number | null;
}

interface AlertRuleLegacy {
  op: ">" | "<";
  price: number;
  raw: string;
}

// ---- New alert types ----
type AlertType =
  | "price_above"
  | "price_below"
  | "sma_cross_above"
  | "sma_cross_below"
  | "rsi_above"
  | "rsi_below"
  | "volume_spike";

interface AlertRuleNew {
  id: string;
  type: AlertType;
  value: number;
  created_at: string;
}

function parseAlertLegacy(note: string | null): AlertRuleLegacy | null {
  if (!note) return null;
  const m = note.match(/alert:\s*([<>])\s*\$?([\d.,]+)/i);
  if (!m) return null;
  const price = parseFloat(m[2].replace(/,/g, ""));
  if (!isFinite(price)) return null;
  return { op: m[1] as ">" | "<", price, raw: m[0] };
}

async function quote(ticker: string, apiKey: string): Promise<number | null> {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`);
    if (!r.ok) return null;
    const j = await r.json();
    const c = Number(j?.c);
    return isFinite(c) && c > 0 ? c : null;
  } catch {
    return null;
  }
}

// ---- New indicators helper ----
async function getIndicators(
  ticker: string,
): Promise<{ price: number; sma20: number; sma50: number; rsi14: number; volume: number; avgVol20: number } | null> {
  const candles = await fetchHistorical(ticker);
  if (!candles || candles.length < 50) return null;
  const prices = candles.map((c) => c.p);
  const vols = candles.map((c) => c.v);
  const last = candles.length - 1;
  return {
    price: prices[last],
    sma20: sma(prices, 20),
    sma50: sma(prices, 50),
    rsi14: rsi(prices, 14),
    volume: vols[last],
    avgVol20: sma(vols, 20),
  };
}

function checkNewRule(rule: AlertRuleNew, ind: NonNullable<Awaited<ReturnType<typeof getIndicators>>>): boolean {
  switch (rule.type) {
    case "price_above":
      return ind.price > rule.value;
    case "price_below":
      return ind.price < rule.value;
    case "sma_cross_above":
      return ind.sma20 > ind.sma50 && ind.sma20 > rule.value;
    case "sma_cross_below":
      return ind.sma20 < ind.sma50 && ind.sma20 < rule.value;
    case "rsi_above":
      return ind.rsi14 > rule.value;
    case "rsi_below":
      return ind.rsi14 < rule.value;
    case "volume_spike":
      return ind.volume > ind.avgVol20 * rule.value;
    default:
      return false;
  }
}

// ---- Track last triggered per user+rule to avoid spam ----
const lastTriggered = new Map<string, number>(); // key: `${userId}-${ruleId}` -> timestamp

export async function runStockWatcher(supabaseAdmin: any) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return { skipped: "no_finnhub_key" };

  let alerts = 0;
  let checkedLegacy = 0;
  let checkedNew = 0;

  // ============================================================
  // 1) LEGACY: parse note-based alerts from stock_holdings
  // ============================================================
  const { data: holdings, error } = await supabaseAdmin
    .from("stock_holdings")
    .select("id, user_id, ticker, note, last_price_cents")
    .not("note", "is", null)
    .ilike("note", "%alert:%")
    .limit(500);

  if (error) throw error;
  if (holdings?.length) {
    const byTicker = new Map<string, number>();
    for (const h of holdings as Holding[]) {
      const rule = parseAlertLegacy(h.note);
      if (!rule) continue;
      checkedLegacy++;

      let price = byTicker.get(h.ticker);
      if (price === undefined) {
        const p = await quote(h.ticker, apiKey);
        if (p == null) continue;
        price = p;
        byTicker.set(h.ticker, p);
      }

      const crossed = rule.op === ">" ? price >= rule.price : price <= rule.price;
      if (!crossed) continue;

      // De-dupe: skip if already notified in last 6h for this holding+rule
      const sinceIso = new Date(Date.now() - 6 * 3600_000).toISOString();
      const { count } = await supabaseAdmin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", h.user_id)
        .eq("source_table", "stock_holdings")
        .eq("source_id", h.id)
        .gte("created_at", sinceIso);
      if ((count ?? 0) > 0) continue;

      const arrow = rule.op === ">" ? "↑" : "↓";
      await supabaseAdmin.from("notifications").insert({
        user_id: h.user_id,
        type: "system",
        priority: "high",
        title: `${h.ticker} ${arrow} $${price.toFixed(2)}`,
        message: `${h.ticker} crossed your ${rule.op === ">" ? "upper" : "lower"} threshold of $${rule.price} — now $${price.toFixed(2)}, Sir.`,
        source_table: "stock_holdings",
        source_id: h.id,
        action_payload: { ticker: h.ticker, price, rule },
      });

      // Refresh last_price_cents on the holding
      await supabaseAdmin
        .from("stock_holdings")
        .update({ last_price_cents: Math.round(price * 100), last_price_at: new Date().toISOString() })
        .eq("id", h.id);

      alerts++;
    }
  }

  // ============================================================
  // 2) NEW: fetch alert_rules from user_facts
  // ============================================================
  const { data: rulesData } = await supabaseAdmin
    .from("user_facts")
    .select("user_id, key, value")
    .eq("category", "alert_rules")
    .ilike("key", "stock_%");

  if (rulesData?.length) {
    // Parse into a map: user_id -> ticker -> rules[]
    const userRules = new Map<string, Map<string, AlertRuleNew[]>>();
    for (const row of rulesData) {
      const ticker = row.key.replace("stock_", "");
      const rules: AlertRuleNew[] = JSON.parse(row.value || "[]");
      if (!rules.length) continue;
      if (!userRules.has(row.user_id)) userRules.set(row.user_id, new Map());
      const tickerMap = userRules.get(row.user_id)!;
      if (!tickerMap.has(ticker)) tickerMap.set(ticker, []);
      tickerMap.get(ticker)!.push(...rules);
    }

    for (const [userId, tickerMap] of userRules) {
      for (const [ticker, rules] of tickerMap) {
        checkedNew++;
        const ind = await getIndicators(ticker);
        if (!ind) continue;

        for (const rule of rules) {
          const triggered = checkNewRule(rule, ind);
          if (!triggered) continue;

          const key = `${userId}-${rule.id}`;
          const now = Date.now();
          const last = lastTriggered.get(key) || 0;
          // Cooldown: 6 hours
          if (now - last < 6 * 3600_000) continue;
          lastTriggered.set(key, now);

          const label = rule.type.replace(/_/g, " ").toUpperCase();
          const valueStr = rule.type.includes("sma")
            ? `${rule.value}%`
            : rule.type === "volume_spike"
              ? `${rule.value}x avg`
              : `$${rule.value.toFixed(2)}`;
          await supabaseAdmin.from("notifications").insert({
            user_id: userId,
            type: "system",
            priority: "high",
            title: `${ticker} ${label} 🚨`,
            message: `${ticker} triggered ${label} (${valueStr}) — current price $${ind.price.toFixed(2)}, Sir.`,
            source_table: "watcher",
            action_payload: { ticker, rule, indicators: ind },
          });
          alerts++;
        }
      }
    }
  }

  return {
    checkedLegacy,
    checkedNew,
    alerts,
  };
}
