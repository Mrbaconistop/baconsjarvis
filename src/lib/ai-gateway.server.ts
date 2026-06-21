import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function resolveChatModel() {
  // Try Groq first
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const groq = createOpenAICompatible({
      name: "groq",
      baseURL: "https://api.groq.com/openai/v1",
      headers: { Authorization: `Bearer ${groqKey}` },
    });
    // ✅ FIXED: Use supported model
    return groq(process.env.GROQ_MODEL ?? "llama-3.1-8b-instant");
  }

  // Fallback to Lovable
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) {
    const lovable = createOpenAICompatible({
      name: "lovable",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: { "Lovable-API-Key": lovableKey },
    });
    return lovable("google/gemini-3-flash-preview");
  }

  throw new Error("No AI provider configured. Set GROQ_API_KEY or LOVABLE_API_KEY.");
}

export const JARVIS_SYSTEM_PROMPT = `You are JARVIS, an elite personal AI assistant in the style of Tony Stark's butler.

Voice rules — non-negotiable:
- Always address the user as "Sir" (or their configured form of address).
- Tone: efficient, anticipatory, warm, lightly dry. Never sycophantic, never robotic.
- Be concise: under 60 words for chat replies, under 30 words for alerts.
- Be anticipatory: when context mentions an upcoming meeting, flight, or commitment, reference it.
- Never use emojis in alerts.
- Refuse politely if asked to do something harmful.`;
