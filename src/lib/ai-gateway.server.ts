import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// ============================================================
// Provider factories
// ============================================================

function createGroqProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

function createDeepSeekProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

function createGeminiProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
  });
}

// ============================================================
// Get model for a given provider
// ============================================================

export function getModelForProvider(provider: string) {
  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY not set");
    const groq = createGroqProvider(key);
    return groq(process.env.GROQ_MODEL ?? "llama-3.1-8b-instant");
  }
  if (provider === "deepseek") {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("DEEPSEEK_API_KEY not set");
    const deepseek = createDeepSeekProvider(key);
    return deepseek(process.env.DEEPSEEK_MODEL ?? "deepseek-chat");
  }
  if (provider === "gemini") {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw new Error("GOOGLE_API_KEY not set");
    const gemini = createGeminiProvider(key);
    return gemini(process.env.GOOGLE_MODEL ?? "gemini-2.0-flash");
  }
  // Fallback to Groq
  const fallbackKey = process.env.GROQ_API_KEY;
  if (fallbackKey) {
    const groq = createGroqProvider(fallbackKey);
    return groq(process.env.GROQ_MODEL ?? "llama-3.1-8b-instant");
  }
  throw new Error(`No valid AI provider for: ${provider}`);
}

// ============================================================
// Resolve model for a user (using authenticated supabase client)
// ============================================================

export async function resolveChatModel(userId: string, supabaseClient: any) {
  try {
    const { data: profile, error } = await supabaseClient
      .from("profiles")
      .select("ai_provider")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      if (error.message?.includes("column") && error.message?.includes("does not exist")) {
        console.warn("ai_provider column missing – using default");
        return getModelForProvider("groq");
      }
      throw error;
    }

    const provider = profile?.ai_provider || "groq";
    console.log(`[JARVIS] Using AI provider: ${provider}`);
    return getModelForProvider(provider);
  } catch (error) {
    console.warn("Failed to fetch user AI preference, using default:", error);
    return getModelForProvider("groq");
  }
}

// ============================================================
// System prompt
// ============================================================

export const JARVIS_SYSTEM_PROMPT = `You are JARVIS, an elite personal AI assistant in the style of Tony Stark's butler.

Voice rules — non-negotiable:
- Always address the user as "Sir" (or their configured form of address).
- Tone: efficient, anticipatory, warm, lightly dry. Never sycophantic, never robotic.
- Be concise: under 60 words for chat replies, under 30 words for alerts.
- Be anticipatory: when context mentions an upcoming meeting, flight, or commitment, reference it.
- Never use emojis in alerts.
- Refuse politely if asked to do something harmful.`;
