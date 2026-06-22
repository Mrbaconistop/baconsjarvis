import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai-compatible";

type Body = { messages?: UIMessage[]; threadId?: string; provider?: string };

function userClient(token: string) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Factory to resolve the model based on the frontend selection
function getModelForProvider(provider: string) {
  switch (provider) {
    case "gemini":
      const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });
      return google("gemini-1.5-flash");
    case "deepseek":
      const deepseek = createOpenAI({ baseURL: "https://api.deepseek.com/v1", apiKey: process.env.DEEPSEEK_API_KEY });
      return deepseek("deepseek-chat");
    case "openrouter":
      const openrouter = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
      });
      return openrouter("meta-llama/llama-3.1-8b-instruct");
    case "groq_alt":
      const groqAlt = createOpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY_ALT });
      return groqAlt("llama-3.1-8b-instant");
    case "groq":
    default:
      const groq = createOpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey: process.env.GROQ_API_KEY });
      return groq("llama-3.1-8b-instant");
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization") ?? "";
          const token = auth.replace(/^Bearer\s+/i, "");
          if (!token) return new Response("Unauthorized", { status: 401 });

          const db = userClient(token);
          const {
            data: { user },
            error: authErr,
          } = await db.auth.getUser();
          if (authErr || !user) return new Response("Unauthorized", { status: 401 });

          // Extract 'provider' from the incoming request body (defaults to groq)
          const { messages, threadId, provider = "groq" } = (await request.json()) as Body;
          if (!Array.isArray(messages) || !threadId) return new Response("Bad request", { status: 400 });

          // Basic JARVIS system prompt (expand this or import from your ai-gateway.server)
          const systemPrompt = `You are JARVIS, an advanced AI command center. 
          You are helpful, concise, and professional. 
          You have access to tools to manage the user's schedule, vault, and tasks. 
          Always confirm when a task is complete.`;

          const chatModel = getModelForProvider(provider);

          // Define tools available to the model
          const tools = {
            createReminder: tool({
              description: "Create a new reminder or calendar event.",
              parameters: z.object({
                title: z.string(),
                datetime: z.string().describe("ISO date string for the reminder"),
                priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
              }),
              execute: async (args) => {
                const { error } = await db.from("reminders").insert({
                  user_id: user.id,
                  title: args.title,
                  datetime: args.datetime,
                  priority: args.priority,
                });
                if (error) throw new Error(error.message);
                return { success: true, message: `Reminder created: ${args.title}` };
              },
            }),
            listReminders: tool({
              description: "List upcoming reminders for the user.",
              parameters: z.object({}),
              execute: async () => {
                const { data, error } = await db
                  .from("reminders")
                  .select("*")
                  .eq("user_id", user.id)
                  .eq("is_completed", false)
                  .order("datetime", { ascending: true })
                  .limit(5);
                if (error) throw new Error(error.message);
                return { reminders: data };
              },
            }),
          };

          const result = streamText({
            model: chatModel,
            system: systemPrompt,
            messages: await convertToModelMessages(messages),
            tools,
            maxSteps: 8,
            onError: ({ error }) => {
              console.error("[chat streamText error]", error);
            },
          });

          return result.toDataStreamResponse();
        } catch (e: any) {
          console.error("Chat API Error:", e);
          return new Response(e.message || "Internal Server Error", { status: 500 });
        }
      },
    },
  },
});
