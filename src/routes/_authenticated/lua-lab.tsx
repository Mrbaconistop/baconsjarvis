import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Sparkles,
  Play,
  Wrench,
  Brain,
  ShieldCheck,
  Trash2,
  Copy,
  Loader2,
  AlertTriangle,
  Info,
  XCircle,
  Terminal,
  Settings2,
} from "lucide-react";
import { setupMonaco } from "@/lib/monaco-setup";
import {
  RULES,
  validate,
  loadRuleToggles,
  saveRuleToggles,
  loadMistakes,
  rememberMistakes,
  type Issue,
  type Lang,
  type Mistake,
} from "@/lib/lua-rules";
import { generateLuaCode, fixLuaCode } from "@/lib/lua-lab.functions";

export const Route = createFileRoute("/_authenticated/lua-lab")({
  ssr: false,
  component: LuaLabPage,
  head: () => ({
    meta: [
      { title: "Lua Lab — JARVIS Luau Coding Assistant" },
      {
        name: "description",
        content: "Describe what you want, JARVIS explains the logic, writes Lua/Luau, validates it against your rules and learns from mistakes.",
      },
      { property: "og:title", content: "Lua Lab — JARVIS Luau Coding Assistant" },
      {
        property: "og:description",
        content: "AI-assisted Lua/Luau coding with local validation rules, mistake memory and an output console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const CODE_KEY = "lua-lab.code.v1";
const LANG_KEY = "lua-lab.lang.v1";

type LogLine = { kind: "info" | "ok" | "warn" | "err"; text: string; at: number };

function severityIcon(s: Issue["severity"]) {
  if (s === "error") return <XCircle size={13} className="text-red-400 shrink-0 mt-0.5" />;
  if (s === "warning") return <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />;
  return <Info size={13} className="text-cyan-400 shrink-0 mt-0.5" />;
}

function LuaLabPage() {
  const [lang, setLang] = useState<Lang>("luau");
  const [code, setCode] = useState("");
  const [request, setRequest] = useState("");
  const [plan, setPlan] = useState("");
  const [notes, setNotes] = useState("");
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<null | "gen" | "fix">(null);
  const [monacoReady, setMonacoReady] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const consoleRef = useRef<HTMLDivElement | null>(null);

  const gen = useServerFn(generateLuaCode);
  const fix = useServerFn(fixLuaCode);

  useEffect(() => {
    let cancelled = false;
    setupMonaco()
      .then(() => !cancelled && setMonacoReady(true))
      .catch(() => !cancelled && setMonacoReady(true));
    setToggles(loadRuleToggles());
    setMistakes(loadMistakes());
    setCode(localStorage.getItem(CODE_KEY) ?? "");
    setLang(((localStorage.getItem(LANG_KEY) as Lang) || "luau") as Lang);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CODE_KEY, code);
    } catch {}
  }, [code]);
  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {}
  }, [lang]);
  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [logs]);

  const activeRules = useMemo(
    () => RULES.filter((r) => toggles[r.id] !== false && r.langs.includes(lang)),
    [toggles, lang],
  );

  const issues = useMemo(() => (code.trim() ? validate(code, lang, toggles) : []), [code, lang, toggles]);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;

  function log(kind: LogLine["kind"], text: string) {
    setLogs((l) => [...l.slice(-200), { kind, text, at: Date.now() }]);
  }

  function toggleRule(id: string) {
    const next = { ...toggles, [id]: toggles[id] === false };
    setToggles(next);
    saveRuleToggles(next);
  }

  function runTests(target = code) {
    const found = validate(target, lang, toggles);
    log("info", `Running ${activeRules.length} rule(s) against ${target.split("\n").length} lines…`);
    if (!found.length) {
      log("ok", "PASS — no issues found.");
      return found;
    }
    found.forEach((i) =>
      log(i.severity === "error" ? "err" : "warn", `L${i.line} [${i.label}] ${i.message}`),
    );
    log(
      found.some((i) => i.severity === "error") ? "err" : "warn",
      `FAIL — ${found.filter((i) => i.severity === "error").length} error(s), ${found.filter((i) => i.severity === "warning").length} warning(s), ${found.filter((i) => i.severity === "style").length} style note(s).`,
    );
    setMistakes(rememberMistakes(found));
    return found;
  }

  async function onGenerate() {
    if (!request.trim()) return toast.error("Describe what you want first.");
    setBusy("gen");
    setPlan("");
    setNotes("");
    log("info", `Request: ${request.trim().slice(0, 160)}`);
    log("info", "JARVIS is planning the logic before writing code…");
    try {
      const res: any = await gen({
        data: {
          description: request.trim(),
          language: lang,
          rules: activeRules.map((r) => `${r.label}: ${r.description}`),
          mistakes: mistakes.slice(0, 12).map((m) => `${m.label} — ${m.message} (seen ${m.count}x)`),
          currentCode: code.trim() ? code : undefined,
        },
      });
      setPlan(res.plan || "");
      setNotes(res.notes || "");
      if (res.code) {
        setCode(res.code);
        log("ok", "Code generated. Validating…");
        const found = validate(res.code, lang, toggles);
        if (!found.length) log("ok", "PASS — generated code satisfies every active rule.");
        else {
          found.forEach((i) => log(i.severity === "error" ? "err" : "warn", `L${i.line} [${i.label}] ${i.message}`));
          setMistakes(rememberMistakes(found));
          log("warn", `Learned ${found.length} issue(s) into mistake memory. Use "Fix issues" to auto-correct.`);
        }
      } else {
        log("err", "No code block returned.");
      }
    } catch (e: any) {
      log("err", e?.message ?? "Generation failed.");
      toast.error(e?.message ?? "Generation failed");
    } finally {
      setBusy(null);
    }
  }

  async function onFix() {
    if (!code.trim()) return toast.error("Nothing to fix.");
    const found = issues.length ? issues : validate(code, lang, toggles);
    if (!found.length) return toast.success("No issues to fix.");
    setBusy("fix");
    log("info", `Asking JARVIS to fix ${found.length} issue(s)…`);
    try {
      const res: any = await fix({
        data: {
          code,
          language: lang,
          issues: found.map((i) => `L${i.line} ${i.label}: ${i.message}`),
          rules: activeRules.map((r) => `${r.label}: ${r.description}`),
        },
      });
      if (res.code) {
        setCode(res.code);
        setPlan(res.plan || plan);
        setNotes(res.notes || notes);
        log("ok", "Patch applied. Re-validating…");
        runTests(res.code);
      } else log("err", "No code returned from fix pass.");
    } catch (e: any) {
      log("err", e?.message ?? "Fix failed.");
      toast.error(e?.message ?? "Fix failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-3 sm:p-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <h1 className="font-display text-xl sm:text-2xl flex items-center gap-2">
            <Sparkles size={18} className="text-arc" /> Lua Lab
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Describe it → JARVIS explains the logic → writes code → validates → learns.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-arc/20 p-1">
          {(["luau", "lua"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`px-3 py-1.5 rounded-md text-xs font-mono transition ${
                lang === l ? "bg-arc/20 text-arc" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {l === "luau" ? "Roblox Luau" : "Lua 5.1"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowRules((v) => !v)}
          className="px-3 py-2 rounded-md border border-arc/20 text-xs flex items-center gap-2 hover:bg-arc/10"
        >
          <Settings2 size={14} /> Rules ({activeRules.length})
        </button>
      </header>

      {/* Prompt */}
      <div className="rounded-lg border border-arc/15 bg-background/40 p-3 space-y-2">
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onGenerate();
          }}
          rows={3}
          placeholder='e.g. "A server script that gives every player a sword when they spawn, with a 30s cooldown stored per player."'
          className="w-full bg-transparent text-sm resize-y focus:outline-none placeholder:text-muted-foreground/60"
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onGenerate}
            disabled={busy !== null}
            className="px-3 py-2 rounded-md bg-arc/20 text-arc text-xs font-medium flex items-center gap-2 hover:bg-arc/30 disabled:opacity-50"
          >
            {busy === "gen" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Plan &amp; Generate
          </button>
          <button
            onClick={() => runTests()}
            className="px-3 py-2 rounded-md border border-arc/20 text-xs flex items-center gap-2 hover:bg-arc/10"
          >
            <Play size={14} /> Run tests
          </button>
          <button
            onClick={onFix}
            disabled={busy !== null || !issues.length}
            className="px-3 py-2 rounded-md border border-arc/20 text-xs flex items-center gap-2 hover:bg-arc/10 disabled:opacity-40"
          >
            {busy === "fix" ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
            Fix issues
          </button>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(code);
              toast.success("Code copied");
            }}
            className="px-3 py-2 rounded-md border border-arc/20 text-xs flex items-center gap-2 hover:bg-arc/10"
          >
            <Copy size={14} /> Copy
          </button>
        </div>
      </div>

      {showRules && (
        <div className="rounded-lg border border-arc/15 bg-background/40 p-3">
          <div className="font-mono text-[10px] tracking-[0.25em] text-arc/70 mb-2">VALIDATION RULES</div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {RULES.map((r) => {
              const on = toggles[r.id] !== false;
              const applies = r.langs.includes(lang);
              return (
                <label
                  key={r.id}
                  className={`flex gap-2 items-start p-2 rounded-md border cursor-pointer transition ${
                    on ? "border-arc/30 bg-arc/5" : "border-arc/10 opacity-60"
                  } ${applies ? "" : "opacity-35"}`}
                >
                  <input type="checkbox" checked={on} onChange={() => toggleRule(r.id)} className="mt-1 accent-cyan-400" />
                  <span className="min-w-0">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      {r.label}
                      <span
                        className={`font-mono text-[9px] px-1 rounded ${
                          r.severity === "error"
                            ? "bg-red-500/15 text-red-400"
                            : r.severity === "warning"
                              ? "bg-amber-500/15 text-amber-400"
                              : "bg-cyan-500/15 text-cyan-400"
                        }`}
                      >
                        {r.severity}
                      </span>
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">{r.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Editor + console */}
        <div className="space-y-4 min-w-0">
          <div className="rounded-lg border border-arc/15 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-arc/15 bg-background/60">
              <span className="font-mono text-[10px] tracking-[0.25em] text-arc/70">EDITOR · {lang.toUpperCase()}</span>
              <span className="font-mono text-[10px] flex gap-3">
                <span className={errorCount ? "text-red-400" : "text-muted-foreground"}>{errorCount} err</span>
                <span className={warnCount ? "text-amber-400" : "text-muted-foreground"}>{warnCount} warn</span>
              </span>
            </div>
            <div className="h-[45vh] min-h-[280px] bg-[#1e1e1e]">
              {monacoReady ? (
                <Editor
                  height="100%"
                  theme="vs-dark"
                  language="lua"
                  value={code}
                  onChange={(v) => setCode(v ?? "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    tabSize: 2,
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                  }}
                />
              ) : (
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  spellCheck={false}
                  className="w-full h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-[13px] p-3 focus:outline-none resize-none"
                />
              )}
            </div>
          </div>

          <div className="rounded-lg border border-arc/15 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-arc/15 bg-background/60">
              <span className="font-mono text-[10px] tracking-[0.25em] text-arc/70 flex items-center gap-2">
                <Terminal size={12} /> OUTPUT CONSOLE
              </span>
              <button onClick={() => setLogs([])} className="text-muted-foreground hover:text-red-400">
                <Trash2 size={13} />
              </button>
            </div>
            <div ref={consoleRef} className="h-48 overflow-y-auto p-3 font-mono text-[11px] space-y-1 bg-[#0d0f14]">
              {logs.length === 0 ? (
                <div className="text-muted-foreground">Console idle. Generate code or run tests.</div>
              ) : (
                logs.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.kind === "err"
                        ? "text-red-400"
                        : l.kind === "warn"
                          ? "text-amber-400"
                          : l.kind === "ok"
                            ? "text-emerald-400"
                            : "text-cyan-300/80"
                    }
                  >
                    <span className="text-white/25 mr-2">
                      {new Date(l.at).toLocaleTimeString([], { hour12: false })}
                    </span>
                    {l.text}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Side panels */}
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-arc/15 bg-background/40 p-3">
            <div className="font-mono text-[10px] tracking-[0.25em] text-arc/70 mb-2 flex items-center gap-2">
              <Brain size={12} /> JARVIS LOGIC
            </div>
            {plan ? (
              <pre className="text-xs whitespace-pre-wrap leading-relaxed text-foreground/90">{plan}</pre>
            ) : (
              <p className="text-xs text-muted-foreground">
                JARVIS explains its approach here before writing a single line.
              </p>
            )}
            {notes && (
              <>
                <div className="font-mono text-[10px] tracking-[0.25em] text-arc/70 mt-3 mb-1">NOTES</div>
                <pre className="text-xs whitespace-pre-wrap leading-relaxed text-muted-foreground">{notes}</pre>
              </>
            )}
          </section>

          <section className="rounded-lg border border-arc/15 bg-background/40 p-3">
            <div className="font-mono text-[10px] tracking-[0.25em] text-arc/70 mb-2 flex items-center gap-2">
              <ShieldCheck size={12} /> VALIDATION ({issues.length})
            </div>
            {issues.length === 0 ? (
              <p className="text-xs text-emerald-400">No issues detected.</p>
            ) : (
              <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                {issues.map((i, k) => (
                  <li key={k} className="flex gap-2 text-[11px]">
                    {severityIcon(i.severity)}
                    <span>
                      <span className="font-mono text-arc/70">L{i.line}</span>{" "}
                      <span className="text-foreground/90">{i.message}</span>
                      <span className="block text-muted-foreground">{i.label}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-arc/15 bg-background/40 p-3">
            <div className="font-mono text-[10px] tracking-[0.25em] text-arc/70 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Brain size={12} /> MISTAKE MEMORY
              </span>
              {mistakes.length > 0 && (
                <button
                  onClick={() => {
                    rememberMistakes([]);
                    localStorage.removeItem("lua-lab.mistakes.v1");
                    setMistakes([]);
                  }}
                  className="text-muted-foreground hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            {mistakes.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing learned yet. Failed checks are remembered here and fed into future prompts.</p>
            ) : (
              <ul className="space-y-1 max-h-56 overflow-y-auto">
                {mistakes.map((m) => (
                  <li key={m.ruleId} className="text-[11px] flex justify-between gap-2">
                    <span className="text-foreground/90 truncate">{m.label}</span>
                    <span className="font-mono text-arc/70 shrink-0">×{m.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
