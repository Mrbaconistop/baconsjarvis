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
// AI CODE ASSISTANT (forced Gemini – ignores user settings)
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

    // Force Gemini: resolve a Gemini model directly
    const { resolveChatModel } = await import("./ai-gateway.server");
    const { model } = resolveChatModel({ provider: "gemini" });

    const systemPrompt = `
You are JARVIS, an expert programmer. The user has asked you to help with code in a code editor.

Current code:
\`\`\`${data.language || "plaintext"}
${data.code}
\`\`\`

User's request: ${data.prompt}

Provide a clear, helpful response. If suggesting code changes, show the full updated code or explain the changes clearly.
`;
    const { generateText } = await import("ai");
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: data.prompt,
    });
    return { response: text };
  });
