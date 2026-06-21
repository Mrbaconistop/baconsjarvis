import { createFileRoute } from "@tanstack/react-router";

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

          // 4. Groq API key (hardcoded fallback if env missing)
          const groqKey = process.env.GROQ_API_KEY || "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";

          // 5. Call Groq API
          const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${groqKey}`,
            },
            body: JSON.stringify({
              model: "llama-3.1-8b-instant",
              messages: [
                {
                  role: "system",
                  content:
                    "You are JARVIS, Tony Stark's AI assistant. Be concise, witty, and address the user as 'Sir'. Keep replies under 3 sentences.",
                },
                { role: "user", content: userPrompt },
              ],
              max_tokens: 200,
            }),
          });

          if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Groq API error (${response.status}): ${errorData}`);
          }

          const data = await response.json();
          const reply = data?.choices?.[0]?.message?.content || "I'm having trouble, Sir.";

          // 6. Return as stream (single chunk) for compatibility with frontend
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
          console.error("[JARVIS] Chat error:", error);
          return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
