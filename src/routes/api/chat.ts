import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { JARVIS_SYSTEM_PROMPT, getModelForUser } from "@/lib/ai-gateway.server";

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

        // Verify thread ownership — auto-create with the client-supplied id if missing
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

        // Load profile for address-as
        const { data: profile } = await supabase
          .from("profiles")
          .select("address_as, name")
          .eq("id", userId)
          .maybeSingle();
        const addressAs = profile?.address_as ?? "Sir";

        // Load remembered facts about the user (capped)
        const { data: factRows } = await supabase
          .from("user_facts")
          .select("category, key, value")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(200);
        const factsBlock = (factRows ?? []).length
          ? (factRows ?? []).map((f: any) => `- [${f.category}] ${f.key}: ${f.value}`).join("\n")
          : "(none yet)";

        // Persist the latest user message
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

        // Get the model with user overrides
        const { model: chatModel } = await getModelForUser(userId, supabase);

        const tools = {
          // === REMINDER TOOLS ===
          create_reminder: tool({
            description: "Create a one-off or recurring reminder for the user. Use ISO 8601 for datetime.",
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
            description: "List the user's upcoming reminders (next 30 days).",
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
            description: "Mark a reminder as complete by id.",
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
            description:
              "Search the user's reminders by title, description, or status. Use this when the user asks about their schedule or upcoming tasks.",
            inputSchema: z.object({
              query: z.string().nullable().optional().describe("Search term in title or description."),
              completed: z.boolean().nullable().optional().describe("Filter by completed status."),
              days_ahead: z.number().int().min(1).max(90).default(30).describe("How many days ahead to search."),
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
              if (completed !== undefined && completed !== null) {
                q = q.eq("is_completed", completed);
              }
              const { data } = await q;
              let results = data ?? [];
              if (query) {
                const qLower = query.toLowerCase();
                results = results.filter(
                  (r: any) => r.title?.toLowerCase().includes(qLower) || r.description?.toLowerCase().includes(qLower),
                );
              }
              return {
                reminders: results,
                count: results.length,
                summary: `Found ${results.length} reminder(s)${query ? ` matching "${query}"` : ""}.`,
              };
            },
          }),

          // === VAULT TOOLS ===
          save_vault_item: tool({
            description:
              "Save an item to the user's private vault. Use 'credential' for login info, 'contact' for people, 'note' for free-form notes.",
            inputSchema: z.object({
              kind: z.enum(["credential", "note", "contact"]),
              label: z.string(),
              data: z
                .record(z.string(), z.any())
                .describe(
                  "For credential: {username, password, url}. For contact: {name, email, phone, notes}. For note: {body}.",
                ),
              tags: z
                .array(z.string())
                .default([])
                .describe("Tags for easier searching, e.g., ['banned', 'trident', 'account']."),
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
            description: "List the user's vault items (labels only — never read back credentials by default).",
            inputSchema: z.object({ kind: z.enum(["credential", "note", "contact"]).nullable().optional() }),
            execute: async ({ kind }) => {
              let q = supabase.from("vault_items").select("id, kind, label, tags, updated_at").eq("user_id", userId);
              if (kind) q = q.eq("kind", kind);
              const { data } = await q.order("updated_at", { ascending: false }).limit(50);
              return { items: data ?? [] };
            },
          }),
          unlock_vault_item: tool({
            description:
              "Reveal the contents of a vault item (credentials, account passwords, sensitive notes). REQUIRES a PIN from the user. If the user has not provided a PIN in this turn, ask them for it first (4–28 characters) — do NOT call this without one. Match by id (from list_vault) or by label substring.",
            inputSchema: z.object({
              pin: z.string().min(4).max(28).describe("The PIN the user just typed."),
              id: z.string().uuid().nullable().optional(),
              label: z.string().nullable().optional().describe("Case-insensitive substring match on label."),
            }),
            execute: async ({ pin, id, label }) => {
              const { data: prof } = await supabase
                .from("profiles")
                .select("vault_pin_hash")
                .eq("id", userId)
                .maybeSingle();
              if (!prof?.vault_pin_hash)
                return { ok: false, error: "No PIN set. Ask the user to set one in Settings first." };
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
            description:
              "Search the user's vault items by label, tags, or content. Use this when the user asks for a specific account, credential, note, or contact. Supports partial matches.",
            inputSchema: z.object({
              query: z.string().describe("The search term (e.g., 'Baconator_beams', 'trident', 'banned')."),
              kind: z.enum(["credential", "note", "contact"]).nullable().optional().describe("Filter by kind."),
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

          // === FACT MEMORY TOOLS ===
          remember_fact: tool({
            description:
              "Persist a key fact about the user so you remember it across conversations. Use sparingly for durable info: name, age, height, weight, birthday, location, friends/family names, interests, hobbies, goals, preferences, relationships. Categories: 'identity' (name/age/height/weight/birthday), 'people' (friend/family/coworker names + relationship), 'interest', 'preference', 'goal', 'general'.",
            inputSchema: z.object({
              category: z.enum(["identity", "people", "interest", "preference", "goal", "general"]),
              key: z.string().describe("Short stable key, e.g. 'height', 'best_friend', 'favorite_band'."),
              value: z.string().describe("The fact value, e.g. '6ft 1in', 'Alex (best friend, loves climbing)'."),
            }),
            execute: async ({ category, key, value }) => {
              const { error } = await supabase
                .from("user_facts")
                .upsert({ user_id: userId, category, key, value }, { onConflict: "user_id,category,key" });
              return { ok: !error, error: error?.message };
            },
          }),
          list_facts: tool({
            description: "List facts you've remembered about the user, optionally filtered by category.",
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
            description: "Forget a remembered fact by id (from list_facts) or by category+key.",
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
            description:
              "Search the user's remembered facts. Use this when the user asks about themselves (e.g., 'what do I like?', 'who is my best friend?').",
            inputSchema: z.object({
              query: z.string().nullable().optional().describe("Search term in key or value."),
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
              return {
                facts: results,
                count: results.length,
                summary: `Found ${results.length} fact(s)${query ? ` matching "${query}"` : ""}.`,
              };
            },
          }),

          // === SPENDING / TRANSACTION TOOLS ===
          log_transaction: tool({
            description:
              "Log a spending transaction the user mentioned (Cash App, card, cash, etc.). Use this any time the user says they spent/paid/bought something with an amount.",
            inputSchema: z.object({
              amount: z.number().describe("Dollar amount, e.g. 12.50. Use a negative number for refunds/income."),
              merchant: z.string().nullable().optional().describe("Who they paid, e.g. 'Chipotle', 'Alex'."),
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
              occurred_at: z.string().nullable().optional().describe("ISO datetime; defaults to now"),
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
            description: "List recent transactions, optionally filtered by category or days back.",
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
            description: "Summarize spending totals grouped by category over a window.",
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
            description:
              "Search the user's spending transactions by merchant, category, or note. Use this when the user asks about spending, purchases, or specific transactions.",
            inputSchema: z.object({
              query: z.string().nullable().optional().describe("Search term (merchant, note, or category)."),
              category: z
                .string()
                .nullable()
                .optional()
                .describe(
                  "Filter by category: food, transport, entertainment, bills, shopping, groceries, transfer, income, other.",
                ),
              days: z.number().int().min(1).max(365).default(90).describe("How many days back to search."),
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
                    false ||
                    t.note?.toLowerCase().includes(qLower) ||
                    false ||
                    t.category?.toLowerCase().includes(qLower) ||
                    false,
                );
              }
              return {
                transactions: results,
                total_count: results.length,
                total_spent: results.reduce((sum: number, t: any) => sum + Math.max(t.amount_cents, 0), 0) / 100,
                summary: `Found ${results.length} transaction(s)${query ? ` matching "${query}"` : ""}${category ? ` in category "${category}"` : ""}.`,
              };
            },
          }),
          delete_transaction: tool({
            description: "Delete a transaction by id (use list_transactions to find ids).",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("transactions").delete().eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),

          // === SOCIAL FEED TOOLS ===
          search_social: tool({
            description:
              "Search the user's social feeds for mentions, DMs, or posts by author, content, or platform. Use this when the user asks about what people are saying, mentions, or specific posts.",
            inputSchema: z.object({
              query: z.string().nullable().optional().describe("Search term in author name, handle, or content."),
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
              return {
                results,
                count: results.length,
                summary: `Found ${results.length} social post(s)${query ? ` matching "${query}"` : ""}.`,
              };
            },
          }),

          // === MAP TOOLS ===
          search_places: tool({
            description: "Search Google Places for a place by name or query. Returns up to 5 candidates with coordinates.",
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
            description: "Convert an address or place name into latitude/longitude using Google Geocoding.",
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
            description:
              "Save a location to the user's map. Provide either lat+lng or address (which will be geocoded). Drops a pin live if the Map page is open.",
            inputSchema: z.object({
              label: z.string(),
              address: z.string().nullable().optional(),
              lat: z.number().nullable().optional(),
              lng: z.number().nullable().optional(),
              notes: z.string().nullable().optional(),
              category: z.string().nullable().optional(),
            }),
            execute: async ({ label, address, lat, lng, notes, category }) => {
              let finalLat = lat, finalLng = lng, finalAddr = address ?? null;
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
            description: "List the user's saved map places.",
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
            description: "Delete a saved map place by id.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("map_places").delete().eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),
          show_on_map: tool({
            description:
              "Pan and zoom the live Map page to a coordinate. Requires the user to have the Map page open. Use after geocode_address or search_places.",
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
            description:
              "Get driving/walking/transit directions between two addresses. Returns distance, duration, and draws the route on the live Map page if open.",
            inputSchema: z.object({
              origin: z.string(),
              destination: z.string(),
              mode: z.enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]).default("DRIVE"),
            }),
            execute: async ({ origin, destination, mode }) => {
              const r = await fetch("https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes", {
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
              });
              const j: any = await r.json();
              const route = j.routes?.[0];
              if (!route) return { ok: false, error: j?.error?.message || "no route" };
              const km = (route.distanceMeters / 1000).toFixed(1);
              return {
                ok: true,
                distance_km: Number(km),
                duration: route.duration,
                client_action: { type: "drawRoute", polyline: route.polyline?.encodedPolyline, label: `${origin} → ${destination}` },
              };
            },
          }),
        };

        const now = new Date();
        const result = streamText({
          model: chatModel,
          system: `${JARVIS_SYSTEM_PROMPT}

Address the user as "${addressAs}".
Current time: ${now.toISOString()} (${now.toString()}).
You have tools to create reminders (one-off or recurring: daily/weekdays/weekly/monthly), list and complete reminders, save/list/search private vault items (credentials, notes, contacts), remember/list/search/forget personal facts about the user, log/list/search/summarize spending transactions, and search social feeds.

VAULT SECURITY: list_vault only returns labels — never reveal credentials or sensitive data from it. When the user asks for an account/password/secret content, ALWAYS ask them to type their PIN (4–28 characters) in the next message, then call unlock_vault_item with that pin. Never invent a PIN, never reveal item contents without a successful unlock_vault_item call this turn, and never echo the PIN itself back.

When the user mentions a routine ("every morning", "every weekday at 8am", "remind me daily"), use create_reminder with the recurrence field.

When the user shares an account/login/contact, offer to save it to the vault with relevant tags (e.g., 'banned', 'trident', 'account'). Never echo a stored password back unprompted.

When the user reveals durable personal info (name, age, height, weight, birthday, friends/family names, interests, goals, preferences), silently call remember_fact so you recall it later. Update existing facts with the same category+key instead of creating duplicates. Only forget facts when asked.

MEMORY — MANDATORY: If the user says any of "remember", "don't forget", "note that", "keep in mind", "save this", "make a note", or otherwise explicitly asks you to remember something, you MUST call the remember_fact tool BEFORE replying. Choose the best category ('identity' | 'people' | 'interest' | 'preference' | 'goal' | 'general'), pick a short snake_case key, and store the value verbatim from the user. Then briefly confirm what you saved. Never say "I'll remember that" without actually calling remember_fact in the same turn.

RECALL — MANDATORY: The "Known facts about ${addressAs}" block below is your long-term memory of this user across ALL conversations. Treat every fact in it as something you personally know about ${addressAs}. When ${addressAs} asks about themselves ("what's my name", "how old am I", "what do I like", "who is X to me"), answer from these facts directly — never say you don't know or that you have no memory of past conversations. If a fact truly isn't listed, say so plainly and offer to remember it.

Known facts about ${addressAs} (persisted across every conversation):
${factsBlock}

SEARCH TOOLS — Use these when Sir asks about specific things:
- search_vault: For accounts, credentials, notes (e.g., "Baconator_beams banned on trident")
- search_transactions: For spending history
- search_social: For mentions, DMs, posts
- search_reminders: For upcoming tasks
- search_facts: For personal info about Sir

TOOL DISCIPLINE — STRICT: You may ONLY call the tools explicitly provided to you in this turn (listed in the tools schema). NEVER invent, reference, or attempt to call any other tool such as 'brave_search', 'web_search', 'browser', 'python', 'code_interpreter', or anything else not in your tools list. You have no internet access. If a request needs information you don't have, answer from your own knowledge or ask ${addressAs} for the detail — do not try to call an external tool.

Be concise. Confirm after taking an action. When searching, list all matching results clearly.`,
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
