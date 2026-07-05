import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { JARVIS_SYSTEM_PROMPT, getModelForUser } from "@/lib/ai-gateway.server";
import { getWeather, getWeatherForecast, getWeatherNarrative } from "@/lib/jarvis.functions";

type Body = { messages?: UIMessage[]; threadId?: string };

function userClient(token: string) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });

        const { messages, threadId } = (await request.json()) as Body;
        if (!Array.isArray(messages) || !threadId) return new Response("Bad request", { status: 400 });

        const supabase = userClient(token);
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) return new Response("Unauthorized", { status: 401 });

        // Verify thread ownership
        let { data: thread } = await supabase
          .from("chat_threads")
          .select("id, title")
          .eq("id", threadId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!thread) {
          const { data: created, error: createErr } = await supabase
            .from("chat_threads")
            .insert({ id: threadId, user_id: userId, title: "New conversation" })
            .select("id, title")
            .single();
          if (createErr || !created) return new Response("Thread not found", { status: 404 });
          thread = created;
        }

        // Load profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("address_as, name")
          .eq("id", userId)
          .maybeSingle();
        const addressAs = profile?.address_as ?? "Sir";

        // Load only 10 most recent facts, truncated
        const { data: factRows } = await supabase
          .from("user_facts")
          .select("category, key, value")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(10);

        const factsBlock = (factRows ?? []).length
          ? (factRows ?? [])
              .map((f: any) => {
                const value = f.value.length > 60 ? f.value.slice(0, 60) + "…" : f.value;
                return `- [${f.category}] ${f.key}: ${value}`;
              })
              .join("\n")
          : "(none yet)";

        // Persist user message
        const last = messages[messages.length - 1];
        if (last?.role === "user") {
          await supabase.from("chat_messages").insert({
            thread_id: threadId,
            user_id: userId,
            role: "user",
            parts: last.parts as any,
          });
          if (thread.title === "New conversation") {
            const text = (last.parts as any[])
              .map((p: any) => (p?.type === "text" ? p.text : ""))
              .join(" ")
              .trim()
              .slice(0, 60);
            if (text) await supabase.from("chat_threads").update({ title: text }).eq("id", threadId);
          }
        }

        // Get the model
        const { model: chatModel } = await getModelForUser(userId, supabase);

        // ---- Tools ----
        const tools = {
          // ==================== REMINDERS ====================
          create_reminder: tool({
            description: "Create a one-off or recurring reminder.",
            inputSchema: z.object({
              title: z.string(),
              datetime_iso: z.string().describe("Absolute ISO 8601 datetime"),
              priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
              recurrence: z.enum(["daily", "weekdays", "weekly", "monthly"]).nullable().optional(),
              description: z.string().nullable().optional(),
            }),
            execute: async ({ title, datetime_iso, priority, recurrence, description }) => {
              const dt = new Date(datetime_iso);
              if (isNaN(dt.getTime())) return { ok: false, error: "Invalid datetime" };
              const { data, error } = await supabase
                .from("reminders")
                .insert({
                  user_id: userId,
                  title,
                  datetime: dt.toISOString(),
                  priority,
                  recurrence: recurrence ?? null,
                  description: description ?? null,
                  source_type: "chat",
                })
                .select("id, title, datetime, recurrence")
                .single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, reminder: data };
            },
          }),
          list_reminders: tool({
            description: "List upcoming reminders (next 30 days).",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await supabase
                .from("reminders")
                .select("id, title, datetime, priority, recurrence, is_completed")
                .eq("user_id", userId)
                .eq("is_completed", false)
                .gte("datetime", new Date().toISOString())
                .order("datetime", { ascending: true })
                .limit(20);
              return { reminders: data ?? [] };
            },
          }),
          complete_reminder: tool({
            description: "Mark a reminder as complete.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase
                .from("reminders")
                .update({ is_completed: true })
                .eq("id", id)
                .eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),
          search_reminders: tool({
            description: "Search reminders by title, description, or status.",
            inputSchema: z.object({
              query: z.string().nullable().optional(),
              completed: z.boolean().nullable().optional(),
              days_ahead: z.number().int().min(1).max(90).default(30),
            }),
            execute: async ({ query, completed, days_ahead }) => {
              const now = new Date().toISOString();
              const future = new Date(Date.now() + days_ahead * 86400000).toISOString();
              let q = supabase
                .from("reminders")
                .select("id, title, description, datetime, priority, is_completed, recurrence, source_type")
                .eq("user_id", userId)
                .gte("datetime", now)
                .lte("datetime", future)
                .order("datetime", { ascending: true })
                .limit(30);
              if (completed !== undefined && completed !== null) q = q.eq("is_completed", completed);
              const { data } = await q;
              let results = data ?? [];
              if (query) {
                const qLower = query.toLowerCase();
                results = results.filter(
                  (r: any) => r.title?.toLowerCase().includes(qLower) || r.description?.toLowerCase().includes(qLower),
                );
              }
              return { reminders: results, count: results.length };
            },
          }),

          // ==================== VAULT ====================
          save_vault_item: tool({
            description: "Save an item to the vault (credential, note, contact).",
            inputSchema: z.object({
              kind: z.enum(["credential", "note", "contact"]),
              label: z.string(),
              data: z.record(z.string(), z.any()),
              tags: z.array(z.string()).default([]),
            }),
            execute: async ({ kind, label, data, tags }) => {
              const { data: row, error } = await supabase
                .from("vault_items")
                .insert({ user_id: userId, kind, label, data, tags })
                .select("id, label, kind")
                .single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, item: row };
            },
          }),
          list_vault: tool({
            description: "List vault items (labels only).",
            inputSchema: z.object({ kind: z.enum(["credential", "note", "contact"]).nullable().optional() }),
            execute: async ({ kind }) => {
              let q = supabase.from("vault_items").select("id, kind, label, tags, updated_at").eq("user_id", userId);
              if (kind) q = q.eq("kind", kind);
              const { data } = await q.order("updated_at", { ascending: false }).limit(50);
              return { items: data ?? [] };
            },
          }),
          unlock_vault_item: tool({
            description: "Reveal vault item contents (requires PIN).",
            inputSchema: z.object({
              pin: z.string().min(4).max(28),
              id: z.string().uuid().nullable().optional(),
              label: z.string().nullable().optional(),
            }),
            execute: async ({ pin, id, label }) => {
              const { data: prof } = await supabase
                .from("profiles")
                .select("vault_pin_hash")
                .eq("id", userId)
                .maybeSingle();
              if (!prof?.vault_pin_hash) return { ok: false, error: "No PIN set." };
              const enc = new TextEncoder().encode(`${userId}:${pin}`);
              const buf = await crypto.subtle.digest("SHA-256", enc);
              const hash = Array.from(new Uint8Array(buf))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
              if (hash !== prof.vault_pin_hash) return { ok: false, error: "Incorrect PIN." };
              let q = supabase
                .from("vault_items")
                .select("id, kind, label, data, tags, updated_at")
                .eq("user_id", userId);
              if (id) q = q.eq("id", id);
              else if (label) q = q.ilike("label", `%${label}%`);
              else return { ok: false, error: "Provide id or label." };
              const { data } = await q.limit(5);
              if (!data?.length) return { ok: false, error: "No matching vault item." };
              return { ok: true, items: data };
            },
          }),
          search_vault: tool({
            description: "Search vault by label, tags, or content.",
            inputSchema: z.object({
              query: z.string(),
              kind: z.enum(["credential", "note", "contact"]).nullable().optional(),
            }),
            execute: async ({ query, kind }) => {
              let q = supabase
                .from("vault_items")
                .select("id, kind, label, data, tags, updated_at")
                .eq("user_id", userId);
              if (kind) q = q.eq("kind", kind);
              const { data } = await q.order("updated_at", { ascending: false }).limit(50);
              const results = (data ?? []).filter((item: any) => {
                const searchStr = (
                  item.label +
                  " " +
                  (item.tags?.join(" ") || "") +
                  " " +
                  JSON.stringify(item.data)
                ).toLowerCase();
                return searchStr.includes(query.toLowerCase());
              });
              return { results, count: results.length };
            },
          }),

          // ==================== MEMORY (FACTS) ====================
          remember_fact: tool({
            description: "Persist a fact about the user.",
            inputSchema: z.object({
              category: z.enum(["identity", "people", "interest", "preference", "goal", "general"]),
              key: z.string(),
              value: z.string(),
            }),
            execute: async ({ category, key, value }) => {
              const { error } = await supabase
                .from("user_facts")
                .upsert({ user_id: userId, category, key, value }, { onConflict: "user_id,category,key" });
              return { ok: !error, error: error?.message };
            },
          }),
          list_facts: tool({
            description: "List remembered facts.",
            inputSchema: z.object({
              category: z
                .enum(["identity", "people", "interest", "preference", "goal", "general"])
                .nullable()
                .optional(),
            }),
            execute: async ({ category }) => {
              let q = supabase.from("user_facts").select("id, category, key, value, updated_at").eq("user_id", userId);
              if (category) q = q.eq("category", category);
              const { data } = await q.order("updated_at", { ascending: false }).limit(100);
              return { facts: data ?? [] };
            },
          }),
          forget_fact: tool({
            description: "Forget a fact by id or category+key.",
            inputSchema: z.object({
              id: z.string().uuid().nullable().optional(),
              category: z.string().nullable().optional(),
              key: z.string().nullable().optional(),
            }),
            execute: async ({ id, category, key }) => {
              let q = supabase.from("user_facts").delete().eq("user_id", userId);
              if (id) q = q.eq("id", id);
              else if (category && key) q = q.eq("category", category).eq("key", key);
              else return { ok: false, error: "Provide id or category+key" };
              const { error } = await q;
              return { ok: !error, error: error?.message };
            },
          }),
          search_facts: tool({
            description: "Search remembered facts.",
            inputSchema: z.object({
              query: z.string().nullable().optional(),
              category: z
                .enum(["identity", "people", "interest", "preference", "goal", "general"])
                .nullable()
                .optional(),
            }),
            execute: async ({ query, category }) => {
              let q = supabase
                .from("user_facts")
                .select("id, category, key, value, updated_at")
                .eq("user_id", userId)
                .order("updated_at", { ascending: false })
                .limit(100);
              if (category) q = q.eq("category", category);
              const { data } = await q;
              let results = data ?? [];
              if (query) {
                const qLower = query.toLowerCase();
                results = results.filter(
                  (f: any) =>
                    f.key?.toLowerCase().includes(qLower) ||
                    f.value?.toLowerCase().includes(qLower) ||
                    f.category?.toLowerCase().includes(qLower),
                );
              }
              return { facts: results, count: results.length };
            },
          }),

          // ==================== SPENDING ====================
          log_transaction: tool({
            description: "Log a spending transaction.",
            inputSchema: z.object({
              amount: z.number(),
              merchant: z.string().nullable().optional(),
              category: z
                .enum([
                  "food",
                  "transport",
                  "entertainment",
                  "bills",
                  "shopping",
                  "groceries",
                  "transfer",
                  "income",
                  "other",
                ])
                .default("other"),
              note: z.string().nullable().optional(),
              source: z.enum(["chat", "manual"]).default("chat"),
              occurred_at: z.string().nullable().optional(),
            }),
            execute: async ({ amount, merchant, category, note, source, occurred_at }) => {
              const cents = Math.round(amount * 100);
              const { data, error } = await supabase
                .from("transactions")
                .insert({
                  user_id: userId,
                  amount_cents: cents,
                  merchant: merchant ?? null,
                  category,
                  note: note ?? null,
                  source,
                  occurred_at: occurred_at ? new Date(occurred_at).toISOString() : new Date().toISOString(),
                })
                .select("id, amount_cents, merchant, category, occurred_at")
                .single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, transaction: data };
            },
          }),
          list_transactions: tool({
            description: "List recent transactions.",
            inputSchema: z.object({
              days: z.number().int().min(1).max(365).default(30),
              category: z.string().nullable().optional(),
              limit: z.number().int().min(1).max(100).default(25),
            }),
            execute: async ({ days, category, limit }) => {
              const since = new Date(Date.now() - days * 86400000).toISOString();
              let q = supabase
                .from("transactions")
                .select("id, amount_cents, merchant, category, note, source, occurred_at")
                .eq("user_id", userId)
                .gte("occurred_at", since)
                .order("occurred_at", { ascending: false })
                .limit(limit);
              if (category) q = q.eq("category", category);
              const { data } = await q;
              return { transactions: data ?? [] };
            },
          }),
          spending_summary: tool({
            description: "Summarize spending by category.",
            inputSchema: z.object({
              window: z.enum(["week", "month", "30d", "90d", "year"]).default("month"),
            }),
            execute: async ({ window }) => {
              const now = new Date();
              const since = new Date(now);
              if (window === "week") since.setDate(now.getDate() - 7);
              else if (window === "month") since.setDate(1);
              else if (window === "30d") since.setDate(now.getDate() - 30);
              else if (window === "90d") since.setDate(now.getDate() - 90);
              else since.setMonth(0, 1);
              const { data } = await supabase
                .from("transactions")
                .select("amount_cents, category")
                .eq("user_id", userId)
                .gte("occurred_at", since.toISOString());
              const totals: Record<string, number> = {};
              let total = 0;
              for (const r of data ?? []) {
                totals[r.category] = (totals[r.category] ?? 0) + r.amount_cents;
                total += r.amount_cents;
              }
              const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
              return {
                window,
                since: since.toISOString(),
                total: fmt(total),
                by_category: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, fmt(v)])),
                count: data?.length ?? 0,
              };
            },
          }),
          search_transactions: tool({
            description: "Search transactions by merchant, category, or note.",
            inputSchema: z.object({
              query: z.string().nullable().optional(),
              category: z.string().nullable().optional(),
              days: z.number().int().min(1).max(365).default(90),
              limit: z.number().int().min(1).max(100).default(25),
            }),
            execute: async ({ query, category, days, limit }) => {
              const since = new Date(Date.now() - days * 86400000).toISOString();
              let q = supabase
                .from("transactions")
                .select("id, amount_cents, merchant, category, note, source, occurred_at")
                .eq("user_id", userId)
                .gte("occurred_at", since)
                .order("occurred_at", { ascending: false })
                .limit(limit);
              if (category) q = q.eq("category", category);
              const { data } = await q;
              let results = data ?? [];
              if (query) {
                const qLower = query.toLowerCase();
                results = results.filter(
                  (t: any) =>
                    t.merchant?.toLowerCase().includes(qLower) ||
                    t.note?.toLowerCase().includes(qLower) ||
                    t.category?.toLowerCase().includes(qLower),
                );
              }
              return {
                transactions: results,
                total_count: results.length,
                total_spent: results.reduce((sum: number, t: any) => sum + Math.max(t.amount_cents, 0), 0) / 100,
              };
            },
          }),
          delete_transaction: tool({
            description: "Delete a transaction by id.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("transactions").delete().eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),

          // ==================== SOCIAL ====================
          search_social: tool({
            description: "Search social feeds.",
            inputSchema: z.object({
              query: z.string().nullable().optional(),
              platform: z.enum(["twitter", "linkedin", "instagram", "facebook"]).nullable().optional(),
              sentiment: z.enum(["positive", "neutral", "negative"]).nullable().optional(),
              days: z.number().int().min(1).max(30).default(14),
              limit: z.number().int().min(1).max(50).default(20),
            }),
            execute: async ({ query, platform, sentiment, days, limit }) => {
              const since = new Date(Date.now() - days * 86400000).toISOString();
              let q = supabase
                .from("social_feeds")
                .select("*")
                .eq("user_id", userId)
                .gte("received_at", since)
                .order("received_at", { ascending: false })
                .limit(limit);
              if (platform) q = q.eq("platform", platform);
              if (sentiment) q = q.eq("sentiment_label", sentiment);
              const { data } = await q;
              let results = data ?? [];
              if (query) {
                const qLower = query.toLowerCase();
                results = results.filter(
                  (f: any) =>
                    f.author_name?.toLowerCase().includes(qLower) ||
                    f.author_handle?.toLowerCase().includes(qLower) ||
                    f.content?.toLowerCase().includes(qLower),
                );
              }
              return { results, count: results.length };
            },
          }),

          // ==================== MAPS ====================
          search_places: tool({
            description: "Search Google Places.",
            inputSchema: z.object({ query: z.string() }),
            execute: async ({ query }) => {
              try {
                const r = await fetch("https://connector-gateway.lovable.dev/google_maps/places/v1/places:searchText", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
                    "X-Connection-Api-Key": process.env.GOOGLE_MAPS_API_KEY!,
                    "Content-Type": "application/json",
                    "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
                  },
                  body: JSON.stringify({ textQuery: query, maxResultCount: 5 }),
                });
                const j: any = await r.json();
                const places = (j.places ?? []).map((p: any) => ({
                  id: p.id,
                  name: p.displayName?.text,
                  address: p.formattedAddress,
                  lat: p.location?.latitude,
                  lng: p.location?.longitude,
                }));
                return { ok: true, places };
              } catch (e: any) {
                return { ok: false, error: e?.message ?? "search failed" };
              }
            },
          }),
          geocode_address: tool({
            description: "Convert address to coordinates.",
            inputSchema: z.object({ address: z.string() }),
            execute: async ({ address }) => {
              const r = await fetch(
                `https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?address=${encodeURIComponent(address)}`,
                {
                  headers: {
                    Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
                    "X-Connection-Api-Key": process.env.GOOGLE_MAPS_API_KEY!,
                  },
                },
              );
              const j: any = await r.json();
              const top = j.results?.[0];
              if (!top) return { ok: false, error: j.status || "no results" };
              return {
                ok: true,
                lat: top.geometry.location.lat,
                lng: top.geometry.location.lng,
                formatted: top.formatted_address,
                place_id: top.place_id,
              };
            },
          }),
          save_place: tool({
            description: "Save a location to the map.",
            inputSchema: z.object({
              label: z.string(),
              address: z.string().nullable().optional(),
              lat: z.number().nullable().optional(),
              lng: z.number().nullable().optional(),
              notes: z.string().nullable().optional(),
              category: z.string().nullable().optional(),
            }),
            execute: async ({ label, address, lat, lng, notes, category }) => {
              let finalLat = lat,
                finalLng = lng,
                finalAddr = address ?? null;
              if ((finalLat == null || finalLng == null) && address) {
                const r = await fetch(
                  `https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?address=${encodeURIComponent(address)}`,
                  {
                    headers: {
                      Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
                      "X-Connection-Api-Key": process.env.GOOGLE_MAPS_API_KEY!,
                    },
                  },
                );
                const j: any = await r.json();
                const top = j.results?.[0];
                if (!top) return { ok: false, error: "Could not geocode that address." };
                finalLat = top.geometry.location.lat;
                finalLng = top.geometry.location.lng;
                finalAddr = top.formatted_address;
              }
              if (finalLat == null || finalLng == null) return { ok: false, error: "Need lat/lng or address." };
              const { data, error } = await supabase
                .from("map_places")
                .insert({
                  user_id: userId,
                  label,
                  address: finalAddr,
                  lat: finalLat,
                  lng: finalLng,
                  notes: notes ?? null,
                  category: category ?? null,
                })
                .select("id, label, lat, lng, address")
                .single();
              if (error) return { ok: false, error: error.message };
              return {
                ok: true,
                place: data,
                client_action: { type: "flyTo", lat: finalLat, lng: finalLng, zoom: 14, label },
              };
            },
          }),
          list_saved_places: tool({
            description: "List saved map places.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await supabase
                .from("map_places")
                .select("id, label, address, lat, lng, category, notes")
                .eq("user_id", userId)
                .order("created_at", { ascending: false })
                .limit(50);
              return { places: data ?? [] };
            },
          }),
          delete_saved_place: tool({
            description: "Delete a saved map place.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("map_places").delete().eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),
          show_on_map: tool({
            description: "Pan and zoom the Map page.",
            inputSchema: z.object({
              lat: z.number(),
              lng: z.number(),
              zoom: z.number().int().min(2).max(20).default(14),
              label: z.string().nullable().optional(),
            }),
            execute: async ({ lat, lng, zoom, label }) => ({
              ok: true,
              client_action: { type: "flyTo", lat, lng, zoom, label: label ?? undefined },
            }),
          }),
          get_directions: tool({
            description: "Get directions between two addresses.",
            inputSchema: z.object({
              origin: z.string(),
              destination: z.string(),
              mode: z.enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]).default("DRIVE"),
            }),
            execute: async ({ origin, destination, mode }) => {
              const r = await fetch(
                "https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
                    "X-Connection-Api-Key": process.env.GOOGLE_MAPS_API_KEY!,
                    "Content-Type": "application/json",
                    "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
                  },
                  body: JSON.stringify({
                    origin: { address: origin },
                    destination: { address: destination },
                    travelMode: mode,
                  }),
                },
              );
              const j: any = await r.json();
              const route = j.routes?.[0];
              if (!route) return { ok: false, error: j?.error?.message || "no route" };
              const km = (route.distanceMeters / 1000).toFixed(1);
              return {
                ok: true,
                distance_km: Number(km),
                duration: route.duration,
                client_action: {
                  type: "drawRoute",
                  polyline: route.polyline?.encodedPolyline,
                  label: `${origin} → ${destination}`,
                },
              };
            },
          }),

          // ==================== WEATHER TOOLS ====================
          get_current_weather: tool({
            description: "Get the current weather for the user's saved location.",
            inputSchema: z.object({}),
            execute: async () => {
              try {
                const weather = await getWeather({ context: { supabase, userId } } as any);
                return { ok: true, weather };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),
          get_weather_forecast: tool({
            description: "Get a 5‑day weather forecast for the user's saved location.",
            inputSchema: z.object({}),
            execute: async () => {
              try {
                const forecast = await getWeatherForecast({ context: { supabase, userId } } as any);
                return { ok: true, forecast };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),
          get_weather_narrative: tool({
            description: "Get a natural‑language weather description (e.g., 'It's a nice cool day to take a walk').",
            inputSchema: z.object({}),
            execute: async () => {
              try {
                const narrative = await getWeatherNarrative({ context: { supabase, userId } } as any);
                return { ok: true, narrative };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),
          // ✅ NEW: Set weather location from chat
          set_weather_location: tool({
            description:
              "Change the user's saved weather location to a saved map place. Use this when the user asks to set their weather location to a specific place (e.g., 'Home', 'London').",
            inputSchema: z.object({
              placeLabel: z.string().describe("The label of the saved place (case-insensitive, partial match allowed)"),
            }),
            execute: async ({ placeLabel }) => {
              const { data: places, error } = await supabase
                .from("map_places")
                .select("id, label")
                .eq("user_id", userId)
                .ilike("label", `%${placeLabel}%`)
                .limit(1);

              if (error) return { ok: false, error: error.message };
              if (!places || places.length === 0) {
                return { ok: false, error: `No saved place found with label containing "${placeLabel}".` };
              }

              const place = places[0];
              const { error: updateError } = await supabase.from("user_facts").upsert(
                {
                  user_id: userId,
                  category: "preference",
                  key: "weather_place_id",
                  value: place.id,
                },
                { onConflict: "user_id,category,key" },
              );

              if (updateError) return { ok: false, error: updateError.message };
              return { ok: true, message: `Weather location set to "${place.label}".` };
            },
          }),
        };

        const now = new Date();
        const result = streamText({
          model: chatModel,
          system: `${JARVIS_SYSTEM_PROMPT}

Address the user as "${addressAs}".
Current time: ${now.toISOString()} (${now.toString()}).
You have tools for reminders, vault, transactions, social search, maps, and facts.

VAULT SECURITY: list_vault only returns labels. When the user asks for secret contents, ask for their PIN first, then call unlock_vault_item.

MEMORY: If the user asks to remember something, call remember_fact.
FACTS BLOCK (most recent, truncated):
${factsBlock}

WEATHER: You have four weather tools:
- get_current_weather: tells current temperature, conditions, etc.
- get_weather_forecast: gives a 5‑day forecast.
- get_weather_narrative: gives a natural‑language description.
- set_weather_location: change the user's saved location to a saved map place (use when the user asks to change the weather location).

When the user asks about weather, pick the appropriate tool. If they ask for a general description, use get_weather_narrative. If they ask for specific numbers (temperature, humidity), use get_current_weather or get_weather_forecast. If they ask to change the location (e.g., "set my weather to Home"), use set_weather_location.

TOOL DISCIPLINE: Only call tools explicitly provided. Do not invent tools.
Be concise. Confirm actions.`,
          messages: await convertToModelMessages(messages),
          tools,
          stopWhen: stepCountIs(8),
          onError: ({ error }) => {
            console.error("[chat streamText error]", error);
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onError: (error: unknown) => {
            console.error("[chat stream response error]", error);
            const e = error as { statusCode?: number; message?: string; responseBody?: string } | null;
            if (e?.statusCode === 402) return "AI credits exhausted, Sir. Please top up to continue.";
            if (e?.statusCode === 429) return "Rate limit reached, Sir. Try again in a moment.";
            const detail = e?.responseBody || e?.message || String(error);
            if (/brave_search|not in request\.tools|tool call validation/i.test(detail)) {
              return "My apologies, Sir — I tripped over a tool I don't actually have. Try that again.";
            }
            return `Signal interrupted, Sir: ${detail.slice(0, 300)}`;
          },
          onFinish: async ({ messages: finalMessages }) => {
            const assistant = finalMessages[finalMessages.length - 1];
            if (assistant && assistant.role === "assistant") {
              await supabase.from("chat_messages").insert({
                thread_id: threadId,
                user_id: userId,
                role: "assistant",
                parts: assistant.parts as any,
              });
              await supabase.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
            }
          },
        });
      },
    },
  },
});
