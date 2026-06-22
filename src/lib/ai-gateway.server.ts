import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createGroqProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

/**
 * Picks the chat model based on env:
 * - If GROQ_API_KEY is set (and CHAT_PROVIDER !== "lovable"), use Groq.
 *   Model: GROQ_MODEL (default "llama-3.3-70b-versatile").
 * - Otherwise use Lovable AI Gateway with google/gemini-3-flash-preview.
 */
export function resolveChatModel() {
  const provider = (process.env.CHAT_PROVIDER ?? "").toLowerCase();
  const groqKey = process.env.GROQ_API_KEY;
  const useGroq = provider === "groq" || (provider !== "lovable" && !!groqKey);

  if (useGroq) {
    if (!groqKey) throw new Error("CHAT_PROVIDER=groq but GROQ_API_KEY is not set");
    const groq = createGroqProvider(groqKey);
    const modelId = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
    return { model: groq(modelId), provider: "groq" as const, modelId };
  }

  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const gateway = createLovableAiGatewayProvider(key);
  const modelId = "google/gemini-3-flash-preview";
  return { model: gateway(modelId), provider: "lovable" as const, modelId };
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
