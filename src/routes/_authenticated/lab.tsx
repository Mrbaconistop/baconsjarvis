import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { toast } from "sonner";
import { Plus, Trash2, Save, Sparkles, BookOpen, Loader2, Pencil, Check, GraduationCap, Maximize2, X } from "lucide-react";
import { PageHeader } from "@/components/jarvis/HudBits";
import {
  listLearningSessions,
  getLearningSession,
  createLearningSession,
  updateLearningSession,
  deleteLearningSession,
  generateProblems,
  explainSolution,
  assessGradeLevel,
} from "@/lib/learning.functions";

export const Route = createFileRoute("/_authenticated/lab")({
  ssr: false,
  head: () => ({ meta: [{ title: "Learning Lab — JARVIS" }] }),
  component: LabPage,
});

type SessionRow = { id: string; title: string; updated_at: string };

function LabPage() {
  const qc = useQueryClient();
  const list = useServerFn(listLearningSessions);
  const get = useServerFn(getLearningSession);
  const create = useServerFn(createLearningSession);
  const update = useServerFn(updateLearningSession);
  const remove = useServerFn(deleteLearningSession);
  const genProblems = useServerFn(generateProblems);
  const explain = useServerFn(explainSolution);
  const assess = useServerFn(assessGradeLevel);

  const { data: sessions = [] } = useQuery<SessionRow[]>({
    queryKey: ["learning_sessions"],
    queryFn: () => list() as any,
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [aiOutput, setAiOutput] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [busy, setBusy] = useState<"problems" | "solution" | "grade" | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [tutorExpanded, setTutorExpanded] = useState(false);
  const lastSavedRef = useRef<{ title: string; content: string } | null>(null);

  // Load active session content
  useEffect(() => {
    if (!activeId) return;
    (async () => {
      const row: any = await get({ data: { id: activeId } });
      if (!row) return;
      setTitle(row.title ?? "");
      setContent(row.content ?? "");
      setAiOutput("");
      lastSavedRef.current = { title: row.title ?? "", content: row.content ?? "" };
      setSavedAt(new Date(row.updated_at));
    })().catch(() => {});
  }, [activeId, get]);

  // Pick first session by default
  useEffect(() => {
    if (!activeId && sessions.length > 0) setActiveId(sessions[0].id);
  }, [sessions, activeId]);

  // Auto-save every 10s if dirty
  useEffect(() => {
    if (!activeId) return;
    const t = setInterval(async () => {
      const last = lastSavedRef.current;
      if (!last) return;
      if (last.title === title && last.content === content) return;
      try {
        await update({ data: { id: activeId, title, content } });
        lastSavedRef.current = { title, content };
        setSavedAt(new Date());
        qc.invalidateQueries({ queryKey: ["learning_sessions"] });
      } catch (e: any) {
        // silent; surface only on manual save
      }
    }, 10000);
    return () => clearInterval(t);
  }, [activeId, title, content, update, qc]);

  async function manualSave() {
    if (!activeId) return;
    try {
      await update({ data: { id: activeId, title, content } });
      lastSavedRef.current = { title, content };
      setSavedAt(new Date());
      qc.invalidateQueries({ queryKey: ["learning_sessions"] });
      toast.success("Board saved.");
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    }
  }

  async function newSession() {
    const row: any = await create({ data: { title: "Untitled Board", content: "" } });
    qc.invalidateQueries({ queryKey: ["learning_sessions"] });
    setActiveId(row.id);
  }

  async function deleteActive() {
    if (!activeId) return;
    if (!confirm("Delete this board?")) return;
    await remove({ data: { id: activeId } });
    setActiveId(null);
    setTitle("");
    setContent("");
    qc.invalidateQueries({ queryKey: ["learning_sessions"] });
  }

  async function runGenerateProblems() {
    if (!topic.trim()) {
      toast.error("Choose a topic first, Sir.");
      return;
    }
    setBusy("problems");
    setAiOutput("");
    try {
      const res: any = await genProblems({ data: { topic, count: 5, difficulty } });
      setAiOutput(res.markdown);
    } catch (e: any) {
      toast.error(e?.message ?? "Generation failed");
    } finally {
      setBusy(null);
    }
  }

  async function runExplainSelection() {
    const sel = typeof window !== "undefined" ? window.getSelection()?.toString().trim() : "";
    const problem = sel && sel.length > 4 ? sel : content;
    if (!problem.trim()) {
      toast.error("Select a problem or write one in the notes first.");
      return;
    }
    setBusy("solution");
    setAiOutput("");
    try {
      const res: any = await explain({ data: { problem, context: topic ? `Topic: ${topic}` : undefined } });
      setAiOutput(res.markdown);
    } catch (e: any) {
      toast.error(e?.message ?? "Explanation failed");
    } finally {
      setBusy(null);
    }
  }

  async function runGradeAssessment() {
    const sel = typeof window !== "undefined" ? window.getSelection()?.toString().trim() : "";
    const sample = sel && sel.length > 20 ? sel : content;
    if (!sample.trim() || sample.trim().length < 20) {
      toast.error("Write or select at least a short paragraph to assess.");
      return;
    }
    setBusy("grade");
    setAiOutput("");
    try {
      const res: any = await assess({ data: { sample, subjectHint: topic || undefined } });
      setAiOutput(res.markdown);
    } catch (e: any) {
      toast.error(e?.message ?? "Assessment failed");
    } finally {
      setBusy(null);
    }
  }



  const savedLabel = useMemo(() => {
    if (!savedAt) return "Not yet saved";
    return `Saved ${savedAt.toLocaleTimeString()}`;
  }, [savedAt]);

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag="12"
        title="Learning Lab"
        subtitle="Whiteboard, problems, and step‑by‑step solutions."
        right={
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-hud-dim">{savedLabel}</span>
            <button
              onClick={manualSave}
              disabled={!activeId}
              className="inline-flex items-center gap-1.5 rounded border border-arc/30 bg-arc/10 px-3 py-1.5 text-xs text-arc hover:bg-arc/20 disabled:opacity-40"
            >
              <Save size={12} /> Save
            </button>
          </div>
        }
      />

      <div className="flex-1 min-h-0 grid grid-cols-12 gap-4 p-4">
        {/* Sessions */}
        <aside className="col-span-3 xl:col-span-2 rounded-lg border border-arc/15 bg-background/40 backdrop-blur-xl p-3 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-[10px] tracking-[0.3em] text-arc">SESSIONS</div>
            <button
              onClick={newSession}
              className="inline-flex items-center gap-1 rounded border border-arc/30 bg-arc/10 px-2 py-1 text-[10px] text-arc hover:bg-arc/20"
            >
              <Plus size={11} /> New
            </button>
          </div>
          <div className="space-y-1 overflow-auto flex-1 pr-1">
            {sessions.length === 0 && (
              <div className="text-xs text-muted-foreground p-2">No boards yet. Create one to begin.</div>
            )}
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`w-full text-left rounded px-2 py-2 transition border ${
                  s.id === activeId
                    ? "border-arc/40 bg-arc/15 text-arc"
                    : "border-transparent hover:border-arc/20 hover:bg-arc/5 text-muted-foreground"
                }`}
              >
                <div className="text-xs font-medium truncate">{s.title}</div>
                <div className="font-mono text-[9px] text-hud-dim">
                  {new Date(s.updated_at).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Whiteboard */}
        <section className="col-span-6 xl:col-span-7 rounded-lg border border-arc/15 bg-background/40 backdrop-blur-xl flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-arc/10">
            {editingTitle ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setEditingTitle(false);
                }}
                className="flex-1 bg-transparent border-b border-arc/30 px-1 py-0.5 text-lg font-display text-arc focus:outline-none"
              />
            ) : (
              <h2 className="flex-1 text-lg font-display text-glow truncate">
                {title || "— No board selected —"}
              </h2>
            )}
            {activeId && (
              <button
                onClick={() => setEditingTitle((v) => !v)}
                className="inline-flex items-center gap-1 rounded border border-arc/20 px-2 py-1 text-[10px] text-hud-dim hover:text-arc"
              >
                {editingTitle ? <Check size={11} /> : <Pencil size={11} />}
                {editingTitle ? "Done" : "Rename"}
              </button>
            )}
            {activeId && (
              <button
                onClick={deleteActive}
                className="inline-flex items-center gap-1 rounded border border-critical/30 px-2 py-1 text-[10px] text-critical hover:bg-critical/10"
              >
                <Trash2 size={11} /> Delete
              </button>
            )}
          </div>

          <div className="flex-1 grid grid-rows-2 gap-2 p-3 min-h-0">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={!activeId}
              placeholder={activeId ? "Write notes in Markdown — **bold**, `code`, - bullets…" : "Create or select a board to begin."}
              className="w-full h-full resize-none rounded-md border border-arc/15 bg-background/60 p-3 font-mono text-sm text-foreground/90 placeholder:text-hud-dim focus:outline-none focus:border-arc/40"
              spellCheck={false}
            />
            <div className="rounded-md border border-arc/15 bg-background/60 p-3 overflow-auto prose prose-invert prose-sm max-w-none">
              {content.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content}</ReactMarkdown>
              ) : (
                <div className="text-xs text-hud-dim font-mono">// Live Markdown preview appears here.</div>
              )}
            </div>
          </div>
        </section>

        {/* AI panel (collapsed inline) */}
        {!tutorExpanded && (
          <aside className="col-span-3 rounded-lg border border-arc/15 bg-background/40 backdrop-blur-xl p-3 flex flex-col min-h-0 relative">
            <TutorPanel
              expanded={false}
              onToggleExpand={() => setTutorExpanded(true)}
              topic={topic} setTopic={setTopic}
              difficulty={difficulty} setDifficulty={setDifficulty}
              busy={busy}
              aiOutput={aiOutput}
              runGenerateProblems={runGenerateProblems}
              runExplainSelection={runExplainSelection}
              runGradeAssessment={runGradeAssessment}
              setContent={setContent}
            />
          </aside>
        )}
      </div>

      {/* Expanded tutor session overlay */}
      {tutorExpanded && (
        <div className="fixed inset-0 z-50 bg-background/85 backdrop-blur-xl flex items-center justify-center p-4 md:p-8 animate-in fade-in">
          <div className="relative w-full max-w-5xl h-full max-h-[92vh] rounded-xl border border-arc/30 bg-background/70 shadow-[0_0_60px_-10px_hsl(var(--arc)/0.4)] flex flex-col">
            <TutorPanel
              expanded={true}
              onToggleExpand={() => setTutorExpanded(false)}
              topic={topic} setTopic={setTopic}
              difficulty={difficulty} setDifficulty={setDifficulty}
              busy={busy}
              aiOutput={aiOutput}
              runGenerateProblems={runGenerateProblems}
              runExplainSelection={runExplainSelection}
              runGradeAssessment={runGradeAssessment}
              setContent={setContent}
            />
          </div>
        </div>
      )}
    </div>
  );
}

type TutorPanelProps = {
  expanded: boolean;
  onToggleExpand: () => void;
  topic: string;
  setTopic: (v: string) => void;
  difficulty: "easy" | "medium" | "hard";
  setDifficulty: (d: "easy" | "medium" | "hard") => void;
  busy: "problems" | "solution" | "grade" | null;
  aiOutput: string;
  runGenerateProblems: () => void;
  runExplainSelection: () => void;
  runGradeAssessment: () => void;
  setContent: (updater: (c: string) => string) => void;
};

function TutorPanel({
  expanded, onToggleExpand,
  topic, setTopic, difficulty, setDifficulty,
  busy, aiOutput,
  runGenerateProblems, runExplainSelection, runGradeAssessment, setContent,
}: TutorPanelProps) {
  return (
    <div className={`flex flex-col min-h-0 h-full ${expanded ? "p-5" : ""}`}>
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2">
          <div className={`font-mono tracking-[0.3em] text-arc ${expanded ? "text-xs" : "text-[10px]"}`}>
            JARVIS · TUTOR
          </div>
          {busy && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-arc/40 bg-arc/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-arc animate-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-arc shadow-[0_0_8px_hsl(var(--arc))]" />
              Accessing · {busy}
            </span>
          )}
        </div>
        <button
          onClick={onToggleExpand}
          className="inline-flex items-center gap-1 rounded border border-arc/30 px-2 py-1 text-[10px] text-arc hover:bg-arc/15"
          title={expanded ? "Collapse" : "Expand session"}
        >
          {expanded ? <><X size={11} /> Close</> : <><Maximize2 size={11} /> Expand</>}
        </button>
      </div>

      <div className={expanded ? "grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 min-h-0" : "flex flex-col flex-1 min-h-0"}>
        {/* Controls */}
        <div className={`space-y-2 ${expanded ? "md:col-span-1" : "mb-3"}`}>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic (e.g. recursion, calc derivatives)"
            className={`w-full rounded border border-arc/20 bg-background/60 px-2 focus:outline-none focus:border-arc/50 ${expanded ? "py-2 text-sm" : "py-1.5 text-xs"}`}
          />
          <div className="flex gap-1">
            {(["easy", "medium", "hard"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDifficulty(d)}
                className={`flex-1 rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition ${
                  difficulty === d
                    ? "border-arc/40 bg-arc/15 text-arc"
                    : "border-arc/15 text-hud-dim hover:text-arc"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            onClick={runGenerateProblems}
            disabled={busy !== null}
            className={`w-full inline-flex items-center justify-center gap-1.5 rounded border border-arc/30 bg-arc/10 px-2 text-arc hover:bg-arc/20 disabled:opacity-40 ${expanded ? "py-2 text-sm" : "py-1.5 text-xs"}`}
          >
            {busy === "problems" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Generate Problems
          </button>
          <button
            onClick={runExplainSelection}
            disabled={busy !== null}
            className={`w-full inline-flex items-center justify-center gap-1.5 rounded border border-arc/30 bg-arc/5 px-2 text-foreground hover:bg-arc/15 disabled:opacity-40 ${expanded ? "py-2 text-sm" : "py-1.5 text-xs"}`}
          >
            {busy === "solution" ? <Loader2 size={12} className="animate-spin" /> : <BookOpen size={12} />}
            Explain Selection
          </button>
          <button
            onClick={runGradeAssessment}
            disabled={busy !== null}
            className={`w-full inline-flex items-center justify-center gap-1.5 rounded border border-arc/30 bg-arc/5 px-2 text-foreground hover:bg-arc/15 disabled:opacity-40 ${expanded ? "py-2 text-sm" : "py-1.5 text-xs"}`}
          >
            {busy === "grade" ? <Loader2 size={12} className="animate-spin" /> : <GraduationCap size={12} />}
            Assess Grade Level (OAS)
          </button>
          <p className="text-[10px] text-hud-dim font-mono">
            Tip: select a passage to grade just that text, or assess the whole board. Calibrated to Oklahoma Academic Standards.
          </p>
        </div>

        {/* Output */}
        <div className={`flex flex-col min-h-0 ${expanded ? "md:col-span-2" : "flex-1"}`}>
          <div className={`flex-1 min-h-0 rounded border bg-background/60 p-3 overflow-auto prose prose-invert max-w-none ${
            busy ? "border-arc/40 shadow-[inset_0_0_30px_-10px_hsl(var(--arc)/0.4)]" : "border-arc/15"
          } ${expanded ? "prose-base" : "prose-sm"}`}>
            {busy && !aiOutput && (
              <div className="flex items-center gap-2 text-arc font-mono text-xs animate-pulse">
                <Loader2 size={14} className="animate-spin" />
                <span>// JARVIS is thinking…</span>
              </div>
            )}
            {!busy && !aiOutput && (
              <div className="text-xs text-hud-dim font-mono">// Output will appear here.</div>
            )}
            {aiOutput && <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{aiOutput}</ReactMarkdown>}
          </div>

          {aiOutput && (
            <button
              onClick={() => setContent((c) => (c ? `${c}\n\n${aiOutput}` : aiOutput))}
              className="mt-2 inline-flex items-center justify-center gap-1.5 rounded border border-arc/20 px-2 py-1 text-[10px] text-hud-dim hover:text-arc self-start"
            >
              <Plus size={11} /> Append to notes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
