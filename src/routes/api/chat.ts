import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { JARVIS_SYSTEM_PROMPT, resolveChatModel } from "@/lib/ai-gateway.server";

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
        // model resolution moved below (supports Groq via GROQ_API_KEY)


        const { messages, threadId } = (await request.json()) as Body;
        if (!Array.isArray(messages) || !threadId) return new Response("Bad request", { status: 400 });

        const supabase = userClient(token);
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) return new Response("Unauthorized", { status: 401 });

        // Verify thread ownership
        const { data: thread } = await supabase.from("chat_threads")
          .select("id, title").eq("id", threadId).eq("user_id", userId).maybeSingle();
        if (!thread) return new Response("Thread not found", { status: 404 });

        // Load profile for address-as
        const { data: profile } = await supabase.from("profiles")
          .select("address_as, name").eq("id", userId).maybeSingle();
        const addressAs = profile?.address_as ?? "Sir";

        // Load remembered facts about the user (capped)
        const { data: factRows } = await supabase.from("user_facts")
          .select("category, key, value").eq("user_id", userId)
          .order("updated_at", { ascending: false }).limit(200);
        const factsBlock = (factRows ?? []).length
          ? (factRows ?? []).map((f: any) => `- [${f.category}] ${f.key}: ${f.value}`).join("\n")
          : "(none yet)";

        // Persist the latest user message
        const last = messages[messages.length - 1];
        if (last?.role === "user") {
          await supabase.from("chat_messages").insert({
            thread_id: threadId, user_id: userId, role: "user", parts: last.parts as any,
          });
          // Auto-name thread from first user message
          if (thread.title === "New conversation") {
            const text = (last.parts as any[]).map((p: any) => p?.type === "text" ? p.text : "").join(" ").trim().slice(0, 60);
            if (text) await supabase.from("chat_threads").update({ title: text }).eq("id", threadId);
          }
        }

        let chatModel;
        try {
          chatModel = resolveChatModel().model;
        } catch (e: any) {
          return new Response(e?.message ?? "Model unavailable", { status: 500 });
        }

        const tools = {
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
              const { data, error } = await supabase.from("reminders").insert({
                user_id: userId, title, datetime: dt.toISOString(), priority,
                recurrence: recurrence ?? null, description: description ?? null, source_type: "chat",
              }).select("id, title, datetime, recurrence").single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, reminder: data };
            },
          }),
          list_reminders: tool({
            description: "List the user's upcoming reminders (next 30 days).",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await supabase.from("reminders")
                .select("id, title, datetime, priority, recurrence, is_completed")
                .eq("user_id", userId).eq("is_completed", false)
                .gte("datetime", new Date().toISOString())
                .order("datetime", { ascending: true }).limit(20);
              return { reminders: data ?? [] };
            },
          }),
          complete_reminder: tool({
            description: "Mark a reminder as complete by id.",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("reminders")
                .update({ is_completed: true }).eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),
          save_vault_item: tool({
            description: "Save an item to the user's private vault. Use 'credential' for login info, 'contact' for people, 'note' for free-form notes.",
            inputSchema: z.object({
              kind: z.enum(["credential", "note", "contact"]),
              label: z.string(),
              data: z.record(z.string(), z.any()).describe("For credential: {username, password, url}. For contact: {name, email, phone, notes}. For note: {body}."),
            }),
            execute: async ({ kind, label, data }) => {
              const { data: row, error } = await supabase.from("vault_items")
                .insert({ user_id: userId, kind, label, data })
                .select("id, label, kind").single();
              if (error) return { ok: false, error: error.message };
              return { ok: true, item: row };
            },
          }),
          list_vault: tool({
            description: "List the user's vault items (labels only — never read back credentials by default).",
            inputSchema: z.object({ kind: z.enum(["credential", "note", "contact"]).nullable().optional() }),
            execute: async ({ kind }) => {
              let q = supabase.from("vault_items").select("id, kind, label, updated_at").eq("user_id", userId);
              if (kind) q = q.eq("kind", kind);
              const { data } = await q.order("updated_at", { ascending: false }).limit(50);
              return { items: data ?? [] };
            },
          }),
          unlock_vault_item: tool({
            description: "Reveal the contents of a vault item (credentials, account passwords, sensitive notes). REQUIRES a PIN from the user. If the user has not provided a PIN in this turn, ask them for it first (4–28 characters) — do NOT call this without one. Match by id (from list_vault) or by label substring.",
            inputSchema: z.object({
              pin: z.string().min(4).max(28).describe("The PIN the user just typed."),
              id: z.string().uuid().nullable().optional(),
              label: z.string().nullable().optional().describe("Case-insensitive substring match on label."),
            }),
            execute: async ({ pin, id, label }) => {
              const { data: prof } = await supabase.from("profiles").select("vault_pin_hash").eq("id", userId).maybeSingle();
              if (!prof?.vault_pin_hash) return { ok: false, error: "No PIN set. Ask the user to set one in Settings first." };
              const enc = new TextEncoder().encode(`${userId}:${pin}`);
              const buf = await crypto.subtle.digest("SHA-256", enc);
              const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
              if (hash !== prof.vault_pin_hash) return { ok: false, error: "Incorrect PIN." };
              let q = supabase.from("vault_items").select("id, kind, label, data, updated_at").eq("user_id", userId);
              if (id) q = q.eq("id", id);
              else if (label) q = q.ilike("label", `%${label}%`);
              else return { ok: false, error: "Provide id or label." };
              const { data } = await q.limit(5);
              if (!data?.length) return { ok: false, error: "No matching vault item." };
              return { ok: true, items: data };
            },
          }),
          remember_fact: tool({
            description: "Persist a key fact about the user so you remember it across conversations. Use sparingly for durable info: name, age, height, weight, birthday, location, friends/family names, interests, hobbies, goals, preferences, relationships. Categories: 'identity' (name/age/height/weight/birthday), 'people' (friend/family/coworker names + relationship), 'interest', 'preference', 'goal', 'general'.",
            inputSchema: z.object({
              category: z.enum(["identity", "people", "interest", "preference", "goal", "general"]),
              key: z.string().describe("Short stable key, e.g. 'height', 'best_friend', 'favorite_band'."),
              value: z.string().describe("The fact value, e.g. '6ft 1in', 'Alex (best friend, loves climbing)'."),
            }),
            execute: async ({ category, key, value }) => {
              const { error } = await supabase.from("user_facts")
                .upsert({ user_id: userId, category, key, value }, { onConflict: "user_id,category,key" });
              return { ok: !error, error: error?.message };
            },
          }),
          list_facts: tool({
            description: "List facts you've remembered about the user, optionally filtered by category.",
            inputSchema: z.object({ category: z.enum(["identity", "people", "interest", "preference", "goal", "general"]).nullable().optional() }),
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
          log_transaction: tool({
            description: "Log a spending transaction the user mentioned (Cash App, card, cash, etc.). Use this any time the user says they spent/paid/bought something with an amount.",
            inputSchema: z.object({
              amount: z.number().describe("Dollar amount, e.g. 12.50. Use a negative number for refunds/income."),
              merchant: z.string().nullable().optional().describe("Who they paid, e.g. 'Chipotle', 'Alex'."),
              category: z.enum(["food", "transport", "entertainment", "bills", "shopping", "groceries", "transfer", "income", "other"]).default("other"),
              note: z.string().nullable().optional(),
              source: z.enum(["chat", "manual"]).default("chat"),
              occurred_at: z.string().nullable().optional().describe("ISO datetime; defaults to now"),
            }),
            execute: async ({ amount, merchant, category, note, source, occurred_at }) => {
              const cents = Math.round(amount * 100);
              const { data, error } = await supabase.from("transactions").insert({
                user_id: userId, amount_cents: cents, merchant: merchant ?? null,
                category, note: note ?? null, source,
                occurred_at: occurred_at ? new Date(occurred_at).toISOString() : new Date().toISOString(),
              }).select("id, amount_cents, merchant, category, occurred_at").single();
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
              let q = supabase.from("transactions")
                .select("id, amount_cents, merchant, category, note, source, occurred_at")
                .eq("user_id", userId).gte("occurred_at", since)
                .order("occurred_at", { ascending: false }).limit(limit);
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
              const { data } = await supabase.from("transactions")
                .select("amount_cents, category")
                .eq("user_id", userId).gte("occurred_at", since.toISOString());
              const totals: Record<string, number> = {};
              let total = 0;
              for (const r of data ?? []) {
                totals[r.category] = (totals[r.category] ?? 0) + r.amount_cents;
                total += r.amount_cents;
              }
              const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
              return {
                window, since: since.toISOString(), total: fmt(total),
                by_category: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, fmt(v)])),
                count: data?.length ?? 0,
              };
            },
          }),
          delete_transaction: tool({
            description: "Delete a transaction by id (use list_transactions to find ids).",
            inputSchema: z.object({ id: z.string().uuid() }),
            execute: async ({ id }) => {
              const { error } = await supabase.from("transactions").delete()
                .eq("id", id).eq("user_id", userId);
              return { ok: !error, error: error?.message };
            },
          }),
        };

        const now = new Date();
        const result = streamText({
          model: chatModel,
          system: `${JARVIS_SYSTEM_PROMPT}

Address the user as "${addressAs}".
Current time: ${now.toISOString()} (${now.toString()}).
You have tools to create reminders (one-off or recurring: daily/weekdays/weekly/monthly), list and complete reminders, save/list private vault items (credentials, notes, contacts), remember/list/forget personal facts about the user, and log/list/summarize spending transactions (Cash App, card, cash — any time the user mentions an amount they spent, paid, or received, call log_transaction). Use spending_summary to answer "how much did I spend on X" questions.

VAULT SECURITY: list_vault only returns labels — never reveal credentials or sensitive data from it. When the user asks for an account/password/secret content, ALWAYS ask them to type their PIN (4–28 characters) in the next message, then call unlock_vault_item with that pin. Never invent a PIN, never reveal item contents without a successful unlock_vault_item call this turn, and never echo the PIN itself back.
When the user mentions a routine ("every morning", "every weekday at 8am", "remind me daily"), use create_reminder with the recurrence field.
When the user shares an account/login/contact, offer to save it to the vault. Never echo a stored password back unprompted.
When the user reveals durable personal info (name, age, height, weight, birthday, friends/family names, interests, goals, preferences), silently call remember_fact so you recall it later. Update existing facts with the same category+key instead of creating duplicates. Only forget facts when asked.

Known facts about ${addressAs}:
${factsBlock}

Be concise. Confirm after taking an action.`,
          messages: await convertToModelMessages(messages),
          tools,
          stopWhen: stepCountIs(8),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ messages: finalMessages }) => {
            const assistant = finalMessages[finalMessages.length - 1];
            if (assistant && assistant.role === "assistant") {
              await supabase.from("chat_messages").insert({
                thread_id: threadId, user_id: userId, role: "assistant", parts: assistant.parts as any,
              });
              await supabase.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
            }
          },
        });
      },
    },
  },
});
