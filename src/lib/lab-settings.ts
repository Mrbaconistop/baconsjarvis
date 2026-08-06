// Lua Lab settings — knowledge, rules, API references, corrections and chat memory.
// Client-side only (localStorage), no backend cost.

export type Correction = { id: string; mistake: string; correction: string; at: number };
export type LabMessage = { id: string; role: "user" | "assistant"; content: string; at: number };
export type ApiKeyEntry = { id: string; name: string; key: string; isActive: boolean };

export type LabSettings = {
  knowledge: string[];
  rules: string[];
  apiRefs: string[];
  corrections: Correction[];
  memory: LabMessage[];
  apiKeys: ApiKeyEntry[];
};

const KEY = "lua-lab.settings.v1";

export const DEFAULT_LAB_SETTINGS: LabSettings = {
  knowledge: [],
  rules: [],
  apiRefs: [],
  corrections: [],
  memory: [],
  apiKeys: [],
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadLabSettings(): LabSettings {
  if (typeof window === "undefined") return { ...DEFAULT_LAB_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_LAB_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<LabSettings>;
    return {
      knowledge: Array.isArray(parsed.knowledge) ? parsed.knowledge.map(String) : [],
      rules: Array.isArray(parsed.rules) ? parsed.rules.map(String) : [],
      apiRefs: Array.isArray(parsed.apiRefs) ? parsed.apiRefs.map(String) : [],
      corrections: Array.isArray(parsed.corrections)
        ? parsed.corrections
            .filter((c: any) => c && typeof c.correction === "string")
            .map((c: any) => ({
              id: String(c.id ?? uid()),
              mistake: String(c.mistake ?? ""),
              correction: String(c.correction ?? ""),
              at: Number(c.at ?? Date.now()),
            }))
        : [],
      memory: Array.isArray(parsed.memory)
        ? parsed.memory
            .filter((m: any) => m && (m.role === "user" || m.role === "assistant"))
            .map((m: any) => ({
              id: String(m.id ?? uid()),
              role: m.role as "user" | "assistant",
              content: String(m.content ?? ""),
              at: Number(m.at ?? Date.now()),
            }))
        : [],
    };
  } catch {
    return { ...DEFAULT_LAB_SETTINGS };
  }
}

export function saveLabSettings(s: LabSettings) {
  if (typeof window === "undefined") return;
  try {
    // keep memory bounded so localStorage never blows up
    const trimmed: LabSettings = { ...s, memory: s.memory.slice(-200) };
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* quota — ignore */
  }
}

export function makeCorrection(mistake: string, correction: string): Correction {
  return { id: uid(), mistake: mistake.trim(), correction: correction.trim(), at: Date.now() };
}

export function makeMessage(role: LabMessage["role"], content: string): LabMessage {
  return { id: uid(), role, content, at: Date.now() };
}
