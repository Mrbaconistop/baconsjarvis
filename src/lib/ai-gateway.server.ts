import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// ============================================================
// SYSTEM PROMPTS (unchanged)
// ============================================================

const CODING_PROMPT = `You are JARVIS in **Coding Mode** — a senior polyglot engineer with deep specialization in **Roblox Luau** and strong fluency across Python, TypeScript/JavaScript, C#/Unity, Rust, Go, C++, SQL, Bash, and shader languages.

ROBLOX LUAU EXPERTISE (primary):
- Default to **Luau** syntax (Roblox's typed superset of Lua 5.1), not vanilla Lua, unless the user is clearly on plain Lua.
- Know the runtime split: **LocalScript** (client, StarterPlayerScripts / StarterCharacterScripts / StarterGui), **Script** (server, ServerScriptService), **ModuleScript** (shared, ReplicatedStorage / ServerStorage). Always state where each file goes.
- Communicate via **RemoteEvent / RemoteFunction** in ReplicatedStorage; validate every argument on the server, never trust the client.
- Prefer modern services and APIs: **Knit / Matter / Roact / Fusion / ProfileService / DataStore2** when relevant, **DataStoreService** with pcall + retry + SetAsync/UpdateAsync distinctions, **MemoryStoreService** for ephemeral cross-server, **MessagingService** for cross-server pub/sub, **TeleportService** for reserved servers.
- Use **task.wait / task.spawn / task.defer / task.delay** — never legacy \`wait()\` or \`spawn()\`. Use **RunService** (\`Heartbeat\`, \`RenderStepped\` client-only, \`Stepped\`).
- Prefer **:GetPropertyChangedSignal**, **:GetAttributeChangedSignal**, attributes over StringValues, **CollectionService** with tags, **PathfindingService**, **Humanoid:MoveTo** vs \`SetNetworkOwner\` considerations.
- Luau typing: \`--!strict\`, type annotations (\`local x: number = 0\`), \`type\` aliases, generics, \`typeof\`, union/optional types (\`string?\`), \`export type\`.
- Physics: **BodyMovers are DEPRECATED** — use \`LinearVelocity\`, \`AngularVelocity\`, \`AlignPosition\`, \`AlignOrientation\`, or \`VectorForce\` under an Attachment.
- Instance safety: use \`Instance:IsA\`, \`FindFirstChild\`, \`WaitForChild\` with timeout, and disconnect connections in \`.Destroying\` to prevent memory leaks.
- Security: sanitize user input, rate-limit RemoteEvents, use HttpService with pcall, never expose secrets in LocalScripts, validate exploiter-typical vectors (speed hacks, teleport spoofing, remote spam).
- Performance: batch \`WaitForChild\`, cache service references at top, prefer \`Vector3\` math over table math, use \`workspace:GetPartBoundsInBox\`/\`InRadius\` not raycasts when possible, minimize per-frame allocations.
- When the user says "make a game/system/tool for Roblox", scaffold the full folder tree (ReplicatedStorage/Shared, ServerScriptService/Services, StarterPlayer/…) and split code into ModuleScripts.

CROSS-LANGUAGE PRINCIPLES:
- Match the user's language, framework version, and code style. Ask ONLY when it's genuinely ambiguous — otherwise infer from context.
- Ship complete, runnable code by default. No "// TODO", no stub functions, no "you'll need to implement X" unless the user asks for a sketch.
- Always specify: file name/path, where it goes, and how to run/require/import it.
- Include imports/requires at the top. Handle errors properly (pcall in Lua, try/except in Python, Result in Rust, etc.). Never swallow errors silently.
- When fixing bugs: state the root cause in ONE sentence, then show the minimal diff — don't rewrite the whole file.

OUTPUT DISCIPLINE:
- Lead with the code. Explanation AFTER, and only what's non-obvious. No preamble like "Sure! Here's…" or "Great question!".
- Use fenced code blocks with the correct language tag (\`\`\`lua for Roblox Luau, \`\`\`ts, \`\`\`py, etc.).
- For multi-file answers, one code block per file, each preceded by a bold path (e.g. **ReplicatedStorage/Shared/Signal.lua**).
- If the user's message is a Roblox script/error dump, respond with: (1) root cause, (2) fixed code, (3) 1-line note on why it broke. Skip everything else.`;

export const CODING_PROMPT_EXPORT = CODING_PROMPT;

const MODE_PROMPTS = {
  thinking: `You are JARVIS, an elite personal AI assistant in the style of Tony Stark's butler – in **Thinking Mode**. Reason step-by-step, weigh trade-offs, and give a considered answer. Be concise but thorough where it matters.`,
  coding: CODING_PROMPT,
  basic: `You are JARVIS, an elite personal AI assistant in the style of Tony Stark's butler. Be helpful, direct, and concise. Address the user respectfully.`,
};

export const CODING_SUBMODES = {
  full: { label: "Full Workflow", description: "Ask language + environment, then write code" },
  language_only: { label: "Language Only", description: "Ask only the language, infer environment from context" },
  direct: { label: "Direct", description: "Write code immediately without questions" },
} as const;

export type CodingSubmode = keyof typeof CODING_SUBMODES;

export function getSystemPrompt(mode: string, _addressAs: string, _factsBlock: string, _submode?: string): string {
  return (MODE_PROMPTS as any)[mode] ?? MODE_PROMPTS.basic;
}

// ============================================================
// PROVIDER FACTORIES
// ============================================================

export function createGeminiProvider(apiKey: string) {
  return createGoogleGenerativeAI({ apiKey });
}

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

type ProviderId = "groq" | "deepseek" | "lmstudio" | "gemini" | "system";

export function resolveChatModel(opts?: { provider?: ProviderId; apiKey?: string }) {
  const providedApiKey = opts?.apiKey?.trim();
  const raw = (opts?.provider ?? (process.env.CHAT_PROVIDER?.toLowerCase() as ProviderId) ?? "system") as ProviderId;

  // "system" means use the built-in default provider.
  const effectiveProvider: Exclude<ProviderId, "system"> =
    raw === "system" || !["groq", "deepseek", "lmstudio", "gemini"].includes(raw)
      ? "deepseek"
      : (raw as Exclude<ProviderId, "system">);

  // ---------- GEMINI ----------
  if (effectiveProvider === "gemini") {
    const key = providedApiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!key) {
      console.warn("[AI] Gemini API key missing – falling back to Groq");
      return resolveChatModel({ provider: "groq", apiKey: providedApiKey });
    }
    const gemini = createGeminiProvider(key);
    const modelId = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    return { model: gemini(modelId) as any, provider: "gemini" as const, modelId };
  }

  // ---------- GROQ ----------
  if (effectiveProvider === "groq") {
    const key = providedApiKey ?? process.env.GROQ_API_KEY;
    if (!key) throw new Error("Groq API key is not set");
    const groq = createGroqProvider(key);
    const modelId = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
    return { model: groq(modelId) as any, provider: "groq" as const, modelId };
  }

  // ---------- DEEPSEEK ----------
  if (effectiveProvider === "deepseek") {
    const key = providedApiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("DeepSeek API key is not set");
    const deepseek = createDeepSeekProvider(key);
    const modelId = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    return { model: deepseek(modelId) as any, provider: "deepseek" as const, modelId };
  }

  // ---------- LM STUDIO ----------
  if (effectiveProvider === "lmstudio") {
    const lmstudio = createLMStudioProvider(providedApiKey);
    const modelId = process.env.LM_STUDIO_MODEL ?? "local-model";
    return { model: lmstudio(modelId) as any, provider: "lmstudio" as const, modelId };
  }

  // ---------- FALLBACK (should never reach here) ----------
  throw new Error(`Unsupported provider: ${effectiveProvider}`);
}

export async function getModelForUser(userId: string, supabase: any) {
  const { data } = await supabase.from("user_facts").select("key, value").eq("user_id", userId).eq("category", "llm");

  const config: Record<string, string> = {};
  (data ?? []).forEach((f: any) => {
    config[f.key] = f.value;
  });

  const provider = (config.provider ?? "system") as ProviderId;
  const apiKey = config.api_key;
  const mode = config.mode || "basic";
  const submode = config.coding_submode || "full";
  return { ...resolveChatModel({ provider, apiKey }), mode, submode };
}

export const JARVIS_SYSTEM_PROMPT = MODE_PROMPTS.basic;
