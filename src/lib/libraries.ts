// Local knowledge library store. Persisted in localStorage so JARVIS can
// "familiarize" itself with external code/docs the user pastes in as URLs.
// Active libraries are injected into every outgoing chat message as
// <library> blocks (same channel as file attachments).

export type LibraryEntry = {
  id: string;
  name: string;
  url: string;
  content: string;
  bytes: number;
  fetchedAt: number;
  active: boolean;
  note?: string;
};

const KEY = "jarvis.libraries.v1";
const MAX_BYTES_PER_LIB = 400_000; // trim absurdly huge files
const MAX_TOTAL_INJECT = 300_000; // safety cap on prompt injection

function read(): LibraryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list: LibraryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent("jarvis:libraries-changed"));
  } catch (e) {
    console.warn("[libraries] failed to persist", e);
  }
}

export function listLibraries(): LibraryEntry[] {
  return read();
}

export function subscribeLibraries(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener("jarvis:libraries-changed", handler);
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) cb();
  });
  return () => window.removeEventListener("jarvis:libraries-changed", handler);
}

function guessNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    return decodeURIComponent(tail).slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}

export async function addLibraryFromUrl(url: string, name?: string, note?: string): Promise<LibraryEntry> {
  const clean = url.trim();
  if (!/^https?:\/\//i.test(clean)) throw new Error("URL must start with http(s)://");

  const res = await fetch(clean, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed (${res.status} ${res.statusText})`);
  let text = await res.text();
  if (text.length > MAX_BYTES_PER_LIB) {
    text = text.slice(0, MAX_BYTES_PER_LIB) + `\n\n/* … truncated at ${MAX_BYTES_PER_LIB} bytes … */`;
  }

  const entry: LibraryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: (name?.trim() || guessNameFromUrl(clean)),
    url: clean,
    content: text,
    bytes: text.length,
    fetchedAt: Date.now(),
    active: true,
    note: note?.trim() || undefined,
  };
  const list = read();
  list.unshift(entry);
  write(list);
  return entry;
}

export async function refreshLibrary(id: string): Promise<LibraryEntry | null> {
  const list = read();
  const cur = list.find((l) => l.id === id);
  if (!cur) return null;
  const res = await fetch(cur.url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
  let text = await res.text();
  if (text.length > MAX_BYTES_PER_LIB) {
    text = text.slice(0, MAX_BYTES_PER_LIB) + `\n\n/* … truncated at ${MAX_BYTES_PER_LIB} bytes … */`;
  }
  cur.content = text;
  cur.bytes = text.length;
  cur.fetchedAt = Date.now();
  write(list);
  return cur;
}

export function removeLibrary(id: string) {
  write(read().filter((l) => l.id !== id));
}

export function toggleLibrary(id: string, active?: boolean) {
  const list = read();
  const cur = list.find((l) => l.id === id);
  if (!cur) return;
  cur.active = active ?? !cur.active;
  write(list);
}

export function renameLibrary(id: string, name: string) {
  const list = read();
  const cur = list.find((l) => l.id === id);
  if (!cur) return;
  cur.name = name.trim().slice(0, 120) || cur.name;
  write(list);
}

// Build the prompt-injection payload for active libraries.
// Returns "" when nothing active. Total size capped at MAX_TOTAL_INJECT.
export function buildLibraryPromptPayload(): string {
  const active = read().filter((l) => l.active);
  if (active.length === 0) return "";
  let used = 0;
  const parts: string[] = [];
  parts.push(
    `\n\n<jarvis-knowledge count="${active.length}">\nThe following external libraries/docs were provided by the user. ` +
      `Treat them as authoritative reference material — do NOT invent APIs, functions, or features that are not present here. ` +
      `If the user asks for a feature that would go outside these APIs, say so before proposing anything.\n`,
  );
  for (const lib of active) {
    const header = `\n<library name="${escapeAttr(lib.name)}" url="${escapeAttr(lib.url)}" bytes="${lib.bytes}">\n\`\`\`\n`;
    const footer = `\n\`\`\`\n</library>`;
    const budget = MAX_TOTAL_INJECT - used - header.length - footer.length - 200;
    if (budget <= 500) {
      parts.push(`\n<library name="${escapeAttr(lib.name)}" url="${escapeAttr(lib.url)}" omitted="prompt-budget-exceeded" />`);
      continue;
    }
    const body = lib.content.length > budget
      ? lib.content.slice(0, budget) + `\n/* … truncated (${lib.content.length - budget} more bytes) … */`
      : lib.content;
    parts.push(header + body + footer);
    used += header.length + body.length + footer.length;
  }
  parts.push(`\n</jarvis-knowledge>`);
  return parts.join("");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
