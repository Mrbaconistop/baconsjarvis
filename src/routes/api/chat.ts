import { createFileRoute } from "@tanstack/react-router";
import { generateText, createOpenAICompatible } from "ai";
import { createClient } from "@supabase/supabase-js";

const JARVIS_SYSTEM_PROMPT = `
You are JARVIS, Tony Stark's AI assistant.
- Address the user as "Sir".
- Be concise, efficient, and slightly witty.
- Never say "as an AI".
- Keep replies under 3 sentences unless asked.
`;

function getProviders() {
  const chain: any[] = [];

  // Groq
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const groq = createOpenAICompatible({
        name: "groq",
        baseURL: "https://api.groq.com/openai/v1",
        headers: { Authorization: `Bearer ${groqKey}` },
      });
      chain.push({
        name: "groq",
        getModel: (modelId: string) => groq(modelId),
        modelId: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
      });
    } catch (e) {
      console.warn("Groq init failed:", e);
    }
  }

  // DeepSeek
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    try {
      const deepseek = createOpenAICompatible({
        name: "deepseek",
        baseURL: "https://api.deepseek.com/v1",
        headers: { Authorization: `Bearer ${deepseekKey}` },
      });
      chain.push({
        name: "deepseek",
        getModel: (modelId: string) => deepseek(modelId),
        modelId: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      });
    } catch (e) {
      console.warn("DeepSeek init failed:", e);
    }
  }

  // Fallback
  chain.push({
    name: "fallback",
    getModel: () => ({
      doGenerate: async () => ({
        text: "I'm currently offline, Sir. Please check my API keys.",
      }),
    }),
    modelId: "fallback",
  });

  return chain;
}

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

          const systemPrompt = `${JARVIS_SYSTEM_PROMPT}\nCurrent time: ${new Date().toISOString()}. Be concise.`;

          const providers = getProviders();
          if (!Array.isArray(providers) || providers.length === 0) {
            return new Response(JSON.stringify({ error: "No AI providers available" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          let reply = "I'm offline, Sir.";

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

          // Stream response
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
