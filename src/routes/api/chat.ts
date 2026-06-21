import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // 1. Parse request
          const body = await request.json();
          const { messages } = body || {};
          const lastUser = messages?.filter((m: any) => m.role === "user").pop();
          const prompt = lastUser?.parts?.map((p: any) => p.text).join(" ") || "Hello, JARVIS";

          // 2. Get Groq key
          const groqKey = process.env.GROQ_API_KEY || "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";

          // 3. Call Groq API directly
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
                    "You are JARVIS, Tony Stark's AI assistant. Be concise, witty, and address the user as 'Sir'.",
                },
                { role: "user", content: prompt },
              ],
              max_tokens: 200,
            }),
          });

          const data = await response.json();
          const reply = data?.choices?.[0]?.message?.content || "I'm having trouble, Sir.";

          // 4. Return simple JSON (no streaming)
          return new Response(JSON.stringify({ reply }), { headers: { "Content-Type": "application/json" } });
        } catch (error: any) {
          // Return error as JSON
          return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
