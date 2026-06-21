import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          console.log("[JARVIS] Chat request received");

          const auth = request.headers.get("authorization") ?? "";
          const token = auth.replace(/^Bearer\s+/i, "");
          if (!token) {
            console.log("[JARVIS] No token");
            return new Response("Unauthorized", { status: 401 });
          }

          const body = await request.json();
          console.log("[JARVIS] Body:", JSON.stringify(body).slice(0, 200));
          const { messages, threadId } = body || {};
          if (!messages || !threadId) {
            console.log("[JARVIS] Missing messages or threadId");
            return new Response("Bad request", { status: 400 });
          }

          // Get last user message
          const lastUser = messages.filter((m: any) => m.role === "user").pop();
          const userPrompt = lastUser?.parts?.map((p: any) => p.text).join(" ") || "Hello";

          console.log("[JARVIS] User prompt:", userPrompt);

          // --- Hardcoded Groq ---
          const groqKey = "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";
          const groq = createOpenAICompatible({
            name: "groq",
            baseURL: "https://api.groq.com/openai/v1",
            headers: { Authorization: `Bearer ${groqKey}` },
          });
          const model = groq("llama-3.1-8b-instant");

          const systemPrompt = `
You are JARVIS, Tony Stark's AI assistant.
- Address the user as "Sir".
- Be concise, efficient, and slightly witty.
- Never say "as an AI".
- Keep replies under 3 sentences unless asked.
Current time: ${new Date().toISOString()}.
`;

          console.log("[JARVIS] Calling Groq...");
          const { text } = await generateText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            maxTokens: 300,
          });
          console.log("[JARVIS] Groq reply:", text);

          // Return as stream
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
          console.error("[JARVIS] Chat API error:", error);
          return new Response(JSON.stringify({ error: "Internal error", details: error?.message || "Unknown" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
