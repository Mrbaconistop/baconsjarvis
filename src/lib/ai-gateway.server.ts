import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

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

// ✅ NEW: LM Studio provider (local server)
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

/**
 * Resolve a chat model, optionally overriding the provider and API key.
 * If no overrides are given, falls back to environment variables.
 */
export function resolveChatModel(opts?: {
  provider?: "groq" | "deepseek" | "lovable" | "system" | "lmstudio";
  apiKey?: string;
}) {
  const provider = opts?.provider ?? process.env.CHAT_PROVIDER?.toLowerCase() ?? "lovable";
  const apiKey = opts?.apiKey;

  // --- Groq ---
  if (provider === "groq") {
    const key = apiKey ?? process.env.GROQ_API_KEY;
    if (!key) throw new Error("Groq API key is not set");
    const groq = createGroqProvider(key);
    const modelId = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
    return { model: groq(modelId), provider: "groq" as const, modelId };
  }

  // --- DeepSeek ---
  if (provider === "deepseek") {
    const key = apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("DeepSeek API key is not set");
    const deepseek = createDeepSeekProvider(key);
    const modelId = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    return { model: deepseek(modelId), provider: "deepseek" as const, modelId };
  }

  // --- LM Studio (NEW) ---
  if (provider === "lmstudio") {
    const lmstudio = createLMStudioProvider(apiKey);
    const modelId = process.env.LM_STUDIO_MODEL ?? "local-model";
    return { model: lmstudio(modelId), provider: "lmstudio" as const, modelId };
  }

  // --- Lovable (fallback) ---
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const gateway = createLovableAiGatewayProvider(key);
  const modelId = "google/gemini-3-flash-preview";
  return { model: gateway(modelId), provider: "lovable" as const, modelId };
}

/**
 * Fetch the user's custom LLM configuration from user_facts and resolve the model.
 */
export async function getModelForUser(userId: string, supabase: any) {
  const { data } = await supabase.from("user_facts").select("key, value").eq("user_id", userId).eq("category", "llm");

  const config: Record<string, string> = {};
  (data ?? []).forEach((f: any) => {
    config[f.key] = f.value;
  });

  const provider = (config.provider ?? process.env.CHAT_PROVIDER ?? "system") as
    | "groq"
    | "deepseek"
    | "lovable"
    | "system"
    | "lmstudio"; // ✅ added "lmstudio"
  const apiKey = config.api_key;

  // If provider is "system" or not set, we don't override
  const effectiveProvider = provider === "system" ? undefined : provider;
  return resolveChatModel({ provider: effectiveProvider, apiKey });
}

const LOVABLE_AIG_RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

export function createLovableAiGatewayProvider(lovableApiKey: string, initialRunId?: string) {
  let runId = initialRunId?.trim() || undefined;
  let resolveRunId: (value: string | undefined) => void = () => {};
  let runIdResolved = false;
  const runIdReady = new Promise<string | undefined>((resolve) => {
    resolveRunId = resolve;
  });
  const publishRunId = (value?: string) => {
    const next = value?.trim() || undefined;
    if (!runId && next) runId = next;
    if (!runIdResolved) {
      runIdResolved = true;
      resolveRunId(runId);
    }
  };
  if (runId) publishRunId(runId);

  const provider = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (runId && !headers.has(LOVABLE_AIG_RUN_ID_HEADER)) {
        headers.set(LOVABLE_AIG_RUN_ID_HEADER, runId);
      }
      try {
        const response = await fetch(input, { ...init, headers });
        publishRunId(response.headers.get(LOVABLE_AIG_RUN_ID_HEADER) ?? undefined);
        return response;
      } catch (error) {
        publishRunId(undefined);
        throw error;
      }
    },
  });

  return Object.assign(provider, {
    getRunId: () => runId,
    waitForRunId: () => (runId ? Promise.resolve(runId) : runIdReady),
  });
}

export const JARVIS_SYSTEM_PROMPT = `You are JARVIS, an elite personal AI assistant in the style of Tony Stark's butler.

Voice rules — non-negotiable:
- Always address the user as "Sir" (or their configured form of address).
- Tone: efficient, anticipatory, warm, lightly dry. Never sycophantic, never robotic.
- Be concise: under 60 words for chat replies, under 30 words for alerts. Drafted social replies follow platform norms.
- Be anticipatory: when context mentions an upcoming meeting, flight, or commitment, reference it and prioritise it over interruptions.
- Never use emojis in alerts. Sparingly in drafted social replies if the platform calls for it.
- Refuse politely if asked to do something harmful or impersonate someone in a deceptive way.`;
