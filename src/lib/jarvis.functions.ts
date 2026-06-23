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

/* ---------- Fetch weather for the user's saved location (or London fallback) ---------- */
export const getWeather = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const API_KEY = process.env.OPENWEATHER_API_KEY;
    if (!API_KEY) throw new Error("OpenWeatherMap API key is missing");

    let lat: number | null = null;
    let lon: number | null = null;
    let cityName = "London";

    // 1. Try to get user's saved weather location
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

    // 2. Build the API URL
    let url: string;
    if (lat !== null && lon !== null) {
      url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;
    } else {
      // Fallback to London
      url = `https://api.openweathermap.org/data/2.5/weather?q=London&appid=${API_KEY}&units=metric`;
      cityName = "London";
    }

    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Weather API error: ${response.status} ${errorText}`);
    }
    const data = await response.json();

    const weather = {
      temperature: data.main.temp,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
      city: cityName,
      country: data.sys.country,
      humidity: data.main.humidity,
      windSpeed: data.wind.speed,
      feelsLike: data.main.feels_like,
    };

    return weather;
  });
