import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Brain, Loader2, Send, Trash2, BookOpen, Plug, Search, ShieldCheck, KeyRound, Rocket } from "lucide-react";
import { chatLuaLab, fixLuaCode, projectBlueprint, generateProjectModule } from "@/lib/lua-lab.functions";
import { RULES, validate, loadRuleToggles, type Lang } from "@/lib/lua-rules";
import {
  loadLabSettings,
  saveLabSettings,
  makeCorrection,
  makeMessage,
  type LabSettings,
  type ApiKeyEntry,
} from "@/lib/lab-settings";

type VaultSnippet = { id: string; title: string; code: string; description?: string };
type Hit = { id: string; title: string; score: number; excerpt: string };

const MISTAKE_RE =
  /\b(you (made|had) a mistake|that'?s wrong|thats wrong|that is wrong|you'?re wrong|youre wrong|that'?s incorrect|incorrect|that'?s broken|thats broken|doesn'?t work|does not work|wrong again|bad code)\b/i;
const YES_RE = /^\s*(y|ya|yes|yeah|yep|sure|ok|okay|do it|please do|affirmative)\b/i;
const NO_RE = /^\s*(n|no|nope|nah|don'?t|do not|negative)\b/i;

const CLARIFY_Q = "What specifically was wrong? Can you describe what you expected?";
const CONFIRM_Q = "Should I remember this correction for future generations?";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const is429 = (e: any) => /429|rate limit|too many requests/i.test(String(e?.message ?? e));


function searchVault(query: string, snippets: VaultSnippet[]): Hit[] {
  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_]+/i)
        .filter((t) => t.length > 2),
    ),
  );
  if (!terms.length) return [];
  const hits: Hit[] = [];
  for (const s of snippets) {
    const hay = `${s.title}\n${s.description ?? ""}\n${s.code}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      const n = hay.split(t).length - 1;
      if (n) score += Math.min(n, 8) + (s.title.toLowerCase().includes(t) ? 5 : 0);
    }
    if (score > 0) {
      hits.push({ id: s.id, title: s.title, score, excerpt: s.code.split(/\r?\n/).slice(0, 60).join("\n").slice(0, 2500) });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 4);
}

export default function LuaLabPanel({
  snippets,
  language = "luau",
  onSelectSnippet,
  onSaveSnippet,
}: {
  snippets: VaultSnippet[];
  language?: Lang;
  onSelectSnippet?: (id: string) => void;
  onSaveSnippet?: (s: { title: string; description: string; code: string; language: string }) => void;
}) {
  const [settings, setSettings] = useState<LabSettings>(() => loadLabSettings());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [pending, setPending] = useState<null | { stage: "detail" | "confirm"; mistake: string; correction: string }>(null);
  const [tab, setTab] = useState<"chat" | "knowledge" | "corrections" | "keys">("chat");
  const [draftKnowledge, setDraftKnowledge] = useState("");
  const [draftApi, setDraftApi] = useState("");
  const [keyName, setKeyName] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [showFactory, setShowFactory] = useState(false);
  const [projectDesc, setProjectDesc] = useState("");
  const [progress, setProgress] = useState<null | { pct: number; label: string; startedAt: number }>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const chat = useServerFn(chatLuaLab);
  const fixCode = useServerFn(fixLuaCode);
  const blueprint = useServerFn(projectBlueprint);
  const genModule = useServerFn(generateProjectModule);

  useEffect(() => {
    saveLabSettings(settings);
  }, [settings]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [settings.memory, busy]);

  const activeRules = useMemo(
    () => RULES.filter((r) => r.langs.includes(language)).map((r) => `${r.label}: ${r.description}`),
    [language],
  );

  function push(role: "user" | "assistant", content: string) {
    setSettings((s) => ({ ...s, memory: [...s.memory, makeMessage(role, content)] }));
  }

  function storeCorrection(mistake: string, correction: string) {
    setSettings((s) => ({ ...s, corrections: [makeCorrection(mistake, correction), ...s.corrections].slice(0, 200) }));
  }

  // ---- API key helpers (rotation for rate-limit bypass) ----
  function keyPool(): ApiKeyEntry[] {
    return settings.apiKeys.filter((k) => k.key.trim());
  }
  function activeKey(): string | undefined {
    const pool = keyPool();
    return (pool.find((k) => k.isActive) ?? pool[0])?.key;
  }
  function keyForIndex(i: number): string | undefined {
    const pool = keyPool();
    if (!pool.length) return undefined;
    const activeIdx = Math.max(0, pool.findIndex((k) => k.isActive));
    return pool[(activeIdx + i) % pool.length].key;
  }
  function requireKey(): string | null {
    const k = activeKey();
    if (!k) {
      toast.error("Please add and activate an API key first.");
      return null;
    }
    return k;
  }

  function ctx(vault: { title: string; excerpt: string }[], apiKey?: string) {
    return {
      language,
      rules: activeRules,
      mistakes: [],
      corrections: settings.corrections.map((c) => ({ mistake: c.mistake, correction: c.correction })),
      knowledge: settings.knowledge,
      apiRefs: settings.apiRefs,
      vault,
      apiKey,
    };
  }

  // Retries once after 60s on 429 (rate limit protection).
  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      if (!is429(e)) throw e;
      setProgress((p) => (p ? { ...p, label: "Rate limited — waiting 60s…" } : p));
      await sleep(60000);
      return await fn();
    }
  }

  async function runFactory() {
    if (busy) return;
    const desc = projectDesc.trim();
    if (!desc) return;
    if (!requireKey()) return;

    setBusy(true);
    const startedAt = Date.now();
    const toggles = loadRuleToggles();
    const vaultCtx = searchVault(desc, snippets).slice(0, 3).map((h) => ({ title: h.title, excerpt: h.excerpt }));
    try {
      setProgress({ pct: 2, label: "Designing blueprint…", startedAt });
      const bp: any = await withRetry(() =>
        blueprint({ data: { description: desc, moduleCount: 30, ...ctx(vaultCtx, keyForIndex(0)) } }),
      );
      const modules: any[] = bp.modules ?? [];
      const projectName: string = bp.projectName || "Project";
      const siblings: string[] = modules.map((m) => `${m.name} (${m.filename}) — ${m.purpose}`);
      push("assistant", `🚀 Blueprint ready for "${projectName}" — ${modules.length} modules. Generating…`);

      for (let i = 0; i < modules.length; i++) {
        const m = modules[i];
        setProgress({
          pct: Math.round(((i + 1) / (modules.length + 1)) * 100),
          label: `Generating Module ${i + 1}/${modules.length}: ${m.name}…`,
          startedAt,
        });
        const key = keyForIndex(i);
        let res: any = await withRetry(() =>
          genModule({
            data: {
              projectName,
              projectDescription: desc,
              module: m,
              siblings,
              targetLines: 1000,
              isMain: false,
              ...ctx(vaultCtx, key),
            },
          }),
        );
        let code: string = res.code || "";

        // validate → auto-fix loop (max 2 passes)
        for (let pass = 0; pass < 2; pass++) {
          const issues = validate(code, language, toggles).filter((x) => x.severity !== "style");
          if (!issues.length || !code) break;
          setProgress((p) => (p ? { ...p, label: `Fixing ${issues.length} issue(s) in ${m.name}…` } : p));
          const fixed: any = await withRetry(() =>
            fixCode({
              data: {
                code,
                issues: issues.slice(0, 40).map((x) => `${x.label}: ${x.message}`),
                ...ctx(vaultCtx, key),
              },
            }),
          );
          if (fixed.code) code = fixed.code;
        }

        onSaveSnippet?.({
          title: `[${projectName}] ${m.name}`,
          description: `project-module · ${projectName} · ${m.purpose}`,
          code,
          language: "lua",
        });
        await sleep(2000);
      }

      setProgress({ pct: 98, label: "Generating main.lua…", startedAt });
      const main: any = await withRetry(() =>
        genModule({
          data: {
            projectName,
            projectDescription: desc,
            module: { name: "Main", filename: "main.lua", purpose: "Entry point", dependencies: [] },
            siblings,
            targetLines: 400,
            isMain: true,
            ...ctx(vaultCtx, keyForIndex(modules.length)),
          },
        }),
      );
      onSaveSnippet?.({
        title: `[${projectName}] Main`,
        description: `project-module · ${projectName} · entry point`,
        code: main.code || "",
        language: "lua",
      });

      setProgress({ pct: 100, label: "Done", startedAt });
      push("assistant", `✅ "${projectName}" generated — ${modules.length} modules + main.lua saved to the Vault.`);
      toast.success("Project generated");
      setShowFactory(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Generation failed");
      push("assistant", `⚠️ Project generation failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(null), 4000);
    }
  }


  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    push("user", text);

    // --- correction confirmation flow (handled locally, no tokens spent) ---
    if (pending?.stage === "confirm") {
      if (YES_RE.test(text)) {
        storeCorrection(pending.mistake, pending.correction);
        push("assistant", `Thank you — I've stored that correction and will apply it to future generations.`);
        toast.success("Correction remembered");
      } else if (NO_RE.test(text)) {
        push("assistant", "Understood — I won't store that correction.");
      } else {
        push("assistant", `${CONFIRM_Q} (please reply yes or no)`);
        return;
      }
      setPending(null);
      return;
    }
    if (pending?.stage === "detail") {
      setPending({ stage: "confirm", mistake: pending.mistake, correction: text });
      push("assistant", `Got it — I'll treat this as: “${text}”.\n\n${CONFIRM_Q}`);
      return;
    }
    if (MISTAKE_RE.test(text)) {
      setPending({ stage: "detail", mistake: text, correction: "" });
      push("assistant", CLARIFY_Q);
      return;
    }

    // --- normal generation with full auto context ---
    const found = searchVault(text, snippets);
    setHits(found);
    setBusy(true);
    try {
      const history = settings.memory.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const res: any = await chat({
        data: {
          message: text,
          history,
          ...ctx(found.map((h) => ({ title: h.title, excerpt: h.excerpt })), activeKey()),
        },
      });
      push("assistant", res.text || "(no response)");
      if (res.correctionRequest) {
        setPending({
          stage: "confirm",
          mistake: res.correctionRequest.mistake,
          correction: res.correctionRequest.correction,
        });
      }
    } catch (e: any) {
      push("assistant", `⚠️ ${e?.message ?? "Request failed"}`);
      toast.error(e?.message ?? "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="w-[24rem] shrink-0 border-l border-white/10 bg-[#252526] flex flex-col min-h-0">
      <div className="flex items-center border-b border-white/10 text-[11px] uppercase tracking-widest">
        {(
          [
            ["chat", "Jarvis Lab"],
            ["knowledge", "Knowledge"],
            ["corrections", `Corrections${settings.corrections.length ? ` (${settings.corrections.length})` : ""}`],
            ["keys", `🔑 Keys${settings.apiKeys.length ? ` (${settings.apiKeys.length})` : ""}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 px-2 py-2 ${tab === id ? "text-cyan-300 border-b-2 border-cyan-400" : "text-white/50 hover:text-white/80"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "chat" && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3 min-h-0">
            {settings.memory.length === 0 && (
              <p className="text-xs text-white/40">
                Ask for a script. Your whole vault is auto-searched, and all knowledge, rules, API refs and stored
                corrections are sent with every prompt.
              </p>
            )}
            {settings.memory.map((m) => (
              <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
                <div
                  className={`inline-block max-w-[95%] text-left text-xs whitespace-pre-wrap rounded-lg px-2.5 py-2 ${
                    m.role === "user" ? "bg-cyan-500/15 text-cyan-100" : "bg-white/5 text-white/85"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-white/50">
                <Loader2 size={12} className="animate-spin" /> JARVIS is thinking…
              </div>
            )}
          </div>

          {hits.length > 0 && (
            <div className="border-t border-white/10 max-h-40 overflow-auto">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-cyan-300/80 flex items-center gap-1.5">
                <Search size={11} /> Auto vault context ({hits.length})
              </div>
              {hits.map((h) => (
                <button
                  key={h.id}
                  onClick={() => onSelectSnippet?.(h.id)}
                  className="w-full text-left px-3 py-1 text-[11px] hover:bg-cyan-500/10 flex justify-between gap-2"
                >
                  <span className="truncate text-white/80">{h.title}</span>
                  <span className="text-white/35 font-mono shrink-0">score {h.score}</span>
                </button>
              ))}
            </div>
          )}

          {progress && (
            <div className="border-t border-white/10 px-3 py-2">
              <div className="h-1.5 rounded bg-white/10 overflow-hidden">
                <div className="h-full bg-cyan-400 transition-all" style={{ width: `${progress.pct}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-white/50">
                <span className="truncate">{progress.label}</span>
                <span className="shrink-0 font-mono">
                  {progress.pct}%
                  {progress.pct > 2 && progress.pct < 100
                    ? ` · ~${Math.max(
                        1,
                        Math.round(
                          (((Date.now() - progress.startedAt) / progress.pct) * (100 - progress.pct)) / 60000,
                        ),
                      )}m left`
                    : ""}
                </span>
              </div>
            </div>
          )}

          {showFactory && (
            <div className="border-t border-white/10 p-2 space-y-2 bg-[#1e1e1e]">
              <div className="text-[10px] uppercase tracking-widest text-cyan-300/80">🚀 Project Factory — 30 modules</div>
              <textarea
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
                rows={2}
                placeholder="Describe the project (e.g. Advanced admin system with logging)…"
                className="w-full bg-[#252526] border border-white/10 rounded px-2 py-1.5 text-xs resize-none focus:border-cyan-400 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={runFactory}
                  disabled={busy || !projectDesc.trim()}
                  className="px-2 py-1 rounded bg-cyan-500 text-black text-[11px] hover:bg-cyan-400 disabled:opacity-40"
                >
                  Start Generation
                </button>
                <button
                  onClick={() => setShowFactory(false)}
                  className="px-2 py-1 rounded bg-white/10 text-[11px] hover:bg-white/20"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-white/10 p-2">
            {pending && (
              <div className="mb-2 text-[11px] text-amber-300 flex items-center gap-1.5">
                <ShieldCheck size={12} />
                {pending.stage === "detail" ? "Waiting for your description of the mistake…" : "Reply yes / no to store this correction."}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder="Describe what you want…"
                className="flex-1 bg-[#1e1e1e] border border-white/10 rounded px-2 py-1.5 text-xs resize-none focus:border-cyan-400 focus:outline-none"
              />
              <button
                onClick={() => setShowFactory((v) => !v)}
                disabled={busy}
                title="Generate a 30k-line project in chunks"
                className="p-2 rounded bg-white/10 text-cyan-300 hover:bg-white/20 disabled:opacity-40"
              >
                <Rocket size={14} />
              </button>
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="p-2 rounded bg-cyan-500 text-black hover:bg-cyan-400 disabled:opacity-40"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-white/35">
              <span>{activeRules.length} rules · {settings.knowledge.length} knowledge · {settings.apiRefs.length} api refs</span>
              {settings.memory.length > 0 && (
                <button onClick={() => setSettings((s) => ({ ...s, memory: [] }))} className="hover:text-red-400">
                  clear chat
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "knowledge" && (
        <div className="flex-1 overflow-auto p-3 space-y-4 text-xs">
          <section>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-cyan-300/80 mb-1">
              <BookOpen size={11} /> Knowledge ({settings.knowledge.length})
            </div>
            <textarea
              value={draftKnowledge}
              onChange={(e) => setDraftKnowledge(e.target.value)}
              rows={3}
              placeholder="Paste notes, conventions, docs…"
              className="w-full bg-[#1e1e1e] border border-white/10 rounded p-2 focus:border-cyan-400 focus:outline-none"
            />
            <button
              onClick={() => {
                if (!draftKnowledge.trim()) return;
                setSettings((s) => ({ ...s, knowledge: [...s.knowledge, draftKnowledge.trim()] }));
                setDraftKnowledge("");
              }}
              className="mt-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[11px]"
            >
              Add knowledge
            </button>
            <ul className="mt-2 space-y-1">
              {settings.knowledge.map((k, i) => (
                <li key={i} className="flex gap-2 bg-white/5 rounded p-1.5">
                  <span className="flex-1 line-clamp-3 text-white/75">{k}</span>
                  <button
                    onClick={() => setSettings((s) => ({ ...s, knowledge: s.knowledge.filter((_, j) => j !== i) }))}
                    className="text-white/40 hover:text-red-400 shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-cyan-300/80 mb-1">
              <Plug size={11} /> API references ({settings.apiRefs.length})
            </div>
            <textarea
              value={draftApi}
              onChange={(e) => setDraftApi(e.target.value)}
              rows={3}
              placeholder="e.g. MyModule.fire(player, amount) — server only"
              className="w-full bg-[#1e1e1e] border border-white/10 rounded p-2 focus:border-cyan-400 focus:outline-none"
            />
            <button
              onClick={() => {
                if (!draftApi.trim()) return;
                setSettings((s) => ({ ...s, apiRefs: [...s.apiRefs, draftApi.trim()] }));
                setDraftApi("");
              }}
              className="mt-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[11px]"
            >
              Add API reference
            </button>
            <ul className="mt-2 space-y-1">
              {settings.apiRefs.map((k, i) => (
                <li key={i} className="flex gap-2 bg-white/5 rounded p-1.5">
                  <span className="flex-1 line-clamp-3 text-white/75">{k}</span>
                  <button
                    onClick={() => setSettings((s) => ({ ...s, apiRefs: s.apiRefs.filter((_, j) => j !== i) }))}
                    className="text-white/40 hover:text-red-400 shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="text-[10px] uppercase tracking-widest text-cyan-300/80 mb-1">
              Active rules ({activeRules.length})
            </div>
            <ul className="space-y-1 text-white/60">
              {activeRules.map((r, i) => (
                <li key={i} className="bg-white/5 rounded p-1.5">{r}</li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {tab === "corrections" && (
        <div className="flex-1 overflow-auto p-3 text-xs">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-cyan-300/80 mb-2">
            <Brain size={11} /> Learned corrections
          </div>
          {settings.corrections.length === 0 ? (
            <p className="text-white/40">
              Nothing learned yet. Tell JARVIS it made a mistake, describe it, and confirm with “yes” to store it here.
            </p>
          ) : (
            <ul className="space-y-2">
              {settings.corrections.map((c) => (
                <li key={c.id} className="bg-white/5 rounded p-2 flex gap-2">
                  <div className="flex-1 min-w-0">
                    {c.mistake && <div className="text-red-300/80 line-clamp-2">✗ {c.mistake}</div>}
                    <div className="text-emerald-300/90 line-clamp-4">✓ {c.correction}</div>
                    <div className="text-[10px] text-white/30 mt-0.5">{new Date(c.at).toLocaleString()}</div>
                  </div>
                  <button
                    onClick={() => setSettings((s) => ({ ...s, corrections: s.corrections.filter((x) => x.id !== c.id) }))}
                    className="text-white/40 hover:text-red-400 shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
