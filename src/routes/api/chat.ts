import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createClient } from "@supabase/supabase-js";

// System prompt
const JARVIS_SYSTEM_PROMPT = `
You are JARVIS, Tony Stark's AI assistant.
- Address the user as "Sir".
- Be concise, efficient, and slightly witty.
- Never say "as an AI".
- Keep replies under 3 sentences unless asked.
Current time: ${new Date().toISOString()}.
`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // 1. Auth
          const auth = request.headers.get("authorization") ?? "";
          const token = auth.replace(/^Bearer\s+/i, "");
          if (!token) return new Response("Unauthorized", { status: 401 });

          // 2. Parse body
          const body = await request.json();
          const { messages, threadId } = body || {};
          if (!messages || !threadId) {
            return new Response("Bad request", { status: 400 });
          }

          // 3. Get last user message
          const lastUser = messages.filter((m: any) => m.role === "user").pop();
          const userPrompt = lastUser?.parts?.map((p: any) => p.text).join(" ") || "Hello";

          // 4. Create Groq provider with your key
          const groqKey = process.env.GROQ_API_KEY || "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";
          const groq = createOpenAICompatible({
            name: "groq",
            baseURL: "https://api.groq.com/openai/v1",
            headers: { Authorization: `Bearer ${groqKey}` },
          });
          const model = groq("llama-3.1-8b-instant");

          // 5. Generate response
          const { text } = await generateText({
            model,
            system: JARVIS_SYSTEM_PROMPT,
            prompt: userPrompt,
            maxTokens: 200,
          });

          // 6. Return as stream (single chunk)
          const stream = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              const chunk = {
                id: `msg-${Date.now()}`,
                role: "assistant",
                parts: [{ type: "text", text: text || "I'm having trouble, Sir." }],
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
          return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
