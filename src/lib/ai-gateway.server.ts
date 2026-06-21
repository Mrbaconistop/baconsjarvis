import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Fallback provider (always works)
const fallback = {
  name: "fallback",
  getModel: () => ({
    doGenerate: async () => ({
      text: "I'm in offline mode, Sir. Please check my API keys.",
    }),
  }),
  modelId: "fallback",
};

export function resolveChatModel() {
  const chain: any[] = [];

  // 1. Groq
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
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
  }

  // 2. DeepSeek
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
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
  }

  // 3. Google Gemini (if @ai-sdk/google is installed)
  // Skip for now – we can add later

  // Always add fallback at the end
  chain.push(fallback);

  return chain;
}

export const JARVIS_SYSTEM_PROMPT = `
You are JARVIS, Tony Stark's AI assistant.
- Address the user as "Sir".
- Be concise, efficient, and slightly witty.
- Never say "as an AI".
- Keep replies under 3 sentences unless asked.
`;
