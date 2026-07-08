import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";
import { z } from "zod";
import { getModelForUser, JARVIS_SYSTEM_PROMPT } from "./ai-gateway.server";

async function loadContext(supabase: any, userId: string) {
  const { data: profile } = await supabase.from("profiles").select("address_as, name").eq("id", userId).maybeSingle();
  const { data: nextEvent } = await supabase
    .from("reminders")
    .select("title, datetime")
    .eq("user_id", userId)
    .eq("is_completed", false)
    .gte("datetime", new Date().toISOString())
    .order("datetime", { ascending: true })
    .limit(1)
    .maybeSingle();
  return {
    addressAs: profile?.address_as ?? "Sir",
    nextEvent: nextEvent ? { title: nextEvent.title, datetime: nextEvent.datetime as string } : null,
  };
}

/* ---------- Run a natural-language command ---------- */
export const runCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ text: z.string().min(1).max(800) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const ctx = await loadContext(supabase, userId);

    const { model } = await getModelForUser(userId, supabase);

    const planSchema = z.object({
      intent: z.enum(["create_reminder", "summarise", "draft_reply", "answer"]),
      reply: z.string(),
      reminder: z
        .object({
          title: z.string(),
          datetime_iso: z.string(),
          priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
        })
        .nullable()
        .optional(),
    });

    const { text } = await generateText({
      model,
      system: `${JARVIS_SYSTEM_PROMPT}

Address the user as "${ctx.addressAs}". Today is ${new Date().toISOString()}.
${ctx.nextEvent ? `Sir's next commitment: "${ctx.nextEvent.title}" at ${ctx.nextEvent.datetime}.` : ""}

You receive a command. Return JSON only matching this shape (no markdown, no commentary):
{"intent":"create_reminder"|"summarise"|"draft_reply"|"answer","reply":"<short JARVIS-voiced response>","reminder":{"title":"...","datetime_iso":"ISO 8601","priority":"normal"} | null}

If the command sets a reminder, populate "reminder" with a resolved absolute ISO datetime.
Otherwise set "reminder" to null. "reply" is always present.`,
      prompt: data.text,
    });

    let parsed: z.infer<typeof planSchema>;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = planSchema.parse(JSON.parse(jsonMatch ? jsonMatch[0] : text));
    } catch {
      return { reply: text.slice(0, 400), created: null as null | { id: string } };
    }

    let created: { id: string } | null = null;
    if (parsed.intent === "create_reminder" && parsed.reminder) {
      const dt = new Date(parsed.reminder.datetime_iso);
      if (!isNaN(dt.getTime())) {
        const { data: row } = await supabase
          .from("reminders")
          .insert({
            user_id: userId,
            title: parsed.reminder.title,
            datetime: dt.toISOString(),
            priority: parsed.reminder.priority,
            source_type: "voice",
          })
          .select("id")
          .single();
        created = row ?? null;
      }
    }

    return { reply: parsed.reply, created };
  });

/* ---------- Draft a reply to a social feed item ---------- */
export const draftReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ feedId: z.string().uuid(), tone: z.enum(["measured", "warm", "decline", "thank"]).default("measured") })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: feed } = await supabase
      .from("social_feeds")
      .select("*")
      .eq("id", data.feedId)
      .eq("user_id", userId)
      .single();
    if (!feed) throw new Error("Not found");
    const ctx = await loadContext(supabase, userId);

    const { model } = await getModelForUser(userId, supabase);

    const { text } = await generateText({
      model,
      system: `${JARVIS_SYSTEM_PROMPT}

You are drafting a reply on ${ctx.addressAs}'s behalf for ${feed.platform}.
Reply tone: ${data.tone}. Stay professional, brand-safe, and in character. Do not address yourself; this is the user's voice now, refined.
Return only the reply text. No quotes, no preamble.`,
      prompt: `Original from ${feed.author_name} (${feed.author_handle ?? ""}):\n"""${feed.content}"""`,
    });
    return { draft: text.trim() };
  });

/* ---------- Morning briefing ---------- */
export const morningBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const ctx = await loadContext(supabase, userId);
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [{ data: feeds }, { data: upcoming }] = await Promise.all([
      supabase
        .from("social_feeds")
        .select("platform, author_name, content, sentiment_label, priority")
        .eq("user_id", userId)
        .gte("received_at", since)
        .order("received_at", { ascending: false })
        .limit(40),
      supabase
        .from("reminders")
        .select("title, datetime, priority")
        .eq("user_id", userId)
        .eq("is_completed", false)
        .gte("datetime", new Date().toISOString())
        .lte("datetime", new Date(Date.now() + 36 * 3600_000).toISOString())
        .order("datetime", { ascending: true }),
    ]);

    const { model } = await getModelForUser(userId, supabase);

    const { text } = await generateText({
      model,
      system: `${JARVIS_SYSTEM_PROMPT}

Address the user as "${ctx.addressAs}". Produce a morning briefing in exactly this structure:

Line 1: One-sentence salutation referencing the time of day.
Then 3 bullet points (prefix "• "), one each for: (a) the most important upcoming commitment, (b) the most urgent social signal that needs the user's voice, (c) anything else notable.
End with one short anticipatory line offering the next action.
Total under 120 words.`,
      prompt: `Upcoming commitments (next 36h):
${(upcoming ?? []).map((r: any) => `- ${r.title} @ ${r.datetime} [${r.priority}]`).join("\n") || "(none)"}

Social signals (last 24h):
${(feeds ?? []).map((f: any) => `- [${f.platform}/${f.priority}/${f.sentiment_label}] ${f.author_name}: ${f.content}`).join("\n") || "(none)"}`,
    });

    await supabase.from("notifications").insert({
      user_id: userId,
      type: "briefing",
      priority: "normal",
      title: "Morning briefing",
      message: text.trim(),
      action_payload: [{ type: "dismiss", label: "Acknowledged" }],
    });

    return { briefing: text.trim() };
  });

// ============================================================
// 🌤️ WEATHER FUNCTIONS
// ============================================================

/* ---------- Get the user's saved weather location ---------- */
export const getWeatherLocation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data } = await supabase
      .from("user_facts")
      .select("value")
      .eq("user_id", userId)
      .eq("category", "preference")
      .eq("key", "weather_place_id")
      .maybeSingle();

    if (!data) return null;

    const { data: place } = await supabase
      .from("map_places")
      .select("id, label, address, lat, lng")
      .eq("id", data.value)
      .eq("user_id", userId)
      .maybeSingle();

    return place || null;
  });

/* ---------- Set the user's weather location ---------- */
export const setWeatherLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ placeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase.from("user_facts").upsert(
      {
        user_id: userId,
        category: "preference",
        key: "weather_place_id",
        value: data.placeId,
      },
      { onConflict: "user_id,category,key" },
    );
    if (error) throw error;
    return { ok: true };
  });

/* ---------- Fetch current weather ---------- */
export const getWeather = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const API_KEY = process.env.OPENWEATHER_API_KEY;
    if (!API_KEY) throw new Error("OpenWeatherMap API key is missing");

    let lat: number | null = null;
    let lon: number | null = null;
    let cityName = "London";

    const { data: pref } = await supabase
      .from("user_facts")
      .select("value")
      .eq("user_id", userId)
      .eq("category", "preference")
      .eq("key", "weather_place_id")
      .maybeSingle();

    if (pref) {
      const { data: place } = await supabase
        .from("map_places")
        .select("lat, lng, label")
        .eq("id", pref.value)
        .eq("user_id", userId)
        .maybeSingle();
      if (place) {
        lat = place.lat;
        lon = place.lng;
        cityName = place.label;
      }
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat || 51.5074}&lon=${lon || -0.1278}&appid=${API_KEY}&units=metric`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Weather API error: ${response.status} ${errorText}`);
    }
    const data = await response.json();

    return {
      temperature: data.main.temp,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
      city: cityName,
      country: data.sys.country,
      humidity: data.main.humidity,
      windSpeed: data.wind.speed,
      feelsLike: data.main.feels_like,
    };
  });

/* ---------- Get 5‑day weather forecast ---------- */
export const getWeatherForecast = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const API_KEY = process.env.OPENWEATHER_API_KEY;
    if (!API_KEY) throw new Error("OpenWeatherMap API key is missing");

    let lat: number | null = null;
    let lon: number | null = null;
    let cityName = "London";

    const { data: pref } = await supabase
      .from("user_facts")
      .select("value")
      .eq("user_id", userId)
      .eq("category", "preference")
      .eq("key", "weather_place_id")
      .maybeSingle();

    if (pref) {
      const { data: place } = await supabase
        .from("map_places")
        .select("lat, lng, label")
        .eq("id", pref.value)
        .eq("user_id", userId)
        .maybeSingle();
      if (place) {
        lat = place.lat;
        lon = place.lng;
        cityName = place.label;
      }
    }

    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat || 51.5074}&lon=${lon || -0.1278}&appid=${API_KEY}&units=metric`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Forecast API error: ${response.status} ${errorText}`);
    }
    const data = await response.json();

    const dailyForecasts: any[] = [];
    const seenDays = new Set();

    for (const item of data.list) {
      const date = new Date(item.dt * 1000);
      const dayKey = date.toISOString().split("T")[0];
      if (!seenDays.has(dayKey) && dailyForecasts.length < 5) {
        seenDays.add(dayKey);
        dailyForecasts.push({
          date: dayKey,
          day: date.toLocaleDateString("en-US", { weekday: "short" }),
          temp: Math.round(item.main.temp),
          feelsLike: Math.round(item.main.feels_like),
          description: item.weather[0].description,
          icon: item.weather[0].icon,
          humidity: item.main.humidity,
          windSpeed: Math.round(item.wind.speed * 3.6),
          pop: Math.round((item.pop || 0) * 100),
        });
      }
    }

    return {
      city: cityName,
      country: data.city.country,
      forecasts: dailyForecasts,
    };
  });

/* ---------- Generate a natural‑language weather description ---------- */
export const getWeatherNarrative = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const API_KEY = process.env.OPENWEATHER_API_KEY;
    if (!API_KEY) throw new Error("OpenWeatherMap API key is missing");

    let lat: number | null = null;
    let lon: number | null = null;
    let cityName = "London";

    const { data: pref } = await supabase
      .from("user_facts")
      .select("value")
      .eq("user_id", userId)
      .eq("category", "preference")
      .eq("key", "weather_place_id")
      .maybeSingle();

    if (pref) {
      const { data: place } = await supabase
        .from("map_places")
        .select("lat, lng, label")
        .eq("id", pref.value)
        .eq("user_id", userId)
        .maybeSingle();
      if (place) {
        lat = place.lat;
        lon = place.lng;
        cityName = place.label;
      }
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat || 51.5074}&lon=${lon || -0.1278}&appid=${API_KEY}&units=metric`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Weather API error: ${response.status} ${errorText}`);
    }
    const data = await response.json();

    const temp = Math.round(data.main.temp);
    const feelsLike = Math.round(data.main.feels_like);
    const description = data.weather[0].description;
    const humidity = data.main.humidity;
    const windSpeed = Math.round(data.wind.speed * 3.6);

    let narrative = "";

    if (temp >= 28) {
      narrative = "It's a hot day, Sir. ";
    } else if (temp >= 22) {
      narrative = "It's a warm, pleasant day. ";
    } else if (temp >= 15) {
      narrative = "It's a mild, comfortable day. ";
    } else if (temp >= 10) {
      narrative = "It's a cool day – perfect for a walk. ";
    } else if (temp >= 5) {
      narrative = "It's chilly out there, Sir. ";
    } else {
      narrative = "It's cold – better wrap up warm. ";
    }

    const condition = description.toLowerCase();
    if (condition.includes("clear") || condition.includes("sunny")) {
      narrative += "The sky is clear and bright. ";
    } else if (condition.includes("cloud")) {
      narrative += "It's mostly cloudy. ";
    } else if (condition.includes("rain") || condition.includes("drizzle") || condition.includes("shower")) {
      narrative += "There's some rain – you might need an umbrella. ";
    } else if (condition.includes("thunder") || condition.includes("storm")) {
      narrative += "There's a storm brewing – stay safe, Sir. ";
    } else if (condition.includes("snow")) {
      narrative += "It's snowing! Quite a sight. ";
    } else if (condition.includes("fog") || condition.includes("mist")) {
      narrative += "It's foggy – drive carefully. ";
    }

    if (temp >= 15 && temp <= 28 && !condition.includes("rain") && !condition.includes("storm")) {
      narrative += "It's a nice day for a walk or some fresh air.";
    } else if (condition.includes("sunny") && temp > 20 && temp < 30) {
      narrative += "Great weather for outdoor plans.";
    } else if (condition.includes("clear") && temp < 15) {
      narrative += "A light jacket would be a good idea.";
    } else if (condition.includes("rain")) {
      narrative += "Grab an umbrella if you're heading out.";
    } else if (temp > 30) {
      narrative += "Stay hydrated and avoid the midday sun.";
    } else if (temp < 5) {
      narrative += "Wrap up warm if you're going outside.";
    }

    if (!narrative.endsWith(".") && !narrative.endsWith("!")) {
      narrative += ".";
    }

    return {
      temperature: temp,
      feelsLike: feelsLike,
      description: description,
      icon: data.weather[0].icon,
      city: cityName,
      country: data.sys.country,
      humidity: humidity,
      windSpeed: windSpeed,
      narrative: narrative,
    };
  });

// ============================================================
// PORTFOLIO FUNCTIONS
// ============================================================

export const getCashBalance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("cash_balances")
      .select("amount_cents")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data?.amount_cents ?? 0;
  });

export const setCashBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ amount_cents: z.number().int() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("cash_balances")
      .upsert({ user_id: userId, amount_cents: data.amount_cents }, { onConflict: "user_id" });
    if (error) throw error;
    return { ok: true };
  });

export const getHoldings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("stock_holdings")
      .select("*")
      .eq("user_id", userId)
      .order("ticker", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const addTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        type: z.enum(["buy", "sell"]),
        ticker: z.string().min(1).max(10).toUpperCase(),
        shares: z.number().positive(),
        price_per_share: z.number().positive(),
        note: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { type, ticker, shares, price_per_share, note } = data;
    const totalCents = Math.round(shares * price_per_share * 100);

    const { data: cashData } = await supabase
      .from("cash_balances")
      .select("amount_cents")
      .eq("user_id", userId)
      .maybeSingle();
    const currentCash = cashData?.amount_cents ?? 0;
    const newCash = type === "buy" ? currentCash - totalCents : currentCash + totalCents;
    await supabase.from("cash_balances").upsert({ user_id: userId, amount_cents: newCash }, { onConflict: "user_id" });

    const { data: existing } = await supabase
      .from("stock_holdings")
      .select("*")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .maybeSingle();

    if (type === "buy") {
      if (existing) {
        const newShares = existing.shares + shares;
        const newAvgCost = Math.round(
          (existing.shares * existing.avg_cost_cents + shares * price_per_share * 100) / newShares,
        );
        await supabase
          .from("stock_holdings")
          .update({ shares: newShares, avg_cost_cents: newAvgCost })
          .eq("id", existing.id);
      } else {
        await supabase.from("stock_holdings").insert({
          user_id: userId,
          ticker,
          shares,
          avg_cost_cents: Math.round(price_per_share * 100),
        });
      }
    } else {
      if (!existing) throw new Error(`No shares of ${ticker} to sell.`);
      const newShares = existing.shares - shares;
      if (newShares < 0) throw new Error(`You don't have ${shares} shares of ${ticker} to sell.`);
      if (newShares === 0) {
        await supabase.from("stock_holdings").delete().eq("id", existing.id);
      } else {
        await supabase.from("stock_holdings").update({ shares: newShares }).eq("id", existing.id);
      }
    }

    await supabase.from("transactions").insert({
      user_id: userId,
      amount_cents: totalCents,
      category: "investment",
      merchant: ticker,
      note: `${type} ${shares} shares @ $${price_per_share.toFixed(2)}${note ? ` - ${note}` : ""}`,
      source: "manual",
      occurred_at: new Date().toISOString(),
    });

    return { ok: true };
  });

export const updateLastPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ticker: z.string().min(1).max(10).toUpperCase(),
        last_price: z.number().positive(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { ticker, last_price } = data;
    const { error } = await supabase
      .from("stock_holdings")
      .update({ last_price_cents: Math.round(last_price * 100), last_price_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("ticker", ticker);
    if (error) throw error;
    return { ok: true };
  });

// ============================================================
// AI CODE ASSISTANT (used by the editor)
// ============================================================
export const askCodeAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: z.string(),
        prompt: z.string(),
        language: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { model } = await getModelForUser(userId, supabase);
    const systemPrompt = `
You are JARVIS, an expert programmer. The user has asked you to help with code in a code editor.

Current code:
\`\`\`${data.language || "plaintext"}
${data.code}
\`\`\`

User's request: ${data.prompt}

Provide a clear, helpful response. If suggesting code changes, show the full updated code or explain the changes clearly.
`;
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: data.prompt,
    });
    return { response: text };
  });

// ============================================================
// FILE SUMMARIZER – returns raw content (safe, never crashes)
// ============================================================
export const summarizeFileWithGemini = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        fileName: z.string(),
        content: z.string(),
        maxLength: z.number().optional().default(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Return the raw content directly – no AI calls, no errors
    const truncated = data.content.length > 8000 ? data.content.slice(0, 8000) + "\n... (truncated)" : data.content;
    return {
      summary: `📄 **File: ${data.fileName}** (${Math.round(data.content.length / 1024)}KB)\n\n${truncated}`,
    };
  });
// ============================================================
// STOCK ANALYSIS ENGINE (appended to jarvis.functions.ts)
// ============================================================

// ---------- Analytics utilities ----------
export type PricePoint = { t: number; p: number; v: number };

export function sma(arr: number[], n: number): number {
  if (arr.length < n) return arr[arr.length - 1] ?? 0;
  const s = arr.slice(-n).reduce((a, b) => a + b, 0);
  return s / n;
}

export function rsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0,
    losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const ch = prices[i] - prices[i - 1];
    if (ch >= 0) gains += ch;
    else losses -= ch;
  }
  const rs = gains / Math.max(losses, 1e-9);
  return 100 - 100 / (1 + rs);
}

export function macd(prices: number[]): { macd: number; signal: number; hist: number } {
  const ema = (n: number) => {
    const k = 2 / (n + 1);
    let e = prices[0];
    for (let i = 1; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
    return e;
  };
  const m = ema(12) - ema(26);
  const signal = m * 0.9;
  return { macd: m, signal, hist: m - signal };
}

export function stdev(arr: number[]): number {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

export function returns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) r.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  return r;
}

export function atr(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 0;
  const tr: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    tr.push(Math.abs(prices[i] - prices[i - 1]));
  }
  const recent = tr.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function safeCompoundedRate(ret: number, days: number): number {
  if (days <= 0) return 0;
  return Math.log1p(clamp(ret, -0.95, 10)) / days;
}

function trailingReturn(prices: number[], days: number, end = prices.length - 1): number {
  const start = end - Math.round(days);
  if (start < 0 || !prices[start]) return 0;
  return (prices[end] - prices[start]) / prices[start];
}

function setupVector(prices: number[], end: number): number[] | null {
  if (end < 35) return null;
  const window = prices.slice(0, end + 1);
  const last = prices[end];
  const s20 = sma(window, 20) || last;
  const s50 = sma(window, 50) || s20;
  const s200 = sma(window, 200) || s50;
  return [
    trailingReturn(prices, 3, end) * 2.5,
    trailingReturn(prices, 5, end) * 2,
    trailingReturn(prices, 10, end) * 1.35,
    trailingReturn(prices, 20, end),
    ((last - s20) / s20) * 1.4,
    (last - s50) / s50,
    s50 > s200 ? 0.35 : s50 < s200 ? -0.35 : 0,
  ];
}

function analogForecast(prices: number[], horizonDays: number): { expectedReturn: number; sample: number } | null {
  const horizon = Math.max(1, Math.round(horizonDays));
  const current = setupVector(prices, prices.length - 1);
  if (!current || prices.length < horizon + 75) return null;
  const analogs: Array<{ dist: number; ret: number }> = [];
  for (let end = 45; end < prices.length - horizon - 1; end++) {
    const vec = setupVector(prices, end);
    if (!vec) continue;
    let dist = 0;
    for (let i = 0; i < current.length; i++) dist += Math.abs(current[i] - vec[i]);
    const future = (prices[end + horizon] - prices[end]) / prices[end];
    if (Number.isFinite(future)) analogs.push({ dist, ret: future });
  }
  if (analogs.length < 6) return null;
  const nearest = analogs
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.min(18, Math.max(8, Math.floor(analogs.length * 0.08))));
  let weighted = 0,
    total = 0;
  for (const a of nearest) {
    const w = 1 / Math.max(0.025, a.dist);
    weighted += clamp(a.ret, -0.75, 2.5) * w;
    total += w;
  }
  return total ? { expectedReturn: weighted / total, sample: nearest.length } : null;
}

export interface StockPrediction {
  expectedReturn: number;
  targetPrice: number;
  low: number;
  high: number;
  confidence: number;
  direction: "up" | "down" | "flat";
  signals: { rsi: number; macdHist: number; trend: "up" | "down" | "flat"; sma50: number; sma200: number };
}

export function predictStock(
  series: PricePoint[],
  horizonDays: number,
  sensitivity: "conservative" | "balanced" | "aggressive" = "balanced",
): StockPrediction {
  const prices = series.map((s) => s.p);
  const last = prices[prices.length - 1];
  const sma20 = sma(prices, 20);
  const sma50 = sma(prices, 50);
  const sma200 = sma(prices, 200);
  const r = rsi(prices);
  const m = macd(prices);
  const dailyRets = returns(prices);
  const dailyVol = stdev(dailyRets);

  const longLookback = Math.min(252, dailyRets.length);
  const longRets = dailyRets.slice(-longLookback);
  const longMeanDaily = longRets.length ? longRets.reduce((a, b) => a + b, 0) / longRets.length : 0;
  const annualDriftLong = clamp(Math.pow(1 + longMeanDaily, 252) - 1, -0.95, 3);

  const shortLookback = Math.min(5, dailyRets.length);
  const shortRets = dailyRets.slice(-shortLookback);
  const shortMeanDaily = shortRets.length ? shortRets.reduce((a, b) => a + b, 0) / shortRets.length : 0;
  const annualDriftShort = clamp(Math.pow(1 + shortMeanDaily, 252) - 1, -0.98, 8);
  const annualDrift = annualDriftLong * 0.2 + annualDriftShort * 0.8;

  const isShort = horizonDays <= 5;
  const effectiveMomentumDays = isShort ? 3 : 5;
  const effectiveMomentumWeight = isShort ? 1.8 : 1.2;

  const mpDays = Math.min(Math.max(1, effectiveMomentumDays), prices.length - 1);
  const momPast = prices[prices.length - 1 - mpDays];
  const recentReturn = momPast > 0 ? (last - momPast) / momPast : 0;
  const recentDailyRate = safeCompoundedRate(recentReturn, mpDays);
  const momentumProjection = (Math.exp(recentDailyRate * horizonDays) - 1) * effectiveMomentumWeight;

  const lookback = Math.min(5, prices.length - 1);
  const recentHigh = Math.max(...prices.slice(-lookback));
  const recentLow = Math.min(...prices.slice(-lookback));
  const breakoutBonus = ((last - recentHigh) / recentHigh + (recentLow - last) / recentLow) * 0.5;
  const breakoutBoost = breakoutBonus * clamp(1 - horizonDays / 10, 0, 1);

  const trend = sma50 > sma200 ? 1 : sma50 < sma200 ? -1 : 0;
  const momentum = (last - sma20) / sma20;
  const rsiBias = (50 - r) / 100;
  const technical = clamp(trend * 0.5 + momentum * 8 + rsiBias * 0.2 + Math.sign(m.hist) * 0.1, -1, 1);

  const sensMult = sensitivity === "aggressive" ? 1.4 : sensitivity === "conservative" ? 0.6 : 1;
  const signalReturn = technical * 0.75 * sensMult;

  const currentAtr = atr(prices, 14);
  const avgVol = stdev(dailyRets.slice(-252)) || dailyVol;
  const volRatio = avgVol > 0 ? dailyVol / avgVol : 1;
  const volAmplifier = 1 + 0.3 * (volRatio - 1);

  const driftReturn = Math.sign(annualDrift) * (Math.pow(1 + Math.abs(annualDrift), horizonDays / 365) - 1);
  let baseReturn = driftReturn + momentumProjection + breakoutBoost + signalReturn;
  baseReturn = baseReturn * volAmplifier;

  if (horizonDays <= 2 && currentAtr > 0) {
    const atrMove = currentAtr / last;
    const sign = Math.sign(baseReturn) || 1;
    const atrAdjusted = sign * atrMove * 0.8;
    baseReturn = 0.4 * baseReturn + 0.6 * atrAdjusted;
    baseReturn = clamp(baseReturn, -2 * atrMove, 2 * atrMove);
  }

  const expectedReturn = clamp(baseReturn, -0.9, 5);
  const targetPrice = last * (1 + expectedReturn);

  const sigma = dailyVol * Math.sqrt(Math.max(1, horizonDays));
  const atrFactor = horizonDays <= 3 && currentAtr > 0 ? currentAtr / last : sigma;
  const low = last * (1 + expectedReturn - 1.64 * atrFactor);
  const high = last * (1 + expectedReturn + 1.64 * atrFactor);

  const agreement = 1 - Math.abs(technical - 0) / 2;
  const confidence = clamp(0.45 + agreement * 0.3 + (1 - Math.min(atrFactor, 0.5)) * 0.2, 0.3, 0.92);

  return {
    expectedReturn,
    targetPrice,
    low: Math.max(0, low),
    high,
    confidence,
    direction: expectedReturn > 0.005 ? "up" : expectedReturn < -0.005 ? "down" : "flat",
    signals: {
      rsi: r,
      macdHist: m.hist,
      trend: trend > 0 ? "up" : trend < 0 ? "down" : "flat",
      sma50,
      sma200,
    },
  };
}

// ---------- Finnhub server client ----------
const FINNHUB_BASE = "https://finnhub.io/api/v1";

async function fh<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not configured");
  const url = new URL(FINNHUB_BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  url.searchParams.set("token", key);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Finnhub ${path} failed: ${res.status}`);
  return res.json();
}

export async function fetchHistorical(symbol: string): Promise<PricePoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "JARVIS/1.0" } });
  if (!res.ok) throw new Error(`Yahoo chart failed: ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("No data");
  const ts: number[] = result.timestamp;
  const q = result.indicators?.quote?.[0] ?? {};
  const out: PricePoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null || isNaN(c)) continue;
    out.push({ t: ts[i] * 1000, p: c, v: q.volume?.[i] ?? 0 });
  }
  return out;
}

export async function getQuote(symbol: string) {
  const quote = await fh<any>("/quote", { symbol });
  return { price: quote.c, change: quote.d, changePercent: quote.dp, high: quote.h, low: quote.l, open: quote.o };
}

// ---------- Server functions (to be used by chat tools) ----------
export async function analyzeStockTicker(ticker: string) {
  const series = await fetchHistorical(ticker);
  if (series.length < 30) throw new Error("Insufficient data");
  const last = series[series.length - 1].p;
  const pred = predictStock(series, 1, "balanced");
  return {
    symbol: ticker,
    currentPrice: last,
    prediction: pred,
  };
}

export const searchStocks = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ q: z.string() }).parse(data))
  .handler(async ({ data }) => {
    try {
      const res = await fh<any>("/search", { q: data.q });
      const results = (res?.result ?? [])
        .filter((r: any) => r.symbol && !r.symbol.includes("."))
        .slice(0, 8)
        .map((r: any) => ({ symbol: r.symbol, description: r.description, type: r.type }));
      return { ok: true as const, results };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "search failed" };
    }
  });

export const getStockSnapshot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ symbol: z.string() }).parse(data))
  .handler(async ({ data }) => {
    try {
      const symbol = data.symbol.toUpperCase();
      const [quote, profile] = await Promise.all([
        fh<any>("/quote", { symbol }),
        fh<any>("/stock/profile2", { symbol }).catch(() => ({})),
      ]);
      return {
        ok: true as const,
        symbol,
        price: quote.c,
        change: quote.d,
        changePercent: quote.dp,
        high: quote.h,
        low: quote.l,
        open: quote.o,
        prevClose: quote.pc,
        name: profile?.name ?? symbol,
        industry: profile?.finnhubIndustry ?? "—",
        marketCap: profile?.marketCapitalization ? profile.marketCapitalization * 1e6 : null,
        exchange: profile?.exchange ?? "—",
        currency: profile?.currency ?? "USD",
      };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "snapshot failed" };
    }
  });

