import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { createClient } from "@supabase/supabase-js";
import { JARVIS_SYSTEM_PROMPT, resolveChatModel } from "@/lib/ai-gateway.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization") ?? "";
          const token = auth.replace(/^Bearer\s+/i, "");
          if (!token) return new Response("Unauthorized", { status: 401 });

          const body = await request.json();
          const { messages, threadId } = body || {};
          if (!messages || !threadId) {
            return new Response("Bad request", { status: 400 });
          }

          // Get last user message
          const lastUser = messages.filter((m: any) => m.role === "user").pop();
          const userPrompt = lastUser?.parts?.map((p: any) => p.text).join(" ") || "Hello";

          // Build system prompt
          const systemPrompt = `${JARVIS_SYSTEM_PROMPT}\nCurrent time: ${new Date().toISOString()}. Be concise.`;

          // Get providers – ensure it's an array
          const providers = resolveChatModel();
          if (!Array.isArray(providers) || providers.length === 0) {
            return new Response(JSON.stringify({ error: "No AI providers available" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          let reply = "I'm offline, Sir.";

          // Try each provider in order
          for (const provider of providers) {
            try {
              const model = provider.getModel(provider.modelId);
              const { text } = await generateText({
                model,
                system: systemPrompt,
                prompt: userPrompt,
                maxTokens: 300,
              });
              reply = text;
              console.log(`[JARVIS] Used ${provider.name}`);
              break;
            } catch (e) {
              console.warn(`[JARVIS] ${provider.name} failed:`, e);
              continue;
            }
          }

          // Return as stream (single chunk)
          const stream = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              const chunk = {
                id: `msg-${Date.now()}`,
                role: "assistant",
                parts: [{ type: "text", text: reply }],
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
        } catch (error: any) {
          console.error("Chat API error:", error);
          return new Response(JSON.stringify({ error: "Internal error", details: error?.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
