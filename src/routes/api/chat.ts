import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, generateText, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { JARVIS_SYSTEM_PROMPT, generateWithFailover } from "@/lib/ai-gateway.server";

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

        // Load facts
        const { data: factRows } = await supabase
          .from("user_facts")
          .select("category, key, value")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(200);
        const factsBlock = (factRows ?? []).length
          ? (factRows ?? []).map((f: any) => `- [${f.category}] ${f.key}: ${f.value}`).join("\n")
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

        // ----- Tools -----
        const tools = {
          // Same tools as before – keeping them for tool calls
          create_reminder: tool({
            description: "Create a reminder.",
            inputSchema: z.object({
              title: z.string(),
              datetime_iso: z.string(),
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
            description: "List upcoming reminders.",
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
            description: "Mark a reminder complete.",
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
            description: "Search reminders.",
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

          // Vault tools (shortened for brevity – include all the ones from the previous version)
          save_vault_item: tool({
            description: "Save an item to vault.",
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
            description: "List vault items.",
            inputSchema: z.object({ kind: z.enum(["credential", "note", "contact"]).nullable().optional() }),
            execute: async ({ kind }) => {
              let q = supabase.from("vault_items").select("id, kind, label, tags, updated_at").eq("user_id", userId);
              if (kind) q = q.eq("kind", kind);
              const { data } = await q.order("updated_at", { ascending: false }).limit(50);
              return { items: data ?? [] };
            },
          }),
          unlock_vault_item: tool({
            description: "Unlock vault item with PIN.",
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
              if (!data?.length) return { ok: false, error: "No matching item." };
              return { ok: true, items: data };
            },
          }),
          search_vault: tool({
            description: "Search vault.",
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

          // Fact tools
          remember_fact: tool({
            description: "Remember a fact.",
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
            description: "List facts.",
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
            description: "Forget a fact.",
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
            description: "Search facts.",
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

          // Transaction tools
          log_transaction: tool({
            description: "Log a transaction.",
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
            description: "List transactions.",
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
            description: "Spending summary.",
            inputSchema: z.object({ window: z.enum(["week", "month", "30d", "90d", "year"]).default("month") }),
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
            description: "Search transactions.",
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
                    false ||
                    t.note?.toLowerCase().includes(qLower) ||
                    false ||
                    t.category?.toLowerCase().includes(qLower) ||
                    false,
                );
              }
              return { transactions: results, total_count: results.length };
            },
          }),
          delete_transaction: tool({
            description: "Delete a transaction.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("transactions").delete().eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),

          // Social
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
        };

        // ----- Build the system prompt -----
        const now = new Date();
        const systemPrompt = `${JARVIS_SYSTEM_PROMPT}

Address the user as "${addressAs}".
Current time: ${now.toISOString()} (${now.toString()}).
You have tools for reminders, vault, facts, transactions, and social feeds. Use search tools when the user asks about specific items.

VAULT SECURITY: Never reveal credentials without a successful PIN unlock.
When the user mentions routine, use create_reminder with recurrence.
When the user shares personal info, call remember_fact.

MEMORY — MANDATORY: If the user says "remember", "don't forget", "note that", etc., you MUST call remember_fact BEFORE replying.

RECALL — MANDATORY: The facts block below is your long-term memory. Use it to answer questions about the user.

Known facts about ${addressAs}:
${factsBlock}

SEARCH TOOLS: Use search_vault, search_transactions, search_social, search_reminders, search_facts when the user asks about specific things.

Be concise. Confirm actions.`;

        // ----- Generate response with failover -----
        // Convert messages to a single prompt for the fallback generator
        // We'll use the last user message as the prompt
        const userMessages = messages.filter((m) => m.role === "user");
        const lastUserMsg = userMessages[userMessages.length - 1];
        const userPrompt = lastUserMsg
          ? (lastUserMsg.parts as any[]).map((p) => (p.type === "text" ? p.text : "")).join(" ")
          : "";

        let assistantText = "";
        try {
          assistantText = await generateWithFailover(userPrompt, systemPrompt, { maxTokens: 1024, temperature: 0.7 });
        } catch (error) {
          console.error("All providers failed:", error);
          assistantText = "I'm having trouble connecting to my core systems, Sir. Try again in a moment.";
        }

        // Save assistant message
        await supabase.from("chat_messages").insert({
          thread_id: threadId,
          user_id: userId,
          role: "assistant",
          parts: [{ type: "text", text: assistantText }] as any,
        });
        await supabase.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);

        // Return the response as a stream (single chunk)
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            // Format as a UIMessage stream chunk
            const chunk = {
              id: `msg-${Date.now()}`,
              role: "assistant",
              parts: [{ type: "text", text: assistantText }],
              createdAt: new Date().toISOString(),
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
