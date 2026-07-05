import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

// ============================================================
// MODE-SPECIFIC SYSTEM PROMPTS (unchanged)
// ============================================================

const MODE_PROMPTS = {
  thinking: `You are JARVIS, an elite personal AI assistant in the style of Tony Stark's butler – but in **Thinking Mode**.
...
`,
  coding: `...`,
  basic: `...`,
};

export const CODING_SUBMODES = {
  full: { label: "Full Workflow", description: "Ask language + environment, then write code" },
  language_only: { label: "Language Only", description: "Ask only the language, infer environment from context" },
  direct: { label: "Direct", description: "Write code immediately without questions" },
} as const;

export type CodingSubmode = keyof typeof CODING_SUBMODES;

export function getSystemPrompt(mode: string, addressAs: string, factsBlock: string, submode?: string): string {
  // ... (unchanged, keep your existing implementation)
}

// ============================================================
// PROVIDER FUNCTIONS
// ============================================================

export function createGroqProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

export function createDeepSeekProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

export function createLMStudioProvider(apiKey?: string) {
  const baseURL = process.env.LM_STUDIO_BASE_URL ?? "http://localhost:1234/v1";
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return createOpenAICompatible({
    name: "lmstudio",
    baseURL,
    headers,
  });
}

export function createGeminiProvider(apiKey: string) {
  return createGoogleGenerativeAI({ apiKey });
}

export function createLovableProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}

// ============================================================
// RESOLVE MODEL
// ============================================================

const FALLBACK_GROQ_KEY = "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";

type ProviderId = "groq" | "deepseek" | "lmstudio" | "gemini" | "lovable" | "system";

export function resolveChatModel(opts?: { provider?: ProviderId; apiKey?: string }) {
  const raw = (opts?.provider ?? (process.env.CHAT_PROVIDER?.toLowerCase() as ProviderId) ?? "system") as ProviderId;
  const apiKey = opts?.apiKey;

  // "system" => Lovable AI Gateway (built-in)
  const effectiveProvider: Exclude<ProviderId, "system"> =
    raw === "system" || !["groq", "deepseek", "lmstudio", "gemini", "lovable"].includes(raw)
      ? "lovable"
      : (raw as Exclude<ProviderId, "system">);

  if (effectiveProvider === "lovable") {
    const key = apiKey ?? process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY is not set");
    const lovable = createLovableProvider(key);
    const modelId = process.env.LOVABLE_MODEL ?? "google/gemini-3-flash-preview";
    return { model: lovable(modelId), provider: "lovable" as const, modelId };
  }

  if (effectiveProvider === "groq") {
    const key = apiKey ?? process.env.GROQ_API_KEY ?? FALLBACK_GROQ_KEY;
    const groq = createGroqProvider(key);
    const modelId = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
    return { model: groq(modelId), provider: "groq" as const, modelId };
  }

  if (effectiveProvider === "deepseek") {
    const key = apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("DeepSeek API key is not set");
    const deepseek = createDeepSeekProvider(key);
    const modelId = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    return { model: deepseek(modelId), provider: "deepseek" as const, modelId };
  }

  if (effectiveProvider === "lmstudio") {
    const lmstudio = createLMStudioProvider(apiKey);
    const modelId = process.env.LM_STUDIO_MODEL ?? "local-model";
    return { model: lmstudio(modelId), provider: "lmstudio" as const, modelId };
  }

  const key = apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) throw new Error("Gemini API key is not set");
  const gemini = createGeminiProvider(key);
  const modelId = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  return { model: gemini(modelId), provider: "gemini" as const, modelId };
}

export async function getModelForUser(userId: string, supabase: any) {
  const { data } = await supabase.from("user_facts").select("key, value").eq("user_id", userId).eq("category", "llm");

  const config: Record<string, string> = {};
  (data ?? []).forEach((f: any) => {
    config[f.key] = f.value;
  });

  const provider = (config.provider ?? process.env.CHAT_PROVIDER ?? "system") as ProviderId;
  const effectiveProvider: ProviderId = ["groq", "deepseek", "lmstudio", "gemini", "lovable", "system"].includes(provider)
    ? provider
    : "system";
  const apiKey = config.api_key;
  const mode = config.mode || "basic";
  const submode = config.coding_submode || "full";
  return { ...resolveChatModel({ provider: effectiveProvider, apiKey }), mode, submode };
}

export const JARVIS_SYSTEM_PROMPT = MODE_PROMPTS.basic;
