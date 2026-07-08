/**
 * Stock price watcher.
 * Checks each user's stock_holdings that have a note like "alert:>420" or "alert:<380"
 * and pushes a notification when the current price crosses the threshold.
 * Uses Finnhub (existing FINNHUB_API_KEY) — free tier, no Lovable credits.
 */

interface Holding {
  id: string;
  user_id: string;
  ticker: string;
  note: string | null;
  last_price_cents: number | null;
}

interface AlertRule {
  op: ">" | "<";
  price: number;
  raw: string;
}

function parseAlert(note: string | null): AlertRule | null {
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

export async function runStockWatcher(supabaseAdmin: any) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return { skipped: "no_finnhub_key" };

  const { data: holdings, error } = await supabaseAdmin
    .from("stock_holdings")
    .select("id, user_id, ticker, note, last_price_cents")
    .not("note", "is", null)
    .ilike("note", "%alert:%")
    .limit(500);

  if (error) throw error;
  if (!holdings?.length) return { checked: 0, alerts: 0 };

  let alerts = 0;
  let checked = 0;
  const byTicker = new Map<string, number>();

  for (const h of holdings as Holding[]) {
    const rule = parseAlert(h.note);
    if (!rule) continue;
    checked++;

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

  return { checked, alerts, unique_tickers: byTicker.size };
}
