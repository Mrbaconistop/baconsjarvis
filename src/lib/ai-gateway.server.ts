import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Helper to create Groq provider
function createGroqProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

// Helper to create DeepSeek provider (OpenAI-compatible)
function createDeepSeekProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

// Helper to create Gemini provider (using OpenAI-compatible format)
function createGeminiProvider(apiKey: string) {
  // Gemini uses a different base URL – but we can use it with the OpenAI-compatible wrapper
  return createOpenAICompatible({
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
  });
}

export function resolveChatModel() {
  const groqKey = process.env.GROQ_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const geminiKey = process.env.GOOGLE_API_KEY;

  // 1. Primary: Groq
  if (groqKey) {
    const groq = createGroqProvider(groqKey);
    return groq(process.env.GROQ_MODEL ?? "llama-3.1-8b-instant");
  }

  // 2. Backup 1: DeepSeek
  if (deepseekKey) {
    const deepseek = createDeepSeekProvider(deepseekKey);
    return deepseek(process.env.DEEPSEEK_MODEL ?? "deepseek-chat");
  }

  // 3. Backup 2: Gemini
  if (geminiKey) {
    const gemini = createGeminiProvider(geminiKey);
    return gemini(process.env.GOOGLE_MODEL ?? "gemini-2.0-flash");
  }

  // 4. No provider available
  throw new Error("No AI provider configured. Set GROQ_API_KEY, DEEPSEEK_API_KEY, or GOOGLE_API_KEY.");
}

export const JARVIS_SYSTEM_PROMPT = `You are JARVIS, an elite personal AI assistant in the style of Tony Stark's butler.

Voice rules — non-negotiable:
- Always address the user as "Sir" (or their configured form of address).
- Tone: efficient, anticipatory, warm, lightly dry. Never sycophantic, never robotic.
- Be concise: under 60 words for chat replies, under 30 words for alerts.
- Be anticipatory: when context mentions an upcoming meeting, flight, or commitment, reference it.
- Never use emojis in alerts.
- Refuse politely if asked to do something harmful.`;
