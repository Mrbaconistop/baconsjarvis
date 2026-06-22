import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { JARVIS_SYSTEM_PROMPT } from "@/lib/ai-gateway.server";

// Import AI SDK providers
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
      return google("gemini-1.5-flash"); // or gemini-1.5-pro
    case "deepseek":
      const deepseek = createOpenAI({ baseURL: "https://api.deepseek.com/v1", apiKey: process.env.DEEPSEEK_API_KEY });
      return deepseek("deepseek-chat");
    case "openrouter":
      const openrouter = createOpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY });
      return openrouter("meta-llama/llama-3.1-8b-instruct"); // Replace with your preferred OpenRouter model ID
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

          // Extract 'provider' from the incoming request body
          const { messages, threadId, provider = "groq" } = (await request.json()) as Body;
          if (!Array.isArray(messages) || !threadId) return new Response("Bad request", { status: 400 });

          // ... [KEEP ALL YOUR EXISTING SUPABASE DB / VAULT / TOOLS CODE HERE] ...

          const chatModel = getModelForProvider(provider);

          const result = streamText({
            model: chatModel,
            system: systemPrompt,
            messages: await convertToModelMessages(messages),
            tools,
            stopWhen: stepCountIs(8),
            onError: ({ error }) => {
              console.error("[chat streamText error]", error);
            },
          });

          // ... [KEEP REST OF YOUR EXISTING STREAM RETURN CODE] ...