import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider, JARVIS_SYSTEM_PROMPT } from "@/lib/ai-gateway.server";

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
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

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

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

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
        };

        const now = new Date();
        const result = streamText({
          model,
          system: `${JARVIS_SYSTEM_PROMPT}

Address the user as "${addressAs}".
Current time: ${now.toISOString()} (${now.toString()}).
You have tools to create reminders (one-off or recurring: daily/weekdays/weekly/monthly), list and complete reminders, and save/list private vault items (credentials, notes, contacts).
When the user mentions a routine ("every morning", "every weekday at 8am", "remind me daily"), use create_reminder with the recurrence field.
When the user shares an account/login/contact, offer to save it to the vault. Never echo a stored password back unprompted.
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
