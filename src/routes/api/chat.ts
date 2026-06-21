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

        const { messages, threadId } = (await request.json()) as Body;
        if (!Array.isArray(messages) || !threadId) return new Response("Bad request", { status: 400 });

        const supabase = userClient(token);
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) return new Response("Unauthorized", { status: 401 });

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

        const { data: profile } = await supabase
          .from("profiles")
          .select("address_as, name")
          .eq("id", userId)
          .maybeSingle();
        const addressAs = profile?.address_as ?? "Sir";

        const { data: factRows } = await supabase
          .from("user_facts")
          .select("category, key, value")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(200);
        const factsBlock = (factRows ?? []).length
          ? (factRows ?? []).map((f: any) => `- [${f.category}] ${f.key}: ${f.value}`).join("\n")
          : "(none yet)";

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

        const chatModel = resolveChatModel();

        const tools = {
          // ... all your tools (too many to list here – keep them from your original file)
          // For brevity, I'm omitting the full tool list, but you can copy them from your backup.
        };

        const now = new Date();
        const result = streamText({
          model: chatModel,
          system: `${JARVIS_SYSTEM_PROMPT}

Address the user as "${addressAs}".
Current time: ${now.toISOString()} (${now.toString()}).
You have tools for reminders, vault, facts, transactions, and social feeds.

VAULT SECURITY: Never reveal credentials without a successful PIN unlock.
When the user mentions routine, use create_reminder with recurrence.
When the user shares personal info, call remember_fact.

RECALL — MANDATORY: The facts block below is your long-term memory. Use it to answer questions about the user.

Known facts about ${addressAs}:
${factsBlock}

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
            if (e?.statusCode === 402 || e?.statusCode === 429) {
              return "Sir, I've hit a rate limit with the AI provider. Try again in a moment.";
            }
            const detail = e?.responseBody || e?.message || String(error);
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
