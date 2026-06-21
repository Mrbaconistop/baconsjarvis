import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function resolveChatModel() {
  const chain: any[] = [];

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
    } catch (e) {}
  }

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
    } catch (e) {}
  }

  chain.push({
    name: "fallback",
    getModel: () => ({
      doGenerate: async () => ({
        text: "I'm offline, Sir.",
      }),
    }),
    modelId: "fallback",
  });

  return chain;
}

export const JARVIS_SYSTEM_PROMPT = `
You are JARVIS, Tony Stark's AI assistant.
- Address the user as "Sir".
- Be concise, efficient, and slightly witty.
- Never say "as an AI".
- Keep replies under 3 sentences unless asked.
`;
