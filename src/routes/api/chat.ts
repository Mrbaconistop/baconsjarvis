import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  tool,
  stepCountIs,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { getSystemPrompt, getModelForUser } from "@/lib/ai-gateway.server";
import { pickModel as pickRoutedModel, type RouterPrefs } from "@/lib/model-router.server";
import {
  getWeather,
  getWeatherForecast,
  getWeatherNarrative,
  getStockSnapshot,
  searchStocks,
} from "@/lib/jarvis.functions";
import { getProfile, getLLMConfig, updateLLMConfig } from "@/lib/profile.functions";
import { listAccounts } from "@/lib/profile.functions";
import { getBackendOverview } from "@/lib/backend.functions";

type Body = { messages?: UIMessage[]; threadId?: string; tabSlug?: string | null };

function serializeChatError(error: unknown, stage: string, extra: Record<string, unknown> = {}) {
  const e = error as any;
  const cause = e?.cause as any;
  return {
    tag: "JARVIS_CHAT_DEBUG",
    stage,
    name: e?.name ?? e?.constructor?.name ?? "UnknownError",
    message: e?.message ?? String(error),
    code: e?.code,
    statusCode: e?.statusCode ?? e?.status ?? cause?.statusCode ?? cause?.status,
    provider: e?.provider,
    modelId: e?.modelId,
    version: e?.version,
    causeName: cause?.name,
    causeMessage: cause?.message,
    ...extra,
  };
}

function debugChatError(error: unknown, stage: string, extra: Record<string, unknown> = {}) {
  const payload = serializeChatError(error, stage, extra);
  console.error(`[JARVIS_CHAT_DEBUG]\n${JSON.stringify(payload, null, 2)}`, error);
  return payload;
}

function chatErrorResponse(payload: ReturnType<typeof serializeChatError>, originalMessages: UIMessage[]) {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `chat-error-${Date.now()}`;
  const debugText = JSON.stringify(payload, null, 2);
  const message = `Signal interrupted, Sir. Copy this debug block into another AI if you want to troubleshoot it:\n\n\`\`\`json\n${debugText}\n\`\`\``;
  const stream = createUIMessageStream<UIMessage>({
    originalMessages,
    execute: ({ writer }) => {
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: message });
      writer.write({ type: "text-end", id });
    },
    onError: (streamError) => {
      const streamPayload = serializeChatError(streamError, "fallback-stream");
      console.error(`[JARVIS_CHAT_DEBUG]\n${JSON.stringify(streamPayload, null, 2)}`, streamError);
      return streamPayload.message;
    },
  });
  return createUIMessageStreamResponse({ status: 200, stream });
}

function userClient(token: string) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getEmbedding(text: string): Promise<number[]> {
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

function getCacheKey(userId: string, messages: UIMessage[], mode: string, tabSlug?: string | null): string {
  const tail = messages
    .slice(-3)
    .map((m) => {
      const text =
        (m.parts as any[])
          ?.filter((p) => p?.type === "text")
          ?.map((p: any) => p.text)
          .join(" ") ?? "";
      return `${m.role}:${text}`;
    })
    .join("|");
  const raw = `${userId}|${mode}|${tabSlug || "global"}|${tail}`;
  return createHash("sha256").update(raw).digest("hex");
}

async function getCachedResponse(userId: string, cacheKey: string, supabase: any) {
  const { data, error } = await supabase
    .from("chat_cache")
    .select("response_parts")
    .eq("user_id", userId)
    .eq("message_hash", cacheKey)
    .gte("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  return data.response_parts as any[];
}

async function storeCachedResponse(
  userId: string,
  cacheKey: string,
  responseParts: any[],
  threadId: string,
  mode: string,
  tabSlug?: string | null,
  supabase?: any,
) {
  if (!supabase) return;
  const hasTool = (responseParts as any[]).some((p) => typeof p?.type === "string" && p.type.startsWith("tool-"));
  if (hasTool) return;
  const textLen = (responseParts as any[])
    .filter((p) => p?.type === "text")
    .reduce((n: number, p: any) => n + (p.text?.length ?? 0), 0);
  if (textLen < 20) return;
  const expiresAt = new Date(Date.now() + 24 * 3600_000).toISOString();
  await supabase.from("chat_cache").upsert(
    {
      user_id: userId,
      message_hash: cacheKey,
      response_parts: responseParts,
      thread_id: threadId,
      mode,
      expires_at: expiresAt,
    },
    { onConflict: "user_id,message_hash" },
  );
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

        try {
          const supabase = userClient(token);
          const { data: userData } = await supabase.auth.getUser();
          const userId = userData?.user?.id;
          if (!userId) return new Response("Unauthorized", { status: 401 });

          for (const msg of messages) {
            if (msg.role === "user") {
              const text = (msg.parts.find((p: any) => p.type === "text") as any)?.text || "";
              if (text) await storeMemory(userId, text, "user", supabase);
            }
          }

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

          const boundTabSlug = (thread as any).tab_slug || tabSlug || null;
          let tabContext: { slug: string; label: string; description: string | null; content_html: string } | null =
            null;
          if (boundTabSlug) {
            const { data: tabRow } = await supabase
              .from("custom_tabs")
              .select("slug, label, description, content_html")
              .eq("user_id", userId)
              .eq("slug", boundTabSlug)
              .maybeSingle();
            if (tabRow) tabContext = tabRow as any;
          }

          const { data: profile } = await supabase
            .from("profiles")
            .select("address_as, name, timezone")
            .eq("id", userId)
            .maybeSingle();
          const addressAs = profile?.address_as ?? "Sir";
          const userTimezone = profile?.timezone || "UTC";

          const { data: factRows } = await supabase
            .from("user_facts")
            .select("category, key, value")
            .eq("user_id", userId)
            .order("updated_at", { ascending: false })
            .limit(5);

          const rows = factRows ?? [];
          let factsBlock = "(none yet)";
          if (rows.length) {
            factsBlock = rows
              .map((f: any) => {
                const value = f.value.length > 60 ? f.value.slice(0, 60) + "…" : f.value;
                return `- [${f.category}] ${f.key}: ${value}`;
              })
              .join("\n");
          }

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

          const userSelected = await getModelForUser(userId, supabase);
          const { mode, submode } = userSelected;

          // ---- Smart Router (DeepSeek-first, Groq/Gemini fallback) ----
          const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
          const lastUserText =
            ((lastUserMsg?.parts as any[]) ?? []).filter((p: any) => p?.type === "text").map((p: any) => p.text).join(" ") || "";
          const hasImage = ((lastUserMsg?.parts as any[]) ?? []).some((p: any) => p?.type === "image" || p?.type === "file");

          // Load router prefs from user_facts (category='router')
          const { data: routerRows } = await supabase
            .from("user_facts").select("key,value").eq("user_id", userId).eq("category", "router");
          const routerPrefs: RouterPrefs = {};
          for (const r of routerRows ?? []) {
            if (r.key === "prefer_groq_casual") routerPrefs.preferGroqForCasual = r.value === "true";
            if (r.key === "force_provider" && (r.value === "deepseek" || r.value === "groq" || r.value === "gemini")) {
              routerPrefs.forceProvider = r.value;
            }
          }

          // If user explicitly picked a provider in Settings (LLM config), honor it
          const forcedFromUser = (userSelected as any)?.provider;
          let chatModel: any;
          let routedProvider: string;
          let routedModelId: string;
          let routedIntent: string;
          if (forcedFromUser && forcedFromUser !== "system") {
            chatModel = (userSelected as any).model;
            routedProvider = forcedFromUser;
            routedModelId = (userSelected as any).modelId ?? "";
            routedIntent = "user_override";
          } else {
            const routed = pickRoutedModel(lastUserText, hasImage, routerPrefs);
            chatModel = routed.model;
            routedProvider = routed.provider;
            routedModelId = routed.modelId;
            routedIntent = routed.intent;
          }
          console.log(`[ROUTER] provider=${routedProvider} model=${routedModelId} intent=${routedIntent}`);

          // ---- Permanent keyword memory recall (Postgres FTS, $0) ----
          let recallBlock = "";
          let recalledCount = 0;
          if (lastUserText.trim().length >= 3) {
            const { data: recalled } = await supabase.rpc("recall_chat_memory", {
              _user_id: userId,
              _query: lastUserText.slice(0, 500),
              _limit: 5,
            });
            if (recalled?.length) {
              recalledCount = recalled.length;
              recallBlock =
                "\n\n## Relevant memory from past conversations\n" +
                (recalled as any[])
                  .map((m: any) => {
                    const when = new Date(m.created_at).toISOString().slice(0, 10);
                    const snippet = (m.message ?? "").slice(0, 240).replace(/\s+/g, " ").trim();
                    return `- (${when}, ${m.role}) ${snippet}`;
                  })
                  .join("\n");
            }
          }

          // ---- Diagnostics: log the routing decision (best-effort) ----
          void supabase.from("router_traces").insert({
            user_id: userId,
            intent: routedIntent,
            provider: routedProvider,
            model_id: routedModelId,
            has_image: hasImage,
            user_text_snippet: lastUserText.slice(0, 200),
            prefs: routerPrefs as any,
            recalled_count: recalledCount,
            thread_id: threadId ?? null,
          }).then(({ error }: any) => { if (error) console.warn("[router_traces] insert failed", error.message); });

          const cacheKey = getCacheKey(userId, messages, mode, boundTabSlug);
          const cachedParts = await getCachedResponse(userId, cacheKey, supabase);

          if (cachedParts) {
            console.log("✅ [CACHE] HIT – returning cached response for key:", cacheKey);
            const stream = createUIMessageStream<UIMessage>({
              originalMessages: messages,
              execute: ({ writer }) => {
                const id = crypto.randomUUID();
                writer.write({ type: "text-start", id });
                for (const part of cachedParts) {
                  if (part.type === "text") {
                    writer.write({ type: "text-delta", id, delta: part.text });
                  }
                }
                writer.write({ type: "text-end", id });
              },
            });
            return createUIMessageStreamResponse({ status: 200, stream });
          } else {
            console.log("❌ [CACHE] MISS – no cache for key:", cacheKey);
          }

          const now = new Date();
          const currentTimeFormatted = now.toLocaleString("en-US", {
            timeZone: userTimezone,
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });

          // ============================================================
          // TOOLS – Full object with all your original tools,
          // except get_stock_quote, analyze_stock, scan_top_picks
          // (those are removed). Added search_stocks & get_stock_snapshot.
          // ============================================================
          const tools = {
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
                    (r: any) =>
                      r.title?.toLowerCase().includes(qLower) || r.description?.toLowerCase().includes(qLower),
                  );
                }
                return { reminders: results, count: results.length };
              },
            }),
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
                let q = supabase
                  .from("user_facts")
                  .select("id, category, key, value, updated_at")
                  .eq("user_id", userId);
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
            remember_code: tool({
              description: "Store a code snippet with language, description, and tags for future recall.",
              inputSchema: z.object({
                code: z.string().describe("The actual code snippet."),
                language: z.string().describe("Programming language (e.g., 'python', 'javascript', 'roblox-lua')."),
                description: z.string().describe("A short description of what this code does."),
                tags: z.array(z.string()).optional().describe("Optional tags (e.g., ['algorithm', 'debugging'])."),
              }),
              execute: async ({ code, language, description, tags }) => {
                const value = JSON.stringify({ code, language, description, tags });
                const { error } = await supabase.from("user_facts").insert({
                  user_id: userId,
                  category: "code_memory",
                  key: `code_${Date.now()}`,
                  value,
                });
                if (error) return { ok: false, error: error.message };
                return { ok: true, stored: true };
              },
            }),
            create_browser_tab: tool({
              description:
                "Create a new custom tab with a built‑in web browser (address bar, navigation, iframe). Great for browsing documentation, testing websites, or searching.",
              inputSchema: z.object({
                label: z.string().min(1).max(40).describe("Label for the tab (e.g., 'Docs', 'Search')."),
                icon: z.string().max(40).nullable().optional().describe("Lucide icon name (default: 'Globe')."),
                description: z.string().max(300).nullable().optional().describe("Short description."),
                home_url: z.string().url().optional().describe("Home page URL (default: 'https://www.google.com')."),
                show_address_bar: z.boolean().optional().default(true),
                show_nav_buttons: z.boolean().optional().default(true),
                show_reload_button: z.boolean().optional().default(true),
                show_home_button: z.boolean().optional().default(true),
                show_go_button: z.boolean().optional().default(true),
              }),
              execute: async ({
                label,
                icon,
                description,
                home_url,
                show_address_bar,
                show_nav_buttons,
                show_reload_button,
                show_home_button,
                show_go_button,
              }) => {
                const url = home_url || "https://www.google.com";
                const html = buildBrowserTabHTML({
                  homeUrl: url,
                  showAddressBar: show_address_bar ?? true,
                  showNavButtons: show_nav_buttons ?? true,
                  showReloadButton: show_reload_button ?? true,
                  showHomeButton: show_home_button ?? true,
                  showGoButton: show_go_button ?? true,
                });
                const slug =
                  label
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                    .slice(0, 40) || "browser";
                let uniqueSlug = slug;
                let n = 2;
                while (true) {
                  const { data: existing } = await supabase
                    .from("custom_tabs")
                    .select("id")
                    .eq("user_id", userId)
                    .eq("slug", uniqueSlug)
                    .maybeSingle();
                  if (!existing) break;
                  uniqueSlug = `${slug}-${n++}`;
                }
                const { data, error } = await supabase
                  .from("custom_tabs")
                  .insert({
                    user_id: userId,
                    slug: uniqueSlug,
                    label,
                    icon: icon || "Globe",
                    description: description || `Built‑in browser (${url})`,
                    content_html: html,
                    config: { layout: "default", theme: "dark", containerPadding: 0 },
                  })
                  .select("id, slug, label")
                  .single();
                if (error) return { ok: false, error: error.message };
                return { ok: true, tab: data, url: `/tabs/${data.slug}` };
              },
            }),
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
            search_places: tool({
              description: "Search Google Places.",
              inputSchema: z.object({ query: z.string() }),
              execute: async ({ query }) => {
                try {
                  const r = await fetch(
                    "https://connector-gateway.lovable.dev/google_maps/places/v1/places:searchText",
                    {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
                        "X-Connection-Api-Key": process.env.GOOGLE_MAPS_API_KEY!,
                        "Content-Type": "application/json",
                        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
                      },
                      body: JSON.stringify({ textQuery: query, maxResultCount: 5 }),
                    },
                  );
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
                placeLabel: z
                  .string()
                  .describe("The label of the saved place (case-insensitive, partial match allowed)"),
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
                preferred_briefing_time: z
                  .string()
                  .optional()
                  .describe("Briefing time in HH:MM format (e.g., '08:00')"),
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
                  weight_change_lbs: weights.length >= 2 ? weights[weights.length - 1] - weights[0] : null,
                  moods: rows
                    .map((r: any) => r.mood)
                    .filter(Boolean)
                    .slice(-7),
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
                const weekNumber = Math.ceil(
                  ((tzDate.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
                );

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
                    day_of_week: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
                      dayOfWeek
                    ],
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
            recall_memory: tool({
              description:
                "Recall past conversations or messages based on a query. Use this when the user asks about something they mentioned before, like 'What did I say about X?' or 'When did I mention Y?'. Returns the most relevant past messages with timestamps.",
              inputSchema: z.object({
                query: z.string().describe("The question or search term to find in past messages."),
                limit: z.number().int().min(1).max(20).default(5).optional(),
                language: z.string().optional().describe("Filter by programming language (e.g., 'python')."),
              }),
              execute: async ({ query, limit, language }) => {
                try {
                  const results = await recallMemory(userId, query, supabase, limit || 5);
                  let filtered = results;
                  if (language) {
                    filtered = results.filter((r: any) => {
                      if (r.category === "code_memory") {
                        try {
                          const parsed = JSON.parse(r.value);
                          return parsed.language?.toLowerCase() === language.toLowerCase();
                        } catch {
                          return false;
                        }
                      }
                      return false;
                    });
                    if (filtered.length === 0) filtered = results;
                  }
                  return { ok: true, results: filtered };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
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
                  .describe(
                    "Lucide icon name (PascalCase), e.g. 'Calculator', 'Timer', 'Heart'. Defaults to Sparkles.",
                  ),
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
            navigate_app: tool({
              description:
                "Navigate the user's browser to a route in the app (e.g. '/dashboard', '/vault', '/map', '/chat', '/tabs/<slug>'). Use when the user asks to 'take me to', 'open', 'go to', 'show me' a page.",
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
                  .from("chat_threads")
                  .update({ title })
                  .eq("id", id)
                  .eq("user_id", userId);
                return { ok: !error, error: error?.message };
              },
            }),
            delete_chat_thread: tool({
              description: "Delete a chat thread and its messages.",
              inputSchema: z.object({ id: z.string().uuid() }),
              execute: async ({ id }) => {
                const { error } = await supabase.from("chat_threads").delete().eq("id", id).eq("user_id", userId);
                return { ok: !error, error: error?.message };
              },
            }),
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
                  .select("id")
                  .single();
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
                let q = supabase
                  .from("notifications")
                  .update({ read_at: new Date().toISOString() })
                  .eq("user_id", userId);
                if (id) q = q.eq("id", id);
                const { error } = await q;
                return { ok: !error, error: error?.message };
              },
            }),
            list_stock_holdings: tool({
              description: "List the user's stock holdings.",
              inputSchema: z.object({}),
              execute: async () => {
                const { data, error } = await supabase
                  .from("stock_holdings")
                  .select("*")
                  .eq("user_id", userId)
                  .order("symbol");
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
                const { data: existing } = await supabase
                  .from("stock_holdings")
                  .select("id")
                  .eq("user_id", userId)
                  .eq("symbol", symbol.toUpperCase())
                  .maybeSingle();
                if (existing?.id) {
                  const { error } = await supabase
                    .from("stock_holdings")
                    .update({ shares, avg_cost: avg_cost ?? null, notes: notes ?? null })
                    .eq("id", existing.id);
                  return { ok: !error, id: existing.id, error: error?.message };
                }
                const { data, error } = await supabase
                  .from("stock_holdings")
                  .insert({
                    user_id: userId,
                    symbol: symbol.toUpperCase(),
                    shares,
                    avg_cost: avg_cost ?? null,
                    notes: notes ?? null,
                  })
                  .select("id")
                  .single();
                return { ok: !error, id: data?.id, error: error?.message };
              },
            }),
            delete_stock_holding: tool({
              description: "Delete a stock holding by symbol.",
              inputSchema: z.object({ symbol: z.string() }),
              execute: async ({ symbol }) => {
                const { error } = await supabase
                  .from("stock_holdings")
                  .delete()
                  .eq("user_id", userId)
                  .eq("symbol", symbol.toUpperCase());
                return { ok: !error, error: error?.message };
              },
            }),
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
                const { data: existing } = await supabase
                  .from("cash_balances")
                  .select("id")
                  .eq("user_id", userId)
                  .eq("account", account)
                  .maybeSingle();
                if (existing?.id) {
                  const { error } = await supabase.from("cash_balances").update({ balance }).eq("id", existing.id);
                  return { ok: !error, id: existing.id, error: error?.message };
                }
                const { data, error } = await supabase
                  .from("cash_balances")
                  .insert({ user_id: userId, account, balance })
                  .select("id")
                  .single();
                return { ok: !error, id: data?.id, error: error?.message };
              },
            }),
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
                const { error } = await supabase
                  .from("daily_checkins")
                  .update(payload)
                  .eq("id", id)
                  .eq("user_id", userId);
                return { ok: !error, error: error?.message };
              },
            }),
            delete_checkin: tool({
              description: "Delete a daily check-in by id.",
              inputSchema: z.object({ id: z.string().uuid() }),
              execute: async ({ id }) => {
                const { error } = await supabase.from("daily_checkins").delete().eq("id", id).eq("user_id", userId);
                return { ok: !error, error: error?.message };
              },
            }),
            list_social_feeds: tool({
              description: "List the user's saved social feed subscriptions.",
              inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50).optional() }),
              execute: async ({ limit }) => {
                const { data, error } = await supabase
                  .from("social_feeds")
                  .select("*")
                  .eq("user_id", userId)
                  .order("created_at", { ascending: false })
                  .limit(limit ?? 50);
                return { ok: !error, feeds: data ?? [], error: error?.message };
              },
            }),
            delete_social_feed: tool({
              description: "Delete a social feed subscription by id.",
              inputSchema: z.object({ id: z.string().uuid() }),
              execute: async ({ id }) => {
                const { error } = await supabase.from("social_feeds").delete().eq("id", id).eq("user_id", userId);
                return { ok: !error, error: error?.message };
              },
            }),
            list_discord_webhooks: tool({
              description: "List all Discord webhooks (not just briefing).",
              inputSchema: z.object({}),
              execute: async () => {
                const { data, error } = await supabase
                  .from("discord_webhooks")
                  .select("id, name, purpose, url, enabled, created_at")
                  .eq("user_id", userId);
                return { ok: !error, webhooks: data ?? [], error: error?.message };
              },
            }),
            delete_discord_webhook: tool({
              description: "Delete a Discord webhook by id.",
              inputSchema: z.object({ id: z.string().uuid() }),
              execute: async ({ id }) => {
                const { error } = await supabase.from("discord_webhooks").delete().eq("id", id).eq("user_id", userId);
                return { ok: !error, error: error?.message };
              },
            }),
            get_engagement_stats: tool({
              description: "Read the user's engagement stats (streaks, counts, activity).",
              inputSchema: z.object({}),
              execute: async () => {
                const { data, error } = await supabase
                  .from("engagement_stats")
                  .select("*")
                  .eq("user_id", userId)
                  .maybeSingle();
                return { ok: !error, stats: data, error: error?.message };
              },
            }),
            list_learning_sessions: tool({
              description: "List the user's saved learning sessions from the Lab.",
              inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20).optional() }),
              execute: async ({ limit }) => {
                const { data, error } = await supabase
                  .from("learning_sessions")
                  .select("id, topic, created_at")
                  .eq("user_id", userId)
                  .order("created_at", { ascending: false })
                  .limit(limit ?? 20);
                return { ok: !error, sessions: data ?? [], error: error?.message };
              },
            }),
            get_learning_session: tool({
              description: "Get full content of a learning session by id.",
              inputSchema: z.object({ id: z.string().uuid() }),
              execute: async ({ id }) => {
                const { data, error } = await supabase
                  .from("learning_sessions")
                  .select("*")
                  .eq("id", id)
                  .eq("user_id", userId)
                  .maybeSingle();
                return { ok: !error, session: data, error: error?.message };
              },
            }),
            delete_learning_session: tool({
              description: "Delete a learning session by id.",
              inputSchema: z.object({ id: z.string().uuid() }),
              execute: async ({ id }) => {
                const { error } = await supabase.from("learning_sessions").delete().eq("id", id).eq("user_id", userId);
                return { ok: !error, error: error?.message };
              },
            }),
            delete_connected_account: tool({
              description: "Remove a connected account (financial/social integration) by id.",
              inputSchema: z.object({ id: z.string().uuid() }),
              execute: async ({ id }) => {
                const { error } = await supabase.from("connected_accounts").delete().eq("id", id).eq("user_id", userId);
                return { ok: !error, error: error?.message };
              },
            }),
            list_my_roles: tool({
              description: "List roles assigned to the current user.",
              inputSchema: z.object({}),
              execute: async () => {
                const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
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
                  .from("profiles")
                  .select("id, name, email, created_at")
                  .order("created_at", { ascending: false })
                  .limit(limit ?? 100);
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
                const { data: prof } = await supabaseAdmin
                  .from("profiles")
                  .select("id")
                  .eq("email", email)
                  .maybeSingle();
                if (!prof) return { ok: false, error: `No user with email ${email}` };
                const { error } = await supabaseAdmin
                  .from("user_roles")
                  .insert({ user_id: prof.id, role })
                  .select("id");
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
                const { data: prof } = await supabaseAdmin
                  .from("profiles")
                  .select("id")
                  .eq("email", email)
                  .maybeSingle();
                if (!prof) return { ok: false, error: `No user with email ${email}` };
                const { error } = await supabaseAdmin
                  .from("user_roles")
                  .delete()
                  .eq("user_id", prof.id)
                  .eq("role", role);
                return {
                  ok: !error,
                  error: error?.message,
                  message: !error ? `Revoked ${role} from ${email}` : undefined,
                };
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
                  return {
                    ok: false,
                    error:
                      "Raw SQL exec is disabled at runtime. Use table-specific tools (list_*, get_*) or ask an admin to add a run_read_sql RPC.",
                  };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            create_note: tool({
              description:
                "Save a note, journal entry, snippet, or bookmark. Optional url makes it a bookmark; tags for filtering.",
              inputSchema: z.object({
                title: z.string().nullable().optional(),
                body: z.string(),
                tags: z.array(z.string()).nullable().optional(),
                url: z.string().url().nullable().optional(),
              }),
              execute: async ({ title, body, tags, url }) => {
                const { data, error } = await supabase
                  .from("notes")
                  .insert({ user_id: userId, title: title ?? null, body, tags: tags ?? [], url: url ?? null })
                  .select("id")
                  .single();
                return { ok: !error, id: data?.id, error: error?.message };
              },
            }),
            list_notes: tool({
              description: "List notes, optionally filtered by tag or free-text search in title/body.",
              inputSchema: z.object({
                tag: z.string().nullable().optional(),
                search: z.string().nullable().optional(),
                limit: z.number().int().min(1).max(200).default(30).optional(),
              }),
              execute: async ({ tag, search, limit }) => {
                let q = supabase.from("notes").select("id, title, body, tags, url, created_at").eq("user_id", userId);
                if (tag) q = q.contains("tags", [tag]);
                if (search) q = q.or(`title.ilike.%${search}%,body.ilike.%${search}%`);
                const { data, error } = await q.order("created_at", { ascending: false }).limit(limit ?? 30);
                return { ok: !error, notes: data ?? [], error: error?.message };
              },
            }),
            update_note: tool({
              description: "Update a note by id.",
              inputSchema: z.object({
                id: z.string().uuid(),
                title: z.string().nullable().optional(),
                body: z.string().nullable().optional(),
                tags: z.array(z.string()).nullable().optional(),
                url: z.string().url().nullable().optional(),
              }),
              execute: async ({ id, ...rest }) => {
                const patch: Record<string, any> = {};
                for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) patch[k] = v;
                const { error } = await supabase.from("notes").update(patch).eq("id", id).eq("user_id", userId);
                return { ok: !error, error: error?.message };
              },
            }),
            delete_note: tool({
              description: "Delete a note by id.",
              inputSchema: z.object({ id: z.string().uuid() }),
              execute: async ({ id }) => {
                const { error } = await supabase.from("notes").delete().eq("id", id).eq("user_id", userId);
                return { ok: !error, error: error?.message };
              },
            }),
            start_timer: tool({
              description:
                "Start a countdown timer in the user's browser. Pops a toast + chime when done. Use for pomodoros, cook times, break reminders.",
              inputSchema: z.object({
                seconds: z.number().int().min(1).max(86400).describe("Duration in seconds (1s–24h)."),
                label: z.string().nullable().optional(),
                sound: z.boolean().nullable().optional(),
              }),
              execute: async ({ seconds, label, sound }) => ({
                ok: true,
                client_action: { type: "start_timer", seconds, label: label ?? null, sound: sound ?? true },
              }),
            }),
            start_pomodoro: tool({
              description: "Start a 25-minute pomodoro focus session (fires a toast when done).",
              inputSchema: z.object({ minutes: z.number().int().min(1).max(120).default(25).optional() }),
              execute: async ({ minutes }) => {
                const m = minutes ?? 25;
                return {
                  ok: true,
                  client_action: { type: "start_timer", seconds: m * 60, label: `Pomodoro ${m}min`, sound: true },
                };
              },
            }),
            speak_text: tool({
              description: "Speak text aloud through the user's browser TTS.",
              inputSchema: z.object({ text: z.string(), voice: z.string().nullable().optional() }),
              execute: async ({ text, voice }) => ({
                ok: true,
                client_action: { type: "speak", text, voice: voice ?? null },
              }),
            }),
            time_in_timezone: tool({
              description:
                "Get the current wall-clock time in one or more IANA timezones (e.g. 'America/New_York', 'Europe/London', 'Asia/Tokyo').",
              inputSchema: z.object({
                timezones: z.array(z.string()).min(1).max(20),
              }),
              execute: async ({ timezones }) => {
                const now = new Date();
                const out = timezones.map((tz) => {
                  try {
                    const formatted = now.toLocaleString("en-US", {
                      timeZone: tz,
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                      timeZoneName: "short",
                    });
                    return { timezone: tz, formatted, iso: now.toISOString() };
                  } catch (e: any) {
                    return { timezone: tz, error: e.message };
                  }
                });
                return { ok: true, times: out };
              },
            }),
            convert_time_between_timezones: tool({
              description: "Convert a given wall-clock time from one timezone to another.",
              inputSchema: z.object({
                datetime_iso: z
                  .string()
                  .describe("ISO 8601 datetime in the source timezone (with offset) or naive treated as source tz."),
                from_tz: z.string(),
                to_tz: z.string(),
              }),
              execute: async ({ datetime_iso, to_tz }) => {
                try {
                  const d = new Date(datetime_iso);
                  if (isNaN(d.getTime())) return { ok: false, error: "Invalid datetime" };
                  const formatted = d.toLocaleString("en-US", {
                    timeZone: to_tz,
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                    timeZoneName: "short",
                  });
                  return { ok: true, source_iso: d.toISOString(), converted: formatted };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            time_until: tool({
              description: "Compute the human-readable duration between now and a target datetime.",
              inputSchema: z.object({ target_iso: z.string() }),
              execute: async ({ target_iso }) => {
                const t = new Date(target_iso).getTime();
                if (isNaN(t)) return { ok: false, error: "Invalid datetime" };
                const ms = t - Date.now();
                const sign = ms >= 0 ? "in" : "ago";
                const abs = Math.abs(ms);
                const days = Math.floor(abs / 86400000);
                const hours = Math.floor((abs % 86400000) / 3600000);
                const mins = Math.floor((abs % 3600000) / 60000);
                const parts =
                  [days && `${days}d`, hours && `${hours}h`, mins && `${mins}m`].filter(Boolean).join(" ") || "0m";
                return { ok: true, ms, human: `${parts} ${sign}` };
              },
            }),
            list_common_timezones: tool({
              description: "List common IANA timezones with their current offsets.",
              inputSchema: z.object({}),
              execute: async () => {
                const zones = [
                  "UTC",
                  "America/New_York",
                  "America/Chicago",
                  "America/Denver",
                  "America/Los_Angeles",
                  "America/Sao_Paulo",
                  "Europe/London",
                  "Europe/Paris",
                  "Europe/Berlin",
                  "Europe/Moscow",
                  "Africa/Cairo",
                  "Africa/Johannesburg",
                  "Asia/Dubai",
                  "Asia/Kolkata",
                  "Asia/Singapore",
                  "Asia/Shanghai",
                  "Asia/Tokyo",
                  "Asia/Seoul",
                  "Australia/Sydney",
                  "Pacific/Auckland",
                ];
                const now = new Date();
                return {
                  ok: true,
                  zones: zones.map((tz) => ({
                    tz,
                    now: now.toLocaleString("en-US", {
                      timeZone: tz,
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    }),
                  })),
                };
              },
            }),
            schedule_across_zones: tool({
              description: "Show the same absolute moment across multiple timezones — useful for scheduling meetings.",
              inputSchema: z.object({
                datetime_iso: z.string(),
                timezones: z.array(z.string()).min(1).max(20),
              }),
              execute: async ({ datetime_iso, timezones }) => {
                const d = new Date(datetime_iso);
                if (isNaN(d.getTime())) return { ok: false, error: "Invalid datetime" };
                return {
                  ok: true,
                  anchor_iso: d.toISOString(),
                  rows: timezones.map((tz) => ({
                    tz,
                    local: d.toLocaleString("en-US", {
                      timeZone: tz,
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                      timeZoneName: "short",
                    }),
                  })),
                };
              },
            }),
            calculate: tool({
              description:
                "Evaluate a math expression. Supports +-*/%, parentheses, **, Math.* functions. No variables or assignments.",
              inputSchema: z.object({ expression: z.string() }),
              execute: async ({ expression }) => {
                if (
                  !/^[\d\s+\-*/%().,eE^]|Math\.[a-zA-Z]+(?=\()/.test(expression) ||
                  /[;={}\[\]`]/.test(expression) ||
                  /\b(process|require|import|global|window|fetch|eval)\b/.test(expression)
                ) {
                  return { ok: false, error: "Expression contains disallowed characters." };
                }
                const safe = expression.replace(/\^/g, "**");
                try {
                  const val = Function(`"use strict"; return (${safe});`)();
                  if (typeof val !== "number" || !isFinite(val)) return { ok: false, error: "Non-numeric result" };
                  return { ok: true, result: val };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            convert_units: tool({
              description: "Convert between common units (length, mass, volume, temperature, time, data).",
              inputSchema: z.object({
                value: z.number(),
                from: z.string().describe("Unit code, e.g. km, mi, kg, lb, l, gal, c, f, k, s, min, h, mb, gb"),
                to: z.string(),
              }),
              execute: async ({ value, from, to }) => {
                const toMeters: Record<string, number> = {
                  mm: 0.001,
                  cm: 0.01,
                  m: 1,
                  km: 1000,
                  in: 0.0254,
                  ft: 0.3048,
                  yd: 0.9144,
                  mi: 1609.344,
                  nmi: 1852,
                };
                const toGrams: Record<string, number> = {
                  mg: 0.001,
                  g: 1,
                  kg: 1000,
                  oz: 28.3495,
                  lb: 453.592,
                  ton: 1_000_000,
                };
                const toLiters: Record<string, number> = {
                  ml: 0.001,
                  l: 1,
                  cup: 0.2366,
                  pt: 0.4732,
                  qt: 0.9464,
                  gal: 3.7854,
                  floz: 0.02957,
                };
                const toSeconds: Record<string, number> = { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, w: 604800 };
                const toBytes: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
                const F = from.toLowerCase();
                const T = to.toLowerCase();
                function conv(map: Record<string, number>) {
                  return (value * map[F]) / map[T];
                }
                if (F in toMeters && T in toMeters) return { ok: true, result: conv(toMeters), unit: T };
                if (F in toGrams && T in toGrams) return { ok: true, result: conv(toGrams), unit: T };
                if (F in toLiters && T in toLiters) return { ok: true, result: conv(toLiters), unit: T };
                if (F in toSeconds && T in toSeconds) return { ok: true, result: conv(toSeconds), unit: T };
                if (F in toBytes && T in toBytes) return { ok: true, result: conv(toBytes), unit: T };
                const temps = ["c", "f", "k"];
                if (temps.includes(F) && temps.includes(T)) {
                  let c = F === "c" ? value : F === "f" ? ((value - 32) * 5) / 9 : value - 273.15;
                  const out = T === "c" ? c : T === "f" ? (c * 9) / 5 + 32 : c + 273.15;
                  return { ok: true, result: out, unit: T };
                }
                return { ok: false, error: `Cannot convert ${from} → ${to}` };
              },
            }),
            currency_convert: tool({
              description: "Convert an amount between fiat currencies using live rates (exchangerate.host).",
              inputSchema: z.object({ amount: z.number(), from: z.string().length(3), to: z.string().length(3) }),
              execute: async ({ amount, from, to }) => {
                try {
                  const r = await fetch(
                    `https://api.exchangerate.host/convert?from=${from.toUpperCase()}&to=${to.toUpperCase()}&amount=${amount}`,
                  );
                  const j: any = await r.json();
                  if (j?.result == null) return { ok: false, error: "Rate lookup failed" };
                  return { ok: true, result: j.result, rate: j.info?.rate, date: j.date };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            random_pick: tool({
              description: "Pick a random item, roll dice, flip a coin, or pick a random number in a range.",
              inputSchema: z.object({
                choices: z.array(z.string()).nullable().optional(),
                min: z.number().nullable().optional(),
                max: z.number().nullable().optional(),
                dice: z.string().nullable().optional().describe("e.g. '2d6', '1d20'"),
                coin: z.boolean().nullable().optional(),
              }),
              execute: async ({ choices, min, max, dice, coin }) => {
                if (coin) return { ok: true, result: Math.random() < 0.5 ? "Heads" : "Tails" };
                if (dice) {
                  const m = /^(\d+)d(\d+)$/i.exec(dice.trim());
                  if (!m) return { ok: false, error: "Format: NdM (e.g. 2d6)" };
                  const n = +m[1],
                    s = +m[2];
                  if (n < 1 || n > 100 || s < 2 || s > 1000) return { ok: false, error: "Out of range" };
                  const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * s));
                  return { ok: true, rolls, total: rolls.reduce((a, b) => a + b, 0) };
                }
                if (choices?.length) return { ok: true, result: choices[Math.floor(Math.random() * choices.length)] };
                if (min != null && max != null)
                  return { ok: true, result: min + Math.floor(Math.random() * (max - min + 1)) };
                return { ok: false, error: "Provide choices, dice, coin, or min+max" };
              },
            }),
            text_stats: tool({
              description: "Count words, characters, lines, reading time for a block of text.",
              inputSchema: z.object({ text: z.string() }),
              execute: async ({ text }) => {
                const words = text.trim().split(/\s+/).filter(Boolean).length;
                const chars = text.length;
                const charsNoSpaces = text.replace(/\s/g, "").length;
                const lines = text.split(/\r?\n/).length;
                const readingMinutes = Math.max(1, Math.round(words / 220));
                return {
                  ok: true,
                  words,
                  chars,
                  chars_no_spaces: charsNoSpaces,
                  lines,
                  reading_minutes: readingMinutes,
                };
              },
            }),
            base64_encode: tool({
              description: "Base64 encode text.",
              inputSchema: z.object({ text: z.string() }),
              execute: async ({ text }) => ({ ok: true, result: Buffer.from(text, "utf8").toString("base64") }),
            }),
            base64_decode: tool({
              description: "Base64 decode text.",
              inputSchema: z.object({ text: z.string() }),
              execute: async ({ text }) => {
                try {
                  return { ok: true, result: Buffer.from(text, "base64").toString("utf8") };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            url_encode: tool({
              description: "URL-encode a string.",
              inputSchema: z.object({ text: z.string() }),
              execute: async ({ text }) => ({ ok: true, result: encodeURIComponent(text) }),
            }),
            url_decode: tool({
              description: "URL-decode a string.",
              inputSchema: z.object({ text: z.string() }),
              execute: async ({ text }) => {
                try {
                  return { ok: true, result: decodeURIComponent(text) };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            hash_text: tool({
              description: "Compute a cryptographic hash of text (md5, sha1, sha256, sha512).",
              inputSchema: z.object({
                text: z.string(),
                algorithm: z.enum(["md5", "sha1", "sha256", "sha512"]).default("sha256"),
              }),
              execute: async ({ text, algorithm }) => {
                const { createHash } = await import("crypto");
                return { ok: true, result: createHash(algorithm).update(text).digest("hex") };
              },
            }),
            slugify: tool({
              description: "Convert text to a URL-safe slug.",
              inputSchema: z.object({ text: z.string() }),
              execute: async ({ text }) => ({
                ok: true,
                result: text
                  .toLowerCase()
                  .normalize("NFKD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, ""),
              }),
            }),
            format_json: tool({
              description: "Pretty-print or minify a JSON string.",
              inputSchema: z.object({ json: z.string(), minify: z.boolean().default(false).optional() }),
              execute: async ({ json, minify }) => {
                try {
                  const obj = JSON.parse(json);
                  return { ok: true, result: JSON.stringify(obj, null, minify ? 0 : 2) };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            decode_jwt: tool({
              description: "Decode a JWT (header + payload). Does NOT verify signature.",
              inputSchema: z.object({ jwt: z.string() }),
              execute: async ({ jwt }) => {
                const parts = jwt.split(".");
                if (parts.length !== 3) return { ok: false, error: "Not a JWT" };
                try {
                  const dec = (s: string) =>
                    JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
                  return { ok: true, header: dec(parts[0]), payload: dec(parts[1]) };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            regex_test: tool({
              description: "Test a regex against a string; returns all matches with groups.",
              inputSchema: z.object({
                pattern: z.string(),
                flags: z.string().default("g").optional(),
                text: z.string(),
              }),
              execute: async ({ pattern, flags, text }) => {
                try {
                  const re = new RegExp(pattern, (flags ?? "g").includes("g") ? flags : (flags ?? "g") + "g");
                  const matches = [...text.matchAll(re)].map((m) => ({
                    match: m[0],
                    groups: m.slice(1),
                    index: m.index,
                  }));
                  return { ok: true, count: matches.length, matches };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            uuid_generate: tool({
              description: "Generate one or more random UUIDs v4.",
              inputSchema: z.object({ count: z.number().int().min(1).max(50).default(1).optional() }),
              execute: async ({ count }) => {
                const { randomUUID } = await import("crypto");
                return { ok: true, ids: Array.from({ length: count ?? 1 }, () => randomUUID()) };
              },
            }),
            password_generate: tool({
              description: "Generate a strong random password.",
              inputSchema: z.object({
                length: z.number().int().min(6).max(128).default(20).optional(),
                symbols: z.boolean().default(true).optional(),
              }),
              execute: async ({ length, symbols }) => {
                const alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                const sym = "!@#$%^&*()-_=+[]{};:,.?/";
                const pool = alpha + (symbols !== false ? sym : "");
                const { randomBytes } = await import("crypto");
                const bytes = randomBytes(length ?? 20);
                const pw = Array.from(bytes, (b) => pool[b % pool.length]).join("");
                return { ok: true, password: pw };
              },
            }),
            color_convert: tool({
              description: "Convert between color formats (hex ↔ rgb ↔ hsl).",
              inputSchema: z.object({ color: z.string().describe("e.g. '#ff8800' or 'rgb(255,136,0)'") }),
              execute: async ({ color }) => {
                const c = color.trim();
                let r = 0,
                  g = 0,
                  b = 0;
                const hex = c.match(/^#?([\da-f]{6}|[\da-f]{3})$/i);
                const rgb = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
                if (hex) {
                  let h = hex[1];
                  if (h.length === 3)
                    h = h
                      .split("")
                      .map((x) => x + x)
                      .join("");
                  r = parseInt(h.slice(0, 2), 16);
                  g = parseInt(h.slice(2, 4), 16);
                  b = parseInt(h.slice(4, 6), 16);
                } else if (rgb) {
                  r = +rgb[1];
                  g = +rgb[2];
                  b = +rgb[3];
                } else return { ok: false, error: "Unrecognized color format" };
                const toHex = (n: number) => n.toString(16).padStart(2, "0");
                const rn = r / 255,
                  gn = g / 255,
                  bn = b / 255;
                const max = Math.max(rn, gn, bn),
                  min = Math.min(rn, gn, bn);
                let h = 0,
                  s = 0;
                const l = (max + min) / 2;
                if (max !== min) {
                  const d = max - min;
                  s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                  h =
                    max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
                  h /= 6;
                }
                return {
                  ok: true,
                  hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`,
                  rgb: `rgb(${r}, ${g}, ${b})`,
                  hsl: `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`,
                };
              },
            }),
            diff_text: tool({
              description: "Line-by-line diff between two strings.",
              inputSchema: z.object({ a: z.string(), b: z.string() }),
              execute: async ({ a, b }) => {
                const la = a.split("\n"),
                  lb = b.split("\n");
                const out: Array<{ line: number; kind: "same" | "add" | "remove"; text: string }> = [];
                const max = Math.max(la.length, lb.length);
                for (let i = 0; i < max; i++) {
                  if (la[i] === lb[i]) out.push({ line: i + 1, kind: "same", text: la[i] ?? "" });
                  else {
                    if (la[i] !== undefined) out.push({ line: i + 1, kind: "remove", text: la[i] });
                    if (lb[i] !== undefined) out.push({ line: i + 1, kind: "add", text: lb[i] });
                  }
                }
                return { ok: true, diff: out };
              },
            }),
            lorem_ipsum: tool({
              description: "Generate lorem ipsum placeholder text.",
              inputSchema: z.object({
                paragraphs: z.number().int().min(1).max(20).default(3).optional(),
                sentences_per: z.number().int().min(1).max(20).default(5).optional(),
              }),
              execute: async ({ paragraphs, sentences_per }) => {
                const words =
                  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat".split(
                    " ",
                  );
                const sentence = () => {
                  const len = 6 + Math.floor(Math.random() * 12);
                  const s = Array.from({ length: len }, () => words[Math.floor(Math.random() * words.length)]).join(
                    " ",
                  );
                  return s[0].toUpperCase() + s.slice(1) + ".";
                };
                const paras = Array.from({ length: paragraphs ?? 3 }, () =>
                  Array.from({ length: sentences_per ?? 5 }, sentence).join(" "),
                );
                return { ok: true, text: paras.join("\n\n") };
              },
            }),
            http_get: tool({
              description:
                "Fetch a public URL and return the response body (truncated to 8KB). Use for API JSON, RSS, plain-text pages. No auth headers.",
              inputSchema: z.object({ url: z.string().url() }),
              execute: async ({ url }) => {
                try {
                  const controller = new AbortController();
                  const t = setTimeout(() => controller.abort(), 8000);
                  const r = await fetch(url, { signal: controller.signal });
                  clearTimeout(t);
                  const ct = r.headers.get("content-type") ?? "";
                  const text = (await r.text()).slice(0, 8192);
                  return { ok: r.ok, status: r.status, content_type: ct, body: text };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            define_word: tool({
              description: "Look up an English word's definition (dictionaryapi.dev).",
              inputSchema: z.object({ word: z.string() }),
              execute: async ({ word }) => {
                try {
                  const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
                  if (!r.ok) return { ok: false, error: `Not found` };
                  const j: any = await r.json();
                  const entry = j?.[0];
                  const meanings = (entry?.meanings ?? []).map((m: any) => ({
                    part_of_speech: m.partOfSpeech,
                    definitions: m.definitions.slice(0, 3).map((d: any) => d.definition),
                  }));
                  return { ok: true, word: entry?.word, phonetic: entry?.phonetic, meanings };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            wikipedia_summary: tool({
              description: "Fetch a Wikipedia article summary by title.",
              inputSchema: z.object({ title: z.string() }),
              execute: async ({ title }) => {
                try {
                  const r = await fetch(
                    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
                  );
                  if (!r.ok) return { ok: false, error: `Not found` };
                  const j: any = await r.json();
                  return { ok: true, title: j.title, extract: j.extract, url: j.content_urls?.desktop?.page };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            get_public_ip_info: tool({
              description: "Get the server's public IP geolocation (approximate — not the user's device).",
              inputSchema: z.object({}),
              execute: async () => {
                try {
                  const r = await fetch("https://ipapi.co/json/");
                  const j: any = await r.json();
                  return {
                    ok: true,
                    ip: j.ip,
                    city: j.city,
                    region: j.region,
                    country: j.country_name,
                    timezone: j.timezone,
                  };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            crypto_price: tool({
              description: "Get current price of a cryptocurrency in USD (coingecko).",
              inputSchema: z.object({ coin: z.string().describe("e.g. 'bitcoin', 'ethereum', 'solana'") }),
              execute: async ({ coin }) => {
                try {
                  const r = await fetch(
                    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin.toLowerCase())}&vs_currencies=usd&include_24hr_change=true`,
                  );
                  const j: any = await r.json();
                  const d = j[coin.toLowerCase()];
                  if (!d) return { ok: false, error: "Unknown coin" };
                  return { ok: true, coin, usd: d.usd, change_24h_pct: d.usd_24h_change };
                } catch (e: any) {
                  return { ok: false, error: e.message };
                }
              },
            }),
            days_between: tool({
              description: "Number of days between two dates (ISO or YYYY-MM-DD).",
              inputSchema: z.object({ from: z.string(), to: z.string() }),
              execute: async ({ from, to }) => {
                const a = new Date(from).getTime(),
                  b = new Date(to).getTime();
                if (isNaN(a) || isNaN(b)) return { ok: false, error: "Invalid date" };
                return { ok: true, days: Math.round((b - a) / 86400000) };
              },
            }),
            add_to_date: tool({
              description: "Add days/hours/minutes to a date and return ISO.",
              inputSchema: z.object({
                base_iso: z.string(),
                days: z.number().default(0).optional(),
                hours: z.number().default(0).optional(),
                minutes: z.number().default(0).optional(),
              }),
              execute: async ({ base_iso, days, hours, minutes }) => {
                const d = new Date(base_iso);
                if (isNaN(d.getTime())) return { ok: false, error: "Invalid date" };
                d.setDate(d.getDate() + (days ?? 0));
                d.setHours(d.getHours() + (hours ?? 0));
                d.setMinutes(d.getMinutes() + (minutes ?? 0));
                return { ok: true, iso: d.toISOString() };
              },
            }),
            age_from_birthdate: tool({
              description: "Compute age (years, months, days) from a birthdate.",
              inputSchema: z.object({ birthdate: z.string() }),
              execute: async ({ birthdate }) => {
                const b = new Date(birthdate);
                if (isNaN(b.getTime())) return { ok: false, error: "Invalid date" };
                const now = new Date();
                let y = now.getFullYear() - b.getFullYear();
                let m = now.getMonth() - b.getMonth();
                let d = now.getDate() - b.getDate();
                if (d < 0) {
                  m--;
                  d += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
                }
                if (m < 0) {
                  y--;
                  m += 12;
                }
                return { ok: true, years: y, months: m, days: d };
              },
            }),

            // ===== STOCK SEARCH & SNAPSHOT TOOLS (working, imported) =====
            search_stocks: tool({
              description: "Search for a stock symbol by company name or ticker.",
              inputSchema: z.object({ query: z.string() }),
              execute: async ({ query }) => {
                const result = await searchStocks({ data: { q: query } });
                if (!result.ok) return { ok: false, error: result.error };
                return { ok: true, results: result.results };
              },
            }),
            get_stock_snapshot: tool({
              description: "Get a quick snapshot of a stock (price, change, market cap, industry).",
              inputSchema: z.object({ symbol: z.string() }),
              execute: async ({ symbol }) => {
                const result = await getStockSnapshot({ data: { symbol } });
                if (!result.ok) return { ok: false, error: result.error };
                const {
                  symbol: s,
                  price,
                  change,
                  high,
                  low,
                  open,
                  prevClose,
                  name,
                  industry,
                  marketCap,
                  exchange,
                  currency,
                } = result;
                return {
                  ok: true,
                  symbol: s,
                  name,
                  price,
                  change: change?.toFixed(2),
                  high,
                  low,
                  open,
                  prevClose,
                  industry,
                  marketCap: marketCap ? `$${(marketCap / 1e9).toFixed(2)}B` : "—",
                  exchange,
                  currency,
                };
              },
            }),
          };
          // ============================================================

          // ---- System Prompt ----
          const baseSystemPrompt = getSystemPrompt(mode, addressAs, factsBlock, submode);
          const systemPrompt = `${baseSystemPrompt}${recallBlock}

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

UTILITY BELT — reach for these instead of doing it in your head:
- Notes/journal/bookmarks: create_note, list_notes, update_note, delete_note (tag them).
- Timers: start_timer, start_pomodoro (they beep in the user's browser). speak_text for TTS.
- Time/dates: time_in_timezone, convert_time_between_timezones, time_until, schedule_across_zones, list_common_timezones, days_between, add_to_date, age_from_birthdate.
- Math/units/money: calculate, convert_units, currency_convert, crypto_price, random_pick.
- Coding helpers: format_json, decode_jwt, regex_test, uuid_generate, password_generate, base64_encode/decode, url_encode/decode, hash_text, slugify, diff_text, lorem_ipsum, color_convert, text_stats.
- Lookups: http_get, define_word, wikipedia_summary, get_public_ip_info.
- Code memory: remember_code to store snippets, recall_memory with language filter to retrieve them.
- Built-in browser: create_browser_tab to give the user a full web browser inside a custom tab.

When the user says "take me to X" or "open X", actually navigate — don't just describe the link.

TOKEN ECONOMY (STRICT): Answer in the fewest words possible. No preamble, no restating the question, no filler like "Certainly, Sir" or "I'll help you with that". Skip closing pleasantries. Use short sentences and compact lists. Only elaborate when the user explicitly asks for detail. Do NOT invoke tools unless the user's request clearly requires one — never call system_status, recall_memory, or list_* tools for casual chat.`;

          try {
            const providerName = String((chatModel as any)?.provider ?? "").toLowerCase();
            const providerOptions: Record<string, any> = {};
            if (providerName.includes("anthropic")) {
              providerOptions.anthropic = { cacheControl: { type: "ephemeral" } };
            }

            // ---- Token trim: only send the last N turns to the model ----
            // Full history stays in DB; older context is available via recall_memory / recall_chat_memory.
            const MAX_TURNS = 12;
            const trimmedMessages = messages.length > MAX_TURNS ? messages.slice(-MAX_TURNS) : messages;

            // Give code answers room to breathe; keep casual replies tight.
            const isCodeIntent = mode === "coding" || routedIntent === "code";
            const outputCap = isCodeIntent ? 4096 : mode === "thinking" ? 2048 : 1024;

            // If the router flagged this as code but the user isn't in coding mode,
            // splice in the coding prompt as an extra system directive so Roblox/Lua
            // answers get the same expertise regardless of the UI toggle.
            let effectiveSystem = systemPrompt;
            if (isCodeIntent && mode !== "coding") {
              const { CODING_PROMPT_EXPORT } = await import("@/lib/ai-gateway.server");
              effectiveSystem = `${CODING_PROMPT_EXPORT}\n\n---\n\n${systemPrompt}`;
            }

            const result = streamText({
              model: chatModel,
              system: effectiveSystem,
              messages: await convertToModelMessages(trimmedMessages),
              tools,
              stopWhen: stepCountIs(50),
              temperature: isCodeIntent ? 0.2 : 0.5,
              maxOutputTokens: outputCap,
              ...(Object.keys(providerOptions).length ? { providerOptions } : {}),
              onError: ({ error }) => {
                debugChatError(error, "stream-runtime", {
                  threadId,
                  provider: (chatModel as any)?.provider,
                  modelId: (chatModel as any)?.modelId,
                });
              },
              onFinish: async ({ response, usage, providerMetadata }) => {
                try {
                  const cachedTokens =
                    (providerMetadata as any)?.google?.usageMetadata?.cachedContentTokenCount ??
                    (providerMetadata as any)?.anthropic?.cacheReadInputTokens ??
                    (usage as any)?.cachedInputTokens ??
                    0;
                  console.log(
                    `[CACHE] provider=${providerName} promptTokens=${(usage as any)?.inputTokens ?? "?"} cached=${cachedTokens}`,
                  );

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
                    await storeCachedResponse(userId, cacheKey, parts, threadId, mode, boundTabSlug, supabase);
                    console.log("💾 [CACHE] Stored response for key:", cacheKey);
                  }
                } catch (e) {
                  console.error("[chat onFinish error]", e);
                }
              },
            });

            return result.toUIMessageStreamResponse({
              originalMessages: messages,
              onError: (error: unknown) => {
                const payload = debugChatError(error, "stream-response", {
                  threadId,
                  provider: (chatModel as any)?.provider,
                  modelId: (chatModel as any)?.modelId,
                });
                if (payload.statusCode === 402) return "AI credits exhausted, Sir. Please top up to continue.";
                if (payload.statusCode === 429) return "Rate limit reached, Sir. Try again in a moment.";
                if (/brave_search|not in request\.tools|tool call validation/i.test(payload.message)) {
                  return "My apologies, Sir — I tripped over a tool I don't actually have. Try that again.";
                }
                return `Signal interrupted, Sir. Copy this debug block into another AI if needed: ${JSON.stringify(payload)}`;
              },
            });
          } catch (error) {
            const payload = debugChatError(error, "stream-start", {
              threadId,
              provider: (chatModel as any)?.provider,
              modelId: (chatModel as any)?.modelId,
            });
            return chatErrorResponse(payload, messages);
          }
        } catch (error) {
          const payload = debugChatError(error, "chat-request", { threadId });
          return chatErrorResponse(payload, messages);
        }
      },
    },
  },
});

function buildBrowserTabHTML(opts: {
  homeUrl: string;
  showAddressBar: boolean;
  showNavButtons: boolean;
  showReloadButton: boolean;
  showHomeButton: boolean;
  showGoButton: boolean;
}): string {
  const { homeUrl, showAddressBar, showNavButtons, showReloadButton, showHomeButton, showGoButton } = opts;
  const configJS = JSON.stringify({ showAddressBar, showNavButtons, showReloadButton, showHomeButton, showGoButton });
  return `<!-- Built‑in Browser Tab with Configurable UI -->
<div id="browser-container" style="display:flex;flex-direction:column;height:100vh;background:#0f1115;color:#e0e6ed;font-family:system-ui,sans-serif;">
  <div id="browser-toolbar" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(26,29,35,0.8);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;flex-wrap:wrap;">
    <div id="nav-group" style="display:flex;gap:4px;align-items:center;">
      <button id="browser-back" style="background:transparent;border:none;color:#9ca3af;font-size:20px;cursor:pointer;padding:0 4px;">◀</button>
      <button id="browser-forward" style="background:transparent;border:none;color:#9ca3af;font-size:20px;cursor:pointer;padding:0 4px;">▶</button>
      <button id="browser-reload" style="background:transparent;border:none;color:#9ca3af;font-size:18px;cursor:pointer;padding:0 4px;">⟳</button>
    </div>
    <div id="address-group" style="display:flex;flex:1;gap:4px;align-items:center;min-width:150px;">
      <input id="browser-url" type="url" style="flex:1;background:rgba(15,17,21,0.6);color:#d1d5db;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 12px;font-size:14px;outline:none;min-width:100px;" placeholder="Enter URL..." value="${homeUrl}">
      <button id="browser-go" style="background:#7c3aed;border:none;color:white;border-radius:6px;padding:6px 14px;cursor:pointer;font-weight:500;white-space:nowrap;">Go</button>
    </div>
    <div id="home-group" style="display:flex;gap:4px;align-items:center;">
      <button id="browser-home" style="background:transparent;border:none;color:#9ca3af;font-size:18px;cursor:pointer;">🏠</button>
      <button id="browser-settings" style="background:transparent;border:none;color:#9ca3af;font-size:16px;cursor:pointer;" title="Browser UI Settings">⚙️</button>
    </div>
  </div>
  <iframe id="browser-iframe" src="${homeUrl}" style="flex:1;border:none;width:100%;height:100%;background:white;"></iframe>
</div>

<div id="browser-settings-panel" style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(26,29,35,0.95);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:24px;max-width:360px;width:90%;z-index:1000;box-shadow:0 8px 40px rgba(0,0,0,0.8);">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
    <h3 style="font-size:16px;font-weight:600;color:#e0e6ed;margin:0;">Browser UI Settings</h3>
    <button id="settings-close" style="background:transparent;border:none;color:#9ca3af;font-size:20px;cursor:pointer;">✕</button>
  </div>
  <div style="display:flex;flex-direction:column;gap:12px;">
    <label style="display:flex;align-items:center;gap:10px;color:#e0e6ed;font-size:14px;">
      <input type="checkbox" class="browser-ui-toggle" data-key="showAddressBar" ${showAddressBar ? "checked" : ""}> Address Bar
    </label>
    <label style="display:flex;align-items:center;gap:10px;color:#e0e6ed;font-size:14px;">
      <input type="checkbox" class="browser-ui-toggle" data-key="showNavButtons" ${showNavButtons ? "checked" : ""}> Navigation Buttons
    </label>
    <label style="display:flex;align-items:center;gap:10px;color:#e0e6ed;font-size:14px;">
      <input type="checkbox" class="browser-ui-toggle" data-key="showReloadButton" ${showReloadButton ? "checked" : ""}> Reload Button
    </label>
    <label style="display:flex;align-items:center;gap:10px;color:#e0e6ed;font-size:14px;">
      <input type="checkbox" class="browser-ui-toggle" data-key="showHomeButton" ${showHomeButton ? "checked" : ""}> Home Button
    </label>
    <label style="display:flex;align-items:center;gap:10px;color:#e0e6ed;font-size:14px;">
      <input type="checkbox" class="browser-ui-toggle" data-key="showGoButton" ${showGoButton ? "checked" : ""}> Go Button
    </label>
  </div>
  <button id="settings-save" style="margin-top:16px;width:100%;background:#7c3aed;color:white;border:none;border-radius:6px;padding:8px;font-weight:500;cursor:pointer;">Save Settings</button>
</div>

<script>
(function() {
  const DEFAULT_CONFIG = ${configJS};
  const CONFIG_KEY = 'browser-ui-config';
  let uiConfig = JSON.parse(localStorage.getItem(CONFIG_KEY)) || DEFAULT_CONFIG;

  const toolbar = document.getElementById('browser-toolbar');
  const navGroup = document.getElementById('nav-group');
  const addressGroup = document.getElementById('address-group');
  const homeGroup = document.getElementById('home-group');
  const backBtn = document.getElementById('browser-back');
  const forwardBtn = document.getElementById('browser-forward');
  const reloadBtn = document.getElementById('browser-reload');
  const homeBtn = document.getElementById('browser-home');
  const goBtn = document.getElementById('browser-go');
  const urlInput = document.getElementById('browser-url');
  const iframe = document.getElementById('browser-iframe');
  const settingsBtn = document.getElementById('browser-settings');
  const settingsPanel = document.getElementById('browser-settings-panel');
  const settingsClose = document.getElementById('settings-close');
  const settingsSave = document.getElementById('settings-save');
  const toggles = document.querySelectorAll('.browser-ui-toggle');

  function applyUI() {
    navGroup.style.display = uiConfig.showNavButtons ? 'flex' : 'none';
    addressGroup.style.display = uiConfig.showAddressBar ? 'flex' : 'none';
    homeGroup.style.display = (uiConfig.showHomeButton || uiConfig.showReloadButton) ? 'flex' : 'none';
    reloadBtn.style.display = uiConfig.showReloadButton ? 'inline-block' : 'none';
    homeBtn.style.display = uiConfig.showHomeButton ? 'inline-block' : 'none';
    goBtn.style.display = uiConfig.showGoButton ? 'inline-block' : 'none';
  }

  let history = [];
  let currentIndex = -1;

  function navigateTo(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    iframe.src = url;
    urlInput.value = url;
    history = history.slice(0, currentIndex + 1);
    history.push(url);
    currentIndex++;
  }

  goBtn.addEventListener('click', () => navigateTo(urlInput.value));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigateTo(urlInput.value);
  });
  backBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
      currentIndex--;
      const url = history[currentIndex];
      iframe.src = url;
      urlInput.value = url;
    }
  });
  forwardBtn.addEventListener('click', () => {
    if (currentIndex < history.length - 1) {
      currentIndex++;
      const url = history[currentIndex];
      iframe.src = url;
      urlInput.value = url;
    }
  });
  reloadBtn.addEventListener('click', () => { iframe.src = iframe.src; });
  homeBtn.addEventListener('click', () => navigateTo('${homeUrl}'));

  iframe.addEventListener('load', () => {
    try {
      const url = iframe.contentWindow?.location?.href;
      if (url && url !== 'about:blank') {
        urlInput.value = url;
        if (history[history.length - 1] !== url) {
          history = history.slice(0, currentIndex + 1);
          history.push(url);
          currentIndex++;
        }
      }
    } catch (e) {}
  });

  settingsBtn.addEventListener('click', () => {
    settingsPanel.style.display = 'block';
    toggles.forEach(cb => {
      cb.checked = uiConfig[cb.dataset.key] !== undefined ? uiConfig[cb.dataset.key] : true;
    });
  });
  settingsClose.addEventListener('click', () => settingsPanel.style.display = 'none');
  settingsPanel.addEventListener('click', (e) => {
    if (e.target === settingsPanel) settingsPanel.style.display = 'none';
  });
  settingsSave.addEventListener('click', () => {
    toggles.forEach(cb => {
      uiConfig[cb.dataset.key] = cb.checked;
    });
    localStorage.setItem(CONFIG_KEY, JSON.stringify(uiConfig));
    applyUI();
    settingsPanel.style.display = 'none';
  });

  applyUI();
})();
<\/script>`;
}
