import { createDeepSeekProvider, createGroqProvider, createGeminiProvider } from "./ai-gateway.server";

export type Intent = "casual" | "code" | "reasoning" | "vision";
export type Provider = "deepseek" | "groq" | "gemini";

export interface RouterPrefs {
  preferGroqForCasual?: boolean;
  forceProvider?: Provider | null;
}

export interface RoutedModel {
  model: any;
  provider: Provider;
  modelId: string;
  intent: Intent;
}

// ---------- Intent classification (zero LLM cost) ----------
const CODE_HINTS = /\b(code|debug|function|error|stack ?trace|typescript|python|lua|roblox|regex|refactor|compile|fix|bug|snippet|script|api|json|yaml|sql|query|import|export|class|const|let|var|async|await|promise)\b/i;
const REASONING_HINTS = /\b(prove|why|explain how|analy[sz]e|derive|calculate|solve|equation|theorem|logic|step[- ]by[- ]step|reason|think|complex|philosophy|architect|design pattern|tradeoff)\b/i;
const CODE_FENCE = /```/;

export function classifyIntent(userMessage: string, hasImage: boolean): Intent {
  if (hasImage) return "vision";
  const text = (userMessage || "").slice(0, 4000);
  if (CODE_FENCE.test(text) || CODE_HINTS.test(text)) return "code";
  if (REASONING_HINTS.test(text) || text.length > 800) return "reasoning";
  return "casual";
}

// ---------- Provider availability ----------
export function hasProvider(p: Provider): boolean {
  if (p === "deepseek") return !!process.env.DEEPSEEK_API_KEY;
  if (p === "groq") return !!process.env.GROQ_API_KEY;
  if (p === "gemini") return !!process.env.LOVABLE_API_KEY || !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  return false;
}

// ---------- Pick primary + fallback chain ----------
export function buildChain(intent: Intent, prefs: RouterPrefs = {}): Provider[] {
  if (prefs.forceProvider && hasProvider(prefs.forceProvider)) {
    return [prefs.forceProvider, ...(["deepseek", "groq", "gemini"] as Provider[]).filter((p) => p !== prefs.forceProvider && hasProvider(p))];
  }

  let primary: Provider;
  if (intent === "vision") {
    primary = "gemini";
  } else if (intent === "casual" && prefs.preferGroqForCasual && hasProvider("groq")) {
    primary = "groq";
  } else {
    // deepseek is default for casual/code/reasoning
    primary = hasProvider("deepseek") ? "deepseek" : hasProvider("groq") ? "groq" : "gemini";
  }

  const chain: Provider[] = [primary];
  for (const p of ["deepseek", "groq", "gemini"] as Provider[]) {
    if (p !== primary && hasProvider(p)) chain.push(p);
  }
  return chain;
}

// ---------- Build actual AI SDK model ----------
export function buildModel(provider: Provider, intent: Intent): { model: any; modelId: string } {
  if (provider === "deepseek") {
    const key = process.env.DEEPSEEK_API_KEY!;
    const ds = createDeepSeekProvider(key);
    // Use reasoner for hard math/reasoning; chat for everything else
    const modelId = intent === "reasoning" ? (process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-reasoner") : (process.env.DEEPSEEK_MODEL ?? "deepseek-chat");
    return { model: ds(modelId) as any, modelId };
  }
  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY!;
    const groq = createGroqProvider(key);
    const modelId = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
    return { model: groq(modelId) as any, modelId };
  }
  // gemini via Lovable AI gateway or direct
  const key = process.env.LOVABLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (key && process.env.LOVABLE_API_KEY) {
    // Use Lovable AI gateway
    const { createOpenAICompatible } = require("@ai-sdk/openai-compatible");
    const gw = createOpenAICompatible({
      name: "lovable-ai",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: { "Lovable-API-Key": key, Authorization: `Bearer ${key}` },
    });
    const modelId = "google/gemini-3-flash-preview";
    return { model: gw(modelId) as any, modelId };
  }
  const gemini = createGeminiProvider(key!);
  const modelId = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  return { model: gemini(modelId) as any, modelId };
}

export function pickModel(userMessage: string, hasImage: boolean, prefs: RouterPrefs = {}): RoutedModel & { chain: Provider[] } {
  const intent = classifyIntent(userMessage, hasImage);
  const chain = buildChain(intent, prefs);
  const primary = chain[0] ?? "gemini";
  const { model, modelId } = buildModel(primary, intent);
  console.log(`[ROUTER] intent=${intent} chain=${chain.join(">")} → ${primary}/${modelId}`);
  return { model, modelId, provider: primary, intent, chain };
}
