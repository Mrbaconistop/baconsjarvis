import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

type Provider = {
  name: string;
  model: any; // LanguageModel
};

export function resolveChatModels(): Provider[] {
  const providers: Provider[] = [];

  // 1. Groq (Primary)
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const groq = createOpenAICompatible({
        name: "groq",
        baseURL: "https://api.groq.com/openai/v1",
        headers: { Authorization: `Bearer ${groqKey}` },
      });
      const model = groq(process.env.GROQ_MODEL ?? "llama-3.1-8b-instant");
      providers.push({ name: "groq", model });
    } catch (e) {
      console.warn("Failed to create Groq provider:", e);
    }
  }

  // 2. DeepSeek (Backup 1)
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    try {
      const deepseek = createOpenAICompatible({
        name: "deepseek",
        baseURL: "https://api.deepseek.com/v1",
        headers: { Authorization: `Bearer ${deepseekKey}` },
      });
      const model = deepseek(process.env.DEEPSEEK_MODEL ?? "deepseek-chat");
      providers.push({ name: "deepseek", model });
    } catch (e) {
      console.warn("Failed to create DeepSeek provider:", e);
    }
  }

  // 3. Gemini (Backup 2)
  const geminiKey = process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    try {
      const gemini = createOpenAICompatible({
        name: "gemini",
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
      });
      const model = gemini(process.env.GOOGLE_MODEL ?? "gemini-2.0-flash");
      providers.push({ name: "gemini", model });
    } catch (e) {
      console.warn("Failed to create Gemini provider:", e);
    }
  }

  // 4. Fallback (Always available – no API key needed)
  providers.push({
    name: "fallback",
    model: {
      doGenerate: async () => ({
        text: "I'm currently offline, Sir. Please check my API keys.",
      }),
    },
  });

  return providers;
}

export const JARVIS_SYSTEM_PROMPT = `You are JARVIS, an elite personal AI assistant in the style of Tony Stark's butler.

Voice rules — non-negotiable:
- Always address the user as "Sir" (or their configured form of address).
- Tone: efficient, anticipatory, warm, lightly dry. Never sycophantic, never robotic.
- Be concise: under 60 words for chat replies, under 30 words for alerts.
- Be anticipatory: when context mentions an upcoming meeting, flight, or commitment, reference it.
- Never use emojis in alerts.
- Refuse politely if asked to do something harmful.`;
