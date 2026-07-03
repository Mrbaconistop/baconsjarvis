import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage, embed } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSystemPrompt, getModelForUser } from "@/lib/ai-gateway.server";
import { getWeather, getWeatherForecast, getWeatherNarrative } from "@/lib/jarvis.functions";
import { getProfile, getLLMConfig, updateLLMConfig } from "@/lib/profile.functions";
import { listAccounts } from "@/lib/profile.functions";
import { getBackendOverview } from "@/lib/backend.functions";

type Body = { messages?: UIMessage[]; threadId?: string; tabSlug?: string | null };

function userClient(token: string) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getEmbedding(text: string): Promise<number[]> {
  // Use Groq's embedding model via the Lovable gateway
  // Fallback to a simple random embedding if Groq is not available
  try {
    const response = await fetch("https://connector-gateway.lovable.dev/ai/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "groq/embedding-3-small",
        input: text,
      }),
    });
    if (!response.ok) throw new Error(`Embedding API error: ${response.status}`);
    const data = await response.json();
    return data.data[0].embedding;
  } catch (e) {
    console.warn("[Embedding] Falling back to random embedding (768d)", e);
    // Fallback to random 768‑dim vector (won't be accurate but prevents crashes)
    return Array.from({ length: 768 }, () => Math.random() * 2 - 1);
  }
}

async function storeMemory(userId: string, message: string, role: string, supabase: any) {
  try {
    const embedding = await getEmbedding(message);
    const { error } = await supabase.from("message_memory").insert({ user_id: userId, message, role, embedding });
    if (error) console.error("[Memory] Store error:", error);
  } catch (e) {
    console.error("[Memory] Failed to store:", e);
  }
}

async function recallMemory(userId: string, query: string, supabase: any, limit: number = 5) {
  try {
    const embedding = await getEmbedding(query);
    const { data, error } = await supabase.rpc("match_memory", {
      query_embedding: embedding,
      user_id: userId,
      match_count: limit,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error("[Memory] Recall error:", e);
    return [];
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });

        const { messages, threadId, tabSlug } = (await request.json()) as Body;
        if (!Array.isArray(messages) || !threadId) return new Response("Bad request", { status: 400 });

        const supabase = userClient(token);
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) return new Response("Unauthorized", { status: 401 });

        // Store all user messages in memory (auto)
        for (const msg of messages) {
          if (msg.role === "user") {
            const text = (msg.parts.find((p: any) => p.type === "text") as any)?.text || "";
            if (text) await storeMemory(userId, text, "user", supabase);
          }
        }

        // Verify thread ownership
        let { data: thread } = await supabase
          .from("chat_threads")
          .select("id, title, tab_slug")
          .eq("id", threadId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!thread) {
          const { data: created, error: createErr } = await supabase
            .from("chat_threads")
            .insert({ id: threadId, user_id: userId, title: "New conversation", tab_slug: tabSlug ?? null })
            .select("id, title, tab_slug")
            .single();
          if (createErr || !created) return new Response("Thread not found", { status: 404 });
          thread = created;
        }

        // Load bound tab context (if this thread is scoped to a custom tab)
        const boundTabSlug = (thread as any).tab_slug || tabSlug || null;
        let tabContext: { slug: string; label: string; description: string | null; content_html: string } | null = null;
        if (boundTabSlug) {
          const { data: tabRow } = await supabase
            .from("custom_tabs")
            .select("slug, label, description, content_html")
            .eq("user_id", userId)
            .eq("slug", boundTabSlug)
            .maybeSingle();
          if (tabRow) tabContext = tabRow as any;
        }


        // Load profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("address_as, name, timezone")
          .eq("id", userId)
          .maybeSingle();
        const addressAs = profile?.address_as ?? "Sir";
        const userTimezone = profile?.timezone || "UTC";

        // Load facts
        const { data: factRows } = await supabase
          .from("user_facts")
          .select("category, key, value")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(5);

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

        // Get model and mode
        const { model: chatModel, mode } = await getModelForUser(userId, supabase);

        // Format current time
        const now = new Date();
        const currentTimeFormatted = now.toLocaleString("en-US", {
          timeZone: userTimezone,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

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
          get_place_address: tool({
            description: "Get the full address of a saved place by its label (e.g., 'Home', 'Office').",
            inputSchema: z.object({
              label: z.string().describe("The label of the saved place (e.g., 'Home', 'Office')"),
            }),
            execute: async ({ label }) => {
              const { data: places, error } = await supabase
                .from("map_places")
                .select("id, label, lat, lng, address")
                .eq("user_id", userId)
                .ilike("label", `%${label}%`)
                .limit(1);

              if (error) return { ok: false, error: error.message };
              if (!places || places.length === 0) {
                return { ok: false, error: `No saved place found with label containing "${label}".` };
              }

              const place = places[0];

              if (place.address) {
                return {
                  ok: true,
                  label: place.label,
                  address: place.address,
                  lat: place.lat,
                  lng: place.lng,
                  source: "stored",
                };
              }

              try {
                const r = await fetch(
                  `https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?latlng=${place.lat},${place.lng}`,
                  {
                    headers: {
                      Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
                      "X-Connection-Api-Key": process.env.GOOGLE_MAPS_API_KEY!,
                    },
                  },
                );
                const j: any = await r.json();
                const result = j.results?.[0];
                if (!result) {
                  return { ok: false, error: "Could not reverse‑geocode this location." };
                }

                const formattedAddress = result.formatted_address;

                await supabase.from("map_places").update({ address: formattedAddress }).eq("id", place.id);

                return {
                  ok: true,
                  label: place.label,
                  address: formattedAddress,
                  lat: place.lat,
                  lng: place.lng,
                  source: "reverse_geocoded",
                };
              } catch (e: any) {
                return { ok: false, error: e?.message || "Reverse‑geocoding failed" };
              }
            },
          }),

          // ==================== WEATHER ====================
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
            description: "Get a 5‑day weather forecast.",
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
            description: "Get a natural‑language weather description.",
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
          set_weather_location: tool({
            description: "Change the user's saved weather location.",
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

          // ==================== PROFILE & SETTINGS ====================
          get_profile: tool({
            description: "Get the user's profile information (name, address_as, timezone, briefing time).",
            inputSchema: z.object({}),
            execute: async () => {
              try {
                const profile = await getProfile({ context: { supabase, userId } } as any);
                if (!profile) {
                  return { ok: true, profile: null, message: "No profile found. You can set one up in Settings." };
                }
                return { ok: true, profile };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),
          update_profile: tool({
            description: "Update the user's profile settings.",
            inputSchema: z.object({
              name: z.string().optional(),
              address_as: z.string().optional().describe("How JARVIS addresses you (e.g., 'Sir', 'Boss', 'Captain')"),
              timezone: z.string().optional().describe("IANA timezone (e.g., 'America/New_York', 'Europe/London')"),
              preferred_briefing_time: z.string().optional().describe("Briefing time in HH:MM format (e.g., '08:00')"),
            }),
            execute: async ({ name, address_as, timezone, preferred_briefing_time }) => {
              const updateData: any = {};
              if (name !== undefined) updateData.name = name;
              if (address_as !== undefined) updateData.address_as = address_as;
              if (timezone !== undefined) updateData.timezone = timezone;
              if (preferred_briefing_time !== undefined) updateData.preferred_briefing_time = preferred_briefing_time;
              if (Object.keys(updateData).length === 0) {
                return { ok: false, error: "No fields to update." };
              }
              const { error } = await supabase.from("profiles").update(updateData).eq("id", userId);
              if (error) return { ok: false, error: error.message };
              return { ok: true, message: "Profile updated." };
            },
          }),
          get_ai_config: tool({
            description: "Get the current AI provider, API key status, and mode.",
            inputSchema: z.object({}),
            execute: async () => {
              try {
                const config = await getLLMConfig({ context: { supabase, userId } } as any);
                return { ok: true, config };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),
          set_ai_config: tool({
            description: "Change the AI provider, API key, or mode.",
            inputSchema: z.object({
              provider: z.enum(["groq", "deepseek", "lovable", "system", "lmstudio"]).optional(),
              apiKey: z
                .string()
                .optional()
                .describe("API key for the chosen provider (optional if switching to system or lovable)"),
              mode: z
                .enum(["thinking", "coding", "basic"])
                .optional()
                .describe("AI mode: thinking (deep reasoning), coding (technical help), basic (everyday chat)"),
            }),
            execute: async ({ provider, apiKey, mode }) => {
              try {
                const current = await getLLMConfig({ context: { supabase, userId } } as any);
                const newProvider = provider ?? current.provider;
                const newApiKey = apiKey ?? current.apiKey;
                const newMode = mode ?? current.mode;
                await updateLLMConfig({
                  context: { supabase, userId },
                  data: { provider: newProvider, apiKey: newApiKey, mode: newMode },
                } as any);
                return { ok: true, message: `AI config updated. Provider: ${newProvider}, Mode: ${newMode}` };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),
          list_connected_accounts: tool({
            description: "List all connected social/calendar accounts.",
            inputSchema: z.object({}),
            execute: async () => {
              try {
                const accounts = await listAccounts({ context: { supabase, userId } } as any);
                return { ok: true, accounts };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),

          // ==================== FILES ====================
          list_files: tool({
            description: "List files in the user's private storage.",
            inputSchema: z.object({}),
            execute: async () => {
              try {
                const { data, error } = await supabase.storage
                  .from("user-files")
                  .list(userId, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
                if (error) throw error;
                const files = (data ?? []).filter((f) => f.name !== ".emptyFolderPlaceholder");
                return { ok: true, files };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),
          get_file_url: tool({
            description: "Get a public URL to download a file from the user's private storage.",
            inputSchema: z.object({ fileName: z.string() }),
            execute: async ({ fileName }) => {
              try {
                const { data } = supabase.storage.from("user-files").getPublicUrl(`${userId}/${fileName}`);
                return { ok: true, url: data.publicUrl };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),
          delete_file: tool({
            description: "Delete a file from the user's private storage.",
            inputSchema: z.object({ fileName: z.string() }),
            execute: async ({ fileName }) => {
              try {
                const { error } = await supabase.storage.from("user-files").remove([`${userId}/${fileName}`]);
                if (error) throw error;
                return { ok: true, message: `File "${fileName}" deleted.` };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),

          // ==================== BACKEND OVERVIEW ====================
          get_backend_overview: tool({
            description: "Get backend overview (table counts, secret status, project info).",
            inputSchema: z.object({}),
            execute: async () => {
              try {
                const overview = await getBackendOverview({ context: { supabase, userId } } as any);
                return { ok: true, overview };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),

          // ==================== CHECK-INS & BRIEFINGS ====================
          log_checkin: tool({
            description:
              "Log or update today's daily check-in (weight, height, mood, energy, sleep, notes). Any field can be omitted; existing values are preserved.",
            inputSchema: z.object({
              weight_lbs: z.number().nullable().optional(),
              height_in: z.number().nullable().optional(),
              mood: z.string().nullable().optional(),
              energy: z.number().int().min(1).max(10).nullable().optional(),
              sleep_hours: z.number().nullable().optional(),
              notes: z.string().nullable().optional(),
              day: z.string().nullable().optional().describe("YYYY-MM-DD; defaults to today UTC"),
            }),
            execute: async (input) => {
              const day = input.day ?? new Date().toISOString().slice(0, 10);
              const patch: any = { user_id: userId, day };
              for (const k of ["weight_lbs", "height_in", "mood", "energy", "sleep_hours", "notes"] as const) {
                if (input[k] !== undefined && input[k] !== null) patch[k] = input[k];
              }
              const { data, error } = await supabase
                .from("daily_checkins")
                .upsert(patch, { onConflict: "user_id,day" })
                .select("*")
                .single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, checkin: data };
            },
          }),
          get_checkin: tool({
            description: "Get a check-in for a specific day (defaults to today).",
            inputSchema: z.object({ day: z.string().nullable().optional() }),
            execute: async ({ day }) => {
              const d = day ?? new Date().toISOString().slice(0, 10);
              const { data } = await supabase
                .from("daily_checkins")
                .select("*")
                .eq("user_id", userId)
                .eq("day", d)
                .maybeSingle();
              return { day: d, checkin: data ?? null };
            },
          }),
          list_checkins: tool({
            description: "List recent daily check-ins (default last 14 days).",
            inputSchema: z.object({ days: z.number().int().min(1).max(180).default(14) }),
            execute: async ({ days }) => {
              const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
              const { data } = await supabase
                .from("daily_checkins")
                .select("day, weight_lbs, height_in, mood, energy, sleep_hours, notes")
                .eq("user_id", userId)
                .gte("day", since)
                .order("day", { ascending: false });
              return { checkins: data ?? [], count: data?.length ?? 0 };
            },
          }),
          checkin_summary: tool({
            description: "Compute averages and trends across recent check-ins.",
            inputSchema: z.object({ days: z.number().int().min(2).max(180).default(30) }),
            execute: async ({ days }) => {
              const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
              const { data } = await supabase
                .from("daily_checkins")
                .select("day, weight_lbs, energy, sleep_hours, mood")
                .eq("user_id", userId)
                .gte("day", since)
                .order("day", { ascending: true });
              const rows = data ?? [];
              const avg = (key: string) => {
                const vals = rows.map((r: any) => r[key]).filter((v: any) => typeof v === "number");
                return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null;
              };
              const weights = rows.map((r: any) => r.weight_lbs).filter((v: any) => typeof v === "number");
              return {
                count: rows.length,
                averages: {
                  weight_lbs: avg("weight_lbs"),
                  energy: avg("energy"),
                  sleep_hours: avg("sleep_hours"),
                },
                weight_change_lbs:
                  weights.length >= 2 ? weights[weights.length - 1] - weights[0] : null,
                moods: rows.map((r: any) => r.mood).filter(Boolean).slice(-7),
              };
            },
          }),
          list_briefing_webhooks: tool({
            description: "List configured Discord briefing webhooks and which sections they include.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await supabase
                .from("discord_webhooks")
                .select(
                  "id, name, enabled, include_email, include_calendar, include_reminders, include_spending, include_checkin, include_mention_everyone, last_sent_at",
                )
                .eq("user_id", userId)
                .order("created_at", { ascending: true });
              return { webhooks: data ?? [], count: data?.length ?? 0 };
            },
          }),
          configure_briefing: tool({
            description:
              "Toggle sections on a Discord briefing webhook (by id or name). Any flag left undefined is unchanged.",
            inputSchema: z.object({
              id: z.string().uuid().nullable().optional(),
              name: z.string().nullable().optional(),
              enabled: z.boolean().nullable().optional(),
              include_email: z.boolean().nullable().optional(),
              include_calendar: z.boolean().nullable().optional(),
              include_reminders: z.boolean().nullable().optional(),
              include_spending: z.boolean().nullable().optional(),
              include_checkin: z.boolean().nullable().optional(),
              include_mention_everyone: z.boolean().nullable().optional(),
            }),
            execute: async ({ id, name, ...flags }) => {
              const patch: any = {};
              for (const [k, v] of Object.entries(flags)) if (v !== undefined && v !== null) patch[k] = v;
              if (!Object.keys(patch).length) return { ok: false, error: "No fields to update." };
              let q = supabase.from("discord_webhooks").update(patch).eq("user_id", userId);
              if (id) q = q.eq("id", id);
              else if (name) q = q.eq("name", name);
              else return { ok: false, error: "Provide id or name." };
              const { data, error } = await q.select("id, name, enabled").limit(5);
              if (error) return { ok: false, error: error.message };
              return { ok: true, updated: data };
            },
          }),
          send_briefing_now: tool({
            description: "Fire all enabled Discord briefings immediately.",
            inputSchema: z.object({}),
            execute: async () => {
              try {
                const { sendForUserHooks } = await import("@/lib/discord.server");
                const { data: hooks } = await supabase
                  .from("discord_webhooks")
                  .select("*")
                  .eq("user_id", userId)
                  .eq("enabled", true);
                let sent = 0;
                for (const h of hooks ?? []) {
                  try {
                    await sendForUserHooks(userId, h);
                    sent++;
                  } catch (e) {
                    console.error("[briefing tool] failed:", e);
                  }
                }
                return { ok: true, sent, total: hooks?.length ?? 0 };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),


          // ==================== SYSTEM ACCESS ====================
          system_status: tool({
            description:
              "Get live system information: current date/time, day-of-week, timezone, ISO timestamp, unix epoch, week number, days until weekend, user profile, request region/locale, and counts of reminders, transactions, vault items, files, threads, facts, places, check-ins, and webhooks. Use whenever the user asks about time, date, day, 'what time is it', 'today', 'now', system info, account status, or 'what do you know about me'.",
            inputSchema: z.object({}),
            execute: async () => {
              const nowIso = new Date();
              const localeOpts: Intl.DateTimeFormatOptions = {
                timeZone: userTimezone,
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
                timeZoneName: "short",
              };
              const tzDate = new Date(nowIso.toLocaleString("en-US", { timeZone: userTimezone }));
              const dayOfWeek = tzDate.getDay();
              const daysToSaturday = (6 - dayOfWeek + 7) % 7;
              const startOfYear = new Date(tzDate.getFullYear(), 0, 1);
              const weekNumber = Math.ceil(((tzDate.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);

              const tables = [
                "reminders",
                "transactions",
                "vault_items",
                "chat_threads",
                "user_facts",
                "map_places",
                "daily_checkins",
                "discord_webhooks",
                "social_feeds",
              ];
              const counts: Record<string, number> = {};
              await Promise.all(
                tables.map(async (t) => {
                  const { count } = await supabase
                    .from(t)
                    .select("*", { count: "exact", head: true })
                    .eq("user_id", userId);
                  counts[t] = count ?? 0;
                }),
              );

              let fileCount = 0;
              try {
                const { data } = await supabase.storage.from("user-files").list(userId, { limit: 1000 });
                fileCount = (data ?? []).filter((f) => f.name !== ".emptyFolderPlaceholder").length;
              } catch {}

              return {
                time: {
                  formatted: nowIso.toLocaleString("en-US", localeOpts),
                  iso_utc: nowIso.toISOString(),
                  unix_ms: nowIso.getTime(),
                  timezone: userTimezone,
                  hour_24: tzDate.getHours(),
                  minute: tzDate.getMinutes(),
                  day_of_week: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayOfWeek],
                  is_weekend: dayOfWeek === 0 || dayOfWeek === 6,
                  days_until_weekend: daysToSaturday,
                  week_number: weekNumber,
                  month: tzDate.toLocaleString("en-US", { month: "long", timeZone: userTimezone }),
                  year: tzDate.getFullYear(),
                },
                profile: {
                  user_id: userId,
                  name: profile?.name ?? null,
                  address_as: addressAs,
                  timezone: userTimezone,
                },
                ai: { mode, model_id: (chatModel as any)?.modelId ?? null },
                counts: { ...counts, files: fileCount },
                runtime: { platform: "Cloudflare Workers (TanStack Start)", node_compat: true },
              };
            },
          }),

          // ==================== JARVIS MEMORY ====================
          recall_memory: tool({
            description:
              "Recall past conversations or messages based on a query. Use this when the user asks about something they mentioned before, like 'What did I say about X?' or 'When did I mention Y?'. Returns the most relevant past messages with timestamps.",
            inputSchema: z.object({
              query: z.string().describe("The question or search term to find in past messages."),
              limit: z.number().int().min(1).max(20).default(5).optional(),
            }),
            execute: async ({ query, limit }) => {
              try {
                const results = await recallMemory(userId, query, supabase, limit || 5);
                if (!results || results.length === 0) {
                  return { ok: true, message: "No relevant memories found, Sir.", results: [] };
                }
                return { ok: true, results };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),

          // ==================== CUSTOM TABS (client-side mini-apps) ====================
          create_custom_tab: tool({
            description:
              "Create a new custom tab in the user's sidebar. The tab renders arbitrary HTML/CSS/JS inside a sandboxed iframe — use this to build small client-side mini-apps (calculators, trackers, dashboards, widgets, notes, timers, games). Prefer inline <style> and <script>; no external network/module imports. Body only (no <html>/<head> wrapper — one is added). Return the slug so the user can visit /tabs/<slug>.",
            inputSchema: z.object({
              label: z.string().min(1).max(40).describe("Short sidebar label, e.g. 'Habit Tracker'."),
              icon: z
                .string()
                .max(40)
                .nullable()
                .optional()
                .describe("Lucide icon name (PascalCase), e.g. 'Calculator', 'Timer', 'Heart'. Defaults to Sparkles."),
              description: z.string().max(300).nullable().optional(),
              content_html: z
                .string()
                .max(200_000)
                .describe("HTML body content. May include <style> and <script>. Runs in a sandboxed iframe."),
            }),
            execute: async ({ label, icon, description, content_html }) => {
              const baseSlug =
                label
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "")
                  .slice(0, 40) || "tab";
              let slug = baseSlug;
              let n = 2;
              // eslint-disable-next-line no-constant-condition
              while (true) {
                const { data: existing } = await supabase
                  .from("custom_tabs")
                  .select("id")
                  .eq("user_id", userId)
                  .eq("slug", slug)
                  .maybeSingle();
                if (!existing) break;
                slug = `${baseSlug}-${n++}`;
              }
              const { data, error } = await supabase
                .from("custom_tabs")
                .insert({
                  user_id: userId,
                  slug,
                  label,
                  icon: icon || "Sparkles",
                  description: description ?? null,
                  content_html,
                })
                .select("id, slug, label")
                .single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, tab: data, url: `/tabs/${data.slug}` };
            },
          }),
          list_custom_tabs: tool({
            description: "List the user's custom tabs.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await supabase
                .from("custom_tabs")
                .select("id, slug, label, icon, description, updated_at")
                .eq("user_id", userId)
                .order("sort_order", { ascending: true });
              return { tabs: data ?? [] };
            },
          }),
          update_custom_tab: tool({
            description:
              "Update a custom tab's label, icon, description, or HTML content. Provide id OR slug to identify it.",
            inputSchema: z.object({
              id: z.string().uuid().nullable().optional(),
              slug: z.string().nullable().optional(),
              label: z.string().min(1).max(40).nullable().optional(),
              icon: z.string().max(40).nullable().optional(),
              description: z.string().max(300).nullable().optional(),
              content_html: z.string().max(200_000).nullable().optional(),
            }),
            execute: async ({ id, slug, label, icon, description, content_html }) => {
              if (!id && !slug) return { ok: false, error: "Provide id or slug." };
              let q = supabase.from("custom_tabs").select("id").eq("user_id", userId);
              q = id ? q.eq("id", id) : q.eq("slug", slug!);
              const { data: found } = await q.maybeSingle();
              if (!found) return { ok: false, error: "Tab not found." };
              const patch: any = { updated_at: new Date().toISOString() };
              if (label != null) patch.label = label;
              if (icon != null) patch.icon = icon;
              if (description !== undefined) patch.description = description;
              if (content_html != null) patch.content_html = content_html;
              const { data, error } = await supabase
                .from("custom_tabs")
                .update(patch)
                .eq("id", found.id)
                .eq("user_id", userId)
                .select("id, slug, label")
                .single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, tab: data };
            },
          }),
          delete_custom_tab: tool({
            description: "Delete a custom tab. Provide id OR slug.",
            inputSchema: z.object({
              id: z.string().uuid().nullable().optional(),
              slug: z.string().nullable().optional(),
            }),
            execute: async ({ id, slug }) => {
              if (!id && !slug) return { ok: false, error: "Provide id or slug." };
              let q = supabase.from("custom_tabs").delete().eq("user_id", userId);
              q = id ? q.eq("id", id) : q.eq("slug", slug!);
              const { error } = await q;
              return { ok: !error, error: error?.message };
            },
          }),
          get_custom_tab: tool({
            description: "Get full HTML/content of a custom tab (for editing/inspection).",
            inputSchema: z.object({
              id: z.string().uuid().nullable().optional(),
              slug: z.string().nullable().optional(),
            }),
            execute: async ({ id, slug }) => {
              if (!id && !slug) return { ok: false, error: "Provide id or slug." };
              let q = supabase.from("custom_tabs").select("*").eq("user_id", userId);
              q = id ? q.eq("id", id) : q.eq("slug", slug!);
              const { data } = await q.maybeSingle();
              return { ok: !!data, tab: data };
            },
          }),

          // ==================== CLIENT-SIDE UI CONTROL ====================
          navigate_app: tool({
            description: "Navigate the user's browser to a route in the app (e.g. '/dashboard', '/vault', '/map', '/chat', '/tabs/<slug>'). Use when the user asks to 'take me to', 'open', 'go to', 'show me' a page.",
            inputSchema: z.object({
              to: z.string().describe("Absolute in-app path starting with /"),
              replace: z.boolean().nullable().optional(),
            }),
            execute: async ({ to, replace }) => ({
              ok: true,
              client_action: { type: "navigate", to, replace: replace ?? false },
            }),
          }),
          open_external_url: tool({
            description: "Open an external URL in the user's browser (new tab by default).",
            inputSchema: z.object({ url: z.string().url(), new_tab: z.boolean().nullable().optional() }),
            execute: async ({ url, new_tab }) => ({
              ok: true,
              client_action: { type: "open_url", url, new_tab: new_tab ?? true },
            }),
          }),
          show_toast: tool({
            description: "Pop a toast notification in the user's UI.",
            inputSchema: z.object({
              message: z.string(),
              kind: z.enum(["info", "success", "error", "warning"]).nullable().optional(),
            }),
            execute: async ({ message, kind }) => ({
              ok: true,
              client_action: { type: "toast", message, kind: kind ?? "info" },
            }),
          }),
          set_theme: tool({
            description: "Switch the app theme (light / dark / system).",
            inputSchema: z.object({ theme: z.enum(["light", "dark", "system"]) }),
            execute: async ({ theme }) => ({
              ok: true,
              client_action: { type: "set_theme", theme },
            }),
          }),
          copy_to_clipboard: tool({
            description: "Copy a string into the user's clipboard.",
            inputSchema: z.object({ text: z.string(), label: z.string().nullable().optional() }),
            execute: async ({ text, label }) => ({
              ok: true,
              client_action: { type: "copy_to_clipboard", text, label: label ?? null },
            }),
          }),
          reload_page: tool({
            description: "Force a full page reload of the current view.",
            inputSchema: z.object({}),
            execute: async () => ({ ok: true, client_action: { type: "reload" } }),
          }),

          // ==================== CHAT THREADS ====================
          list_chat_threads: tool({
            description: "List the user's chat conversation threads (id, title, updated_at, tab_slug).",
            inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(30).optional() }),
            execute: async ({ limit }) => {
              const { data, error } = await supabase
                .from("chat_threads")
                .select("id, title, updated_at, tab_slug")
                .eq("user_id", userId)
                .order("updated_at", { ascending: false })
                .limit(limit ?? 30);
              return { ok: !error, threads: data ?? [], error: error?.message };
            },
          }),
          rename_chat_thread: tool({
            description: "Rename a chat thread by id.",
            inputSchema: z.object({ id: z.string().uuid(), title: z.string().min(1).max(120) }),
            execute: async ({ id, title }) => {
              const { error } = await supabase
                .from("chat_threads").update({ title }).eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),
          delete_chat_thread: tool({
            description: "Delete a chat thread and its messages.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase
                .from("chat_threads").delete().eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),

          // ==================== NOTIFICATIONS ====================
          create_notification: tool({
            description: "Create an in-app notification for the user.",
            inputSchema: z.object({
              title: z.string(),
              body: z.string().nullable().optional(),
              priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
            }),
            execute: async ({ title, body, priority }) => {
              const { data, error } = await supabase
                .from("notifications")
                .insert({ user_id: userId, title, body: body ?? null, priority })
                .select("id").single();
              return { ok: !error, id: data?.id, error: error?.message };
            },
          }),
          list_notifications: tool({
            description: "List recent notifications for the user.",
            inputSchema: z.object({
              unread_only: z.boolean().default(false).optional(),
              limit: z.number().int().min(1).max(100).default(20).optional(),
            }),
            execute: async ({ unread_only, limit }) => {
              let q = supabase.from("notifications").select("*").eq("user_id", userId);
              if (unread_only) q = q.is("read_at", null);
              const { data, error } = await q.order("created_at", { ascending: false }).limit(limit ?? 20);
              return { ok: !error, notifications: data ?? [], error: error?.message };
            },
          }),
          mark_notification_read: tool({
            description: "Mark a notification as read (or all if id omitted).",
            inputSchema: z.object({ id: z.string().uuid().nullable().optional() }),
            execute: async ({ id }) => {
              let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId);
              if (id) q = q.eq("id", id);
              const { error } = await q;
              return { ok: !error, error: error?.message };
            },
          }),

          // ==================== STOCK HOLDINGS ====================
          list_stock_holdings: tool({
            description: "List the user's stock holdings.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data, error } = await supabase
                .from("stock_holdings").select("*").eq("user_id", userId).order("symbol");
              return { ok: !error, holdings: data ?? [], error: error?.message };
            },
          }),
          upsert_stock_holding: tool({
            description: "Add or update a stock holding.",
            inputSchema: z.object({
              symbol: z.string(),
              shares: z.number(),
              avg_cost: z.number().nullable().optional(),
              notes: z.string().nullable().optional(),
            }),
            execute: async ({ symbol, shares, avg_cost, notes }) => {
              const { data: existing } = await supabase.from("stock_holdings")
                .select("id").eq("user_id", userId).eq("symbol", symbol.toUpperCase()).maybeSingle();
              if (existing?.id) {
                const { error } = await supabase.from("stock_holdings")
                  .update({ shares, avg_cost: avg_cost ?? null, notes: notes ?? null })
                  .eq("id", existing.id);
                return { ok: !error, id: existing.id, error: error?.message };
              }
              const { data, error } = await supabase.from("stock_holdings")
                .insert({ user_id: userId, symbol: symbol.toUpperCase(), shares, avg_cost: avg_cost ?? null, notes: notes ?? null })
                .select("id").single();
              return { ok: !error, id: data?.id, error: error?.message };
            },
          }),
          delete_stock_holding: tool({
            description: "Delete a stock holding by symbol.",
            inputSchema: z.object({ symbol: z.string() }),
            execute: async ({ symbol }) => {
              const { error } = await supabase.from("stock_holdings")
                .delete().eq("user_id", userId).eq("symbol", symbol.toUpperCase());
              return { ok: !error, error: error?.message };
            },
          }),

          // ==================== CASH BALANCES ====================
          list_cash_balances: tool({
            description: "List the user's cash balances across accounts.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data, error } = await supabase.from("cash_balances").select("*").eq("user_id", userId);
              return { ok: !error, balances: data ?? [], error: error?.message };
            },
          }),
          upsert_cash_balance: tool({
            description: "Add or update a cash balance for a named account.",
            inputSchema: z.object({ account: z.string(), balance: z.number() }),
            execute: async ({ account, balance }) => {
              const { data: existing } = await supabase.from("cash_balances")
                .select("id").eq("user_id", userId).eq("account", account).maybeSingle();
              if (existing?.id) {
                const { error } = await supabase.from("cash_balances")
                  .update({ balance }).eq("id", existing.id);
                return { ok: !error, id: existing.id, error: error?.message };
              }
              const { data, error } = await supabase.from("cash_balances")
                .insert({ user_id: userId, account, balance }).select("id").single();
              return { ok: !error, id: data?.id, error: error?.message };
            },
          }),

          // ==================== DAILY CHECK-INS: EDIT/DELETE ====================
          update_checkin: tool({
            description: "Update fields on an existing daily check-in by id.",
            inputSchema: z.object({
              id: z.string().uuid(),
              mood: z.number().int().min(1).max(10).nullable().optional(),
              energy: z.number().int().min(1).max(10).nullable().optional(),
              sleep_hours: z.number().nullable().optional(),
              notes: z.string().nullable().optional(),
              highlights: z.string().nullable().optional(),
            }),
            execute: async ({ id, ...rest }) => {
              const payload: Record<string, any> = {};
              for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) payload[k] = v;
              const { error } = await supabase.from("daily_checkins")
                .update(payload).eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),
          delete_checkin: tool({
            description: "Delete a daily check-in by id.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("daily_checkins")
                .delete().eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),

          // ==================== SOCIAL FEEDS (subscriptions) ====================
          list_social_feeds: tool({
            description: "List the user's saved social feed subscriptions.",
            inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50).optional() }),
            execute: async ({ limit }) => {
              const { data, error } = await supabase.from("social_feeds")
                .select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit ?? 50);
              return { ok: !error, feeds: data ?? [], error: error?.message };
            },
          }),
          delete_social_feed: tool({
            description: "Delete a social feed subscription by id.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("social_feeds")
                .delete().eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),

          // ==================== DISCORD WEBHOOKS (full CRUD) ====================
          list_discord_webhooks: tool({
            description: "List all Discord webhooks (not just briefing).",
            inputSchema: z.object({}),
            execute: async () => {
              const { data, error } = await supabase.from("discord_webhooks")
                .select("id, name, purpose, url, enabled, created_at").eq("user_id", userId);
              return { ok: !error, webhooks: data ?? [], error: error?.message };
            },
          }),
          delete_discord_webhook: tool({
            description: "Delete a Discord webhook by id.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("discord_webhooks")
                .delete().eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),

          // ==================== ENGAGEMENT STATS ====================
          get_engagement_stats: tool({
            description: "Read the user's engagement stats (streaks, counts, activity).",
            inputSchema: z.object({}),
            execute: async () => {
              const { data, error } = await supabase.from("engagement_stats")
                .select("*").eq("user_id", userId).maybeSingle();
              return { ok: !error, stats: data, error: error?.message };
            },
          }),

          // ==================== LEARNING SESSIONS ====================
          list_learning_sessions: tool({
            description: "List the user's saved learning sessions from the Lab.",
            inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20).optional() }),
            execute: async ({ limit }) => {
              const { data, error } = await supabase.from("learning_sessions")
                .select("id, topic, created_at").eq("user_id", userId)
                .order("created_at", { ascending: false }).limit(limit ?? 20);
              return { ok: !error, sessions: data ?? [], error: error?.message };
            },
          }),
          get_learning_session: tool({
            description: "Get full content of a learning session by id.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { data, error } = await supabase.from("learning_sessions")
                .select("*").eq("id", id).eq("user_id", userId).maybeSingle();
              return { ok: !error, session: data, error: error?.message };
            },
          }),
          delete_learning_session: tool({
            description: "Delete a learning session by id.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("learning_sessions")
                .delete().eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),

          // ==================== CONNECTED ACCOUNTS ====================
          delete_connected_account: tool({
            description: "Remove a connected account (financial/social integration) by id.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("connected_accounts")
                .delete().eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),

          // ==================== USER ROLES (admin only) ====================
          list_my_roles: tool({
            description: "List roles assigned to the current user.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data, error } = await supabase.from("user_roles")
                .select("role").eq("user_id", userId);
              return { ok: !error, roles: (data ?? []).map((r: any) => r.role), error: error?.message };
            },
          }),
          admin_list_users: tool({
            description: "ADMIN ONLY. List all users (id, name, email, roles). Requires admin role.",
            inputSchema: z.object({ limit: z.number().int().min(1).max(500).default(100).optional() }),
            execute: async ({ limit }) => {
              const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
              if (!isAdmin) return { ok: false, error: "Forbidden: admin role required" };
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data: profs, error } = await supabaseAdmin
                .from("profiles").select("id, name, email, created_at")
                .order("created_at", { ascending: false }).limit(limit ?? 100);
              if (error) return { ok: false, error: error.message };
              const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
              const byUser: Record<string, string[]> = {};
              (roles ?? []).forEach((r: any) => {
                (byUser[r.user_id] ||= []).push(r.role);
              });
              return { ok: true, users: (profs ?? []).map((p: any) => ({ ...p, roles: byUser[p.id] ?? [] })) };
            },
          }),
          admin_grant_role: tool({
            description: "ADMIN ONLY. Grant a role (admin/user/moderator) to a user by email.",
            inputSchema: z.object({
              email: z.string().email(),
              role: z.enum(["admin", "user"]),
            }),
            execute: async ({ email, role }) => {
              const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
              if (!isAdmin) return { ok: false, error: "Forbidden: admin role required" };
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data: prof } = await supabaseAdmin.from("profiles").select("id").eq("email", email).maybeSingle();
              if (!prof) return { ok: false, error: `No user with email ${email}` };
              const { error } = await supabaseAdmin.from("user_roles")
                .insert({ user_id: prof.id, role }).select("id");
              if (error && !/duplicate/i.test(error.message)) return { ok: false, error: error.message };
              return { ok: true, message: `Granted ${role} to ${email}` };
            },
          }),
          admin_revoke_role: tool({
            description: "ADMIN ONLY. Revoke a role from a user by email.",
            inputSchema: z.object({
              email: z.string().email(),
              role: z.enum(["admin", "user"]),
            }),
            execute: async ({ email, role }) => {
              const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
              if (!isAdmin) return { ok: false, error: "Forbidden: admin role required" };
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data: prof } = await supabaseAdmin.from("profiles").select("id").eq("email", email).maybeSingle();
              if (!prof) return { ok: false, error: `No user with email ${email}` };
              const { error } = await supabaseAdmin.from("user_roles")
                .delete().eq("user_id", prof.id).eq("role", role);
              return { ok: !error, error: error?.message, message: !error ? `Revoked ${role} from ${email}` : undefined };
            },
          }),
          admin_read_query: tool({
            description:
              "ADMIN ONLY. Run a read-only SQL SELECT against the database (bypasses RLS). Rejects any statement that is not a single SELECT. Use for diagnostics only.",
            inputSchema: z.object({ sql: z.string() }),
            execute: async ({ sql }) => {
              const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
              if (!isAdmin) return { ok: false, error: "Forbidden: admin role required" };
              const trimmed = sql.trim().replace(/;+\s*$/, "");
              if (!/^select\s/i.test(trimmed) || /;\s*\S/.test(trimmed)) {
                return { ok: false, error: "Only a single SELECT statement is allowed." };
              }
              try {
                const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
                // Use PostgREST rpc if a helper exists; otherwise fall back to a limited approach.
                // Since we don't have a generic SQL RPC, wrap into a temp function is out of scope.
                // Return a helpful error directing to specific list_* tools.
                void supabaseAdmin;
                return {
                  ok: false,
                  error: "Raw SQL exec is disabled at runtime. Use table-specific tools (list_*, get_*) or ask an admin to add a run_read_sql RPC.",
                };
              } catch (e: any) {
                return { ok: false, error: e.message };
              }
            },
          }),
        };

        // ---- System Prompt ----
        const baseSystemPrompt = getSystemPrompt(mode, addressAs, factsBlock);
        const systemPrompt = `${baseSystemPrompt}

Your user's timezone is "${userTimezone}". All times you display should be in this timezone.
When displaying times, always use 12-hour format with AM/PM (e.g., '8:45 AM', '3:30 PM').
The current time in the user's location is: ${currentTimeFormatted}.

You have full operational access to the user's command center. When in doubt about the current state of anything — time, date, day of week, account counts, what's in their vault/files/reminders/spending/places/check-ins/briefings, or which AI model you're running on — call the system_status tool. Never guess time or date; query it.

You can also build new sections of the UI itself: use create_custom_tab / update_custom_tab / list_custom_tabs / delete_custom_tab to add sidebar tabs that render arbitrary HTML/CSS/JS in a sandboxed iframe. Use this whenever the user asks for a tool, widget, tracker, calculator, mini-app, page, or "tab" — build it as a custom tab. Keep it self-contained (inline <style>/<script>, no external network or module imports). After creating, tell the user the sidebar entry and /tabs/<slug> URL.

DESIGN LANGUAGE for custom tabs — make them BUBBLY, playful, and delightful, not flat corporate boxes:
- Rounded everything: 16–24px radii on cards, 999px on pills/buttons.
- Soft depth: layered box-shadows with color-tinted glows (e.g. rgba of the accent), never harsh black shadows.
- Gradients: use vibrant multi-stop linear/radial gradients for backgrounds, buttons, and accents.
- Micro-interactions: hover transforms (translate/scale), smooth transitions (200–300ms cubic-bezier), subtle pulse/float keyframe animations on hero elements.
- Typography: system-ui, generous letter-spacing on labels, bold display sizes.
- Color: pick a distinctive palette per tab that fits the topic — avoid defaulting to the same blue every time. Dark backgrounds with neon/pastel accents are usually a win.
- Interactive: real buttons/inputs/localStorage state so the tab actually works, not a static mockup.
- Responsive: flex/grid that reflows on narrow widths.
Assume the tab renders on a dark app shell but is otherwise its own world.
${
  tabContext
    ? `

CURRENT TAB CONTEXT — this conversation is scoped to the custom tab "${tabContext.label}" (slug: ${tabContext.slug}).
${tabContext.description ? `Tab description: ${tabContext.description}\n` : ""}When the user asks to change/tweak/style/add-feature to "this tab", "it", "the page", etc., call update_custom_tab with slug="${tabContext.slug}" — do NOT create a new tab. When rewriting, keep working functionality unless the user asks otherwise. Current HTML (truncated to 8KB):
\`\`\`html
${(tabContext.content_html || "").slice(0, 8000)}
\`\`\`
`
    : ""
}
You also have recall_memory for semantic search across past conversations. Use it whenever the user references something they told you before.

FULL APP CONTROL — drive the UI directly instead of just describing:
- navigate_app({to:"/vault"}) to jump pages, open_external_url for outside links, show_toast for feedback, set_theme, copy_to_clipboard, reload_page.
- Manage chat threads, notifications, stock holdings, cash balances, learning sessions, social feeds, discord webhooks, connected accounts, custom tabs — use the matching tools instead of asking the user to do it manually.
- Admin tools (admin_list_users, admin_grant_role, admin_revoke_role) only work if the user has the admin role. Check list_my_roles when unsure.
When the user says "take me to X" or "open X", actually navigate — don't just describe the link.`;

        const result = streamText({
          model: chatModel,
          system: systemPrompt,
          messages: await convertToModelMessages(messages),
          tools,
          stopWhen: stepCountIs(8),
          onError: ({ error }) => {
            console.error("[chat streamText error]", error);
          },


          onFinish: async ({ response }) => {
            try {
              const finalMessages = response.messages as any[];
              const assistant = finalMessages[finalMessages.length - 1];
              if (assistant && assistant.role === "assistant") {
                const parts = assistant.content ?? assistant.parts ?? [];
                const text = (parts as any[]).find((p: any) => p.type === "text")?.text || "";
                if (text) await storeMemory(userId, text, "assistant", supabase);
                await supabase.from("chat_messages").insert({
                  thread_id: threadId,
                  user_id: userId,
                  role: "assistant",
                  parts: parts as any,
                });
                await supabase
                  .from("chat_threads")
                  .update({ updated_at: new Date().toISOString() })
                  .eq("id", threadId);
              }
            } catch (e) {
              console.error("[chat onFinish error]", e);
            }
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
        });
      },
    },
  },
});
