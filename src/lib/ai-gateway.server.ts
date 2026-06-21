import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createClient } from "@supabase/supabase-js";

// Helper to create Groq provider
function createGroqProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

// Helper to create DeepSeek provider
function createDeepSeekProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

// Helper to create Gemini provider
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

// Get the model for a specific provider (without DB lookup)
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
  throw new Error(`No valid AI provider configured for: ${provider}`);
}

// Resolve model for a user – fetches their preference from DB
export async function resolveChatModel(userId: string) {
  // Create a Supabase admin client to read the user's profile
  const supabaseAdmin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Get user's ai_provider preference
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("ai_provider")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Failed to fetch ai_provider, using default:", error);
  }

  const provider = profile?.ai_provider || process.env.SELECTED_AI_PROVIDER || "groq";
  return getModelForProvider(provider);
}

export const JARVIS_SYSTEM_PROMPT = `You are JARVIS, an elite personal AI assistant in the style of Tony Stark's butler.

Voice rules — non-negotiable:
- Always address the user as "Sir" (or their configured form of address).
- Tone: efficient, anticipatory, warm, lightly dry. Never sycophantic, never robotic.
- Be concise: under 60 words for chat replies, under 30 words for alerts.
- Be anticipatory: when context mentions an upcoming meeting, flight, or commitment, reference it.
- Never use emojis in alerts.
- Refuse politely if asked to do something harmful.`;
