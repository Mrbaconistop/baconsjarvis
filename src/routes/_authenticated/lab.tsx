import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Plus, Trash2, Save, Sparkles, BookOpen, Loader2, Pencil, Check, GraduationCap } from "lucide-react";
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              ) : (
                <div className="text-xs text-hud-dim font-mono">// Live Markdown preview appears here.</div>
              )}
            </div>
          </div>
        </section>

        {/* AI panel */}
        <aside className="col-span-3 rounded-lg border border-arc/15 bg-background/40 backdrop-blur-xl p-3 flex flex-col min-h-0">
          <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-3">JARVIS · TUTOR</div>

          <div className="space-y-2 mb-3">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic (e.g. recursion, calc derivatives)"
              className="w-full rounded border border-arc/20 bg-background/60 px-2 py-1.5 text-xs focus:outline-none focus:border-arc/50"
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
              className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-arc/30 bg-arc/10 px-2 py-1.5 text-xs text-arc hover:bg-arc/20 disabled:opacity-40"
            >
              {busy === "problems" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Generate Problems
            </button>
            <button
              onClick={runExplainSelection}
              disabled={busy !== null}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-arc/30 bg-arc/5 px-2 py-1.5 text-xs text-foreground hover:bg-arc/15 disabled:opacity-40"
            >
              {busy === "solution" ? <Loader2 size={12} className="animate-spin" /> : <BookOpen size={12} />}
              Explain Selection
            </button>
            <button
              onClick={runGradeAssessment}
              disabled={busy !== null}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-arc/30 bg-arc/5 px-2 py-1.5 text-xs text-foreground hover:bg-arc/15 disabled:opacity-40"
            >
              {busy === "grade" ? <Loader2 size={12} className="animate-spin" /> : <GraduationCap size={12} />}
              Assess Grade Level (OAS)
            </button>
            <p className="text-[10px] text-hud-dim font-mono">
              Tip: select a passage to grade just that text, or assess the whole board. Calibrated to Oklahoma Academic Standards.
            </p>
          </div>

          <div className="flex-1 min-h-0 rounded border border-arc/15 bg-background/60 p-3 overflow-auto prose prose-invert prose-sm max-w-none">
            {busy && !aiOutput && (
              <div className="text-xs text-arc font-mono animate-pulse">// JARVIS is thinking…</div>
            )}
            {!busy && !aiOutput && (
              <div className="text-xs text-hud-dim font-mono">// Output will appear here.</div>
            )}
            {aiOutput && <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiOutput}</ReactMarkdown>}
          </div>

          {aiOutput && (
            <button
              onClick={() => setContent((c) => (c ? `${c}\n\n${aiOutput}` : aiOutput))}
              className="mt-2 inline-flex items-center justify-center gap-1.5 rounded border border-arc/20 px-2 py-1 text-[10px] text-hud-dim hover:text-arc"
            >
              <Plus size={11} /> Append to notes
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
