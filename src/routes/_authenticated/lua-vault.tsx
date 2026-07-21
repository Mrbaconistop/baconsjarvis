import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type Monaco, loader } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { toast } from "sonner";
import { Upload, Plus, Search, Trash2, FileCode, Play, Download } from "lucide-react";

const LUAU_GLOBALS: { label: string; detail: string; doc?: string }[] = [
  { label: "game", detail: "DataModel", doc: "Root of the Roblox instance tree." },
  { label: "workspace", detail: "Workspace", doc: "Shortcut for game.Workspace." },
  { label: "script", detail: "LuaSourceContainer" },
  { label: "wait", detail: "function(seconds)" },
  { label: "task", detail: "task library (spawn, wait, delay, defer)" },
  { label: "Players", detail: "game:GetService('Players')" },
  { label: "ReplicatedStorage", detail: "game:GetService('ReplicatedStorage')" },
  { label: "ServerStorage", detail: "game:GetService('ServerStorage')" },
  { label: "ServerScriptService", detail: "game:GetService('ServerScriptService')" },
  { label: "StarterGui", detail: "game:GetService('StarterGui')" },
  { label: "StarterPlayer", detail: "game:GetService('StarterPlayer')" },
  { label: "RunService", detail: "game:GetService('RunService')" },
  { label: "UserInputService", detail: "game:GetService('UserInputService')" },
  { label: "TweenService", detail: "game:GetService('TweenService')" },
  { label: "HttpService", detail: "game:GetService('HttpService')" },
  { label: "Lighting", detail: "game:GetService('Lighting')" },
  { label: "Debris", detail: "game:GetService('Debris')" },
  { label: "MarketplaceService", detail: "game:GetService('MarketplaceService')" },
  { label: "DataStoreService", detail: "game:GetService('DataStoreService')" },
  { label: "PathfindingService", detail: "game:GetService('PathfindingService')" },
  { label: "CollectionService", detail: "game:GetService('CollectionService')" },
  { label: "SoundService", detail: "game:GetService('SoundService')" },
  { label: "Instance", detail: "Instance.new(className, parent)" },
  { label: "Vector3", detail: "Vector3.new(x, y, z)" },
  { label: "Vector2", detail: "Vector2.new(x, y)" },
  { label: "CFrame", detail: "CFrame.new(...)" },
  { label: "Color3", detail: "Color3.fromRGB(r, g, b)" },
  { label: "UDim2", detail: "UDim2.new(xs, xo, ys, yo)" },
  { label: "UDim", detail: "UDim.new(scale, offset)" },
  { label: "Enum", detail: "Roblox Enum namespace" },
  { label: "Ray", detail: "Ray.new(origin, direction)" },
  { label: "BrickColor", detail: "BrickColor.new(name)" },
  { label: "TweenInfo", detail: "TweenInfo.new(...)" },
  { label: "typeof", detail: "function(value)" },
  { label: "tick", detail: "function() -> number" },
  { label: "print", detail: "function(...)" },
  { label: "warn", detail: "function(...)" },
];

export const Route = createFileRoute("/_authenticated/lua-vault")({
  ssr: false,
  component: LuaVaultPage,
});

type Snippet = {
  id: string;
  title: string;
  description: string;
  code: string;
  language: string;
  createdAt: number;
};

const KEY = "lua-vault.snippets.v1";
const ACCEPTED_CODE = /\.(lua|txt)$/i;

function loadAll(): Snippet[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Snippet[]) : [];
  } catch {
    return [];
  }
}
function saveAll(list: Snippet[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}
function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function highlight(line: string, q: string) {
  if (!q) return escapeHtml(line);
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return escapeHtml(line).replace(re, '<mark class="bg-cyan-500/40 text-cyan-100 rounded px-0.5">$1</mark>');
}

function LuaVaultPage() {
  const [snippets, setSnippets] = useState<Snippet[]>(() => (typeof window === "undefined" ? [] : loadAll()));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modal, setModal] = useState({ title: "", description: "", code: "", language: "lua" });
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const snippetsRef = useRef<Snippet[]>(snippets);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    snippetsRef.current = snippets;
    saveAll(snippets);
  }, [snippets]);

  useEffect(() => {
    if (!activeId && snippets.length > 0) setActiveId(snippets[0].id);
  }, [snippets, activeId]);

  const active = useMemo(() => snippets.find((s) => s.id === activeId) || null, [snippets, activeId]);

  const filteredSidebar = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q),
    );
  }, [snippets, query]);

  const lineHits = useMemo(() => {
    const q = query.trim();
    if (!q) return [] as { snippetId: string; title: string; line: number; text: string }[];
    const ql = q.toLowerCase();
    const out: { snippetId: string; title: string; line: number; text: string }[] = [];
    for (const s of snippets) {
      const lines = s.code.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(ql)) {
          out.push({ snippetId: s.id, title: s.title, line: i + 1, text: lines[i] });
          if (out.length > 500) return out;
        }
      }
    }
    return out;
  }, [snippets, query]);

  const addSnippet = useCallback((s: Omit<Snippet, "id" | "createdAt">) => {
    const entry: Snippet = { ...s, id: uid(), createdAt: Date.now() };
    setSnippets((prev) => [entry, ...prev]);
    setActiveId(entry.id);
    return entry;
  }, []);

  const importJson = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming: Snippet[] = Array.isArray(parsed) ? parsed : parsed?.snippets;
      if (!Array.isArray(incoming)) throw new Error("Invalid vault.json");
      const normalized: Snippet[] = incoming
        .filter((s) => s && typeof s.code === "string")
        .map((s) => ({
          id: s.id || uid(),
          title: String(s.title ?? "Untitled"),
          description: String(s.description ?? ""),
          code: String(s.code ?? ""),
          language: String(s.language ?? "lua"),
          createdAt: Number(s.createdAt ?? Date.now()),
        }));
      setSnippets((prev) => {
        const existing = new Set(prev.map((s) => s.id));
        return [...normalized.filter((s) => !existing.has(s.id)), ...prev];
      });
      toast.success(`Imported ${normalized.length} snippet${normalized.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to import JSON");
    }
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      const json = arr.filter((f) => /\.json$/i.test(f.name));
      const code = arr.filter((f) => ACCEPTED_CODE.test(f.name));
      const bad = arr.filter((f) => !ACCEPTED_CODE.test(f.name) && !/\.json$/i.test(f.name));
      if (bad.length) toast.error(`Rejected: ${bad.map((f) => f.name).join(", ")} (only .lua / .txt / .json)`);
      for (const f of json) await importJson(f);
      for (const f of code) {
        const text = await f.text();
        const language = /\.lua$/i.test(f.name) ? "lua" : "plaintext";
        addSnippet({ title: f.name.replace(/\.(lua|txt)$/i, ""), description: `Uploaded ${f.name}`, code: text, language });
      }
      if (code.length) toast.success(`Loaded ${code.length} file${code.length > 1 ? "s" : ""}`);
    },
    [addSnippet, importJson],
  );

  const exportAll = useCallback(() => {
    const blob = new Blob(
      [JSON.stringify({ snippets: snippetsRef.current, exportedAt: Date.now() }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vault-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const onEditorMount = (ed: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
    const provider = {
      triggerCharacters: [".", ":", "_"],
      provideCompletionItems: (
        model: MonacoEditor.ITextModel,
        position: { lineNumber: number; column: number },
      ) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const prefix = word.word.toLowerCase();
        const seen = new Map<string, { label: string; from: string }>();
        const idRe = /\b([A-Za-z_][A-Za-z0-9_]{1,})\b/g;
        for (const s of snippetsRef.current) {
          let m: RegExpExecArray | null;
          while ((m = idRe.exec(s.code))) {
            const name = m[1];
            if (name.length < 2) continue;
            if (prefix && !name.toLowerCase().startsWith(prefix)) continue;
            const key = `${name}::${s.id}`;
            if (!seen.has(key)) seen.set(key, { label: name, from: s.title });
            if (seen.size > 400) break;
          }
        }
        const suggestions = Array.from(seen.values()).map((v) => ({
          label: { label: v.label, description: `from: ${v.from}` },
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: v.label,
          detail: `from: ${v.from}`,
          range,
        }));
        for (const g of LUAU_GLOBALS) {
          if (prefix && !g.label.toLowerCase().startsWith(prefix)) continue;
          suggestions.push({
            label: { label: g.label, description: "Roblox Luau" },
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: g.label,
            detail: g.detail,
            documentation: g.doc,
            range,
          } as any);
        }
        return { suggestions };
      },
    };
    const d1 = monaco.languages.registerCompletionItemProvider("lua", provider);
    const d2 = monaco.languages.registerCompletionItemProvider("plaintext", provider);
    ed.onDidDispose(() => {
      d1.dispose();
      d2.dispose();
    });
  };

  const gotoHit = (snippetId: string, line: number) => {
    if (snippetId !== activeId) setActiveId(snippetId);
    // wait a tick for editor to update model
    setTimeout(() => {
      const ed = editorRef.current;
      if (!ed) return;
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    }, 60);
  };

  const updateActive = (patch: Partial<Snippet>) => {
    if (!active) return;
    setSnippets((prev) => prev.map((s) => (s.id === active.id ? { ...s, ...patch } : s)));
  };

  const deleteActive = () => {
    if (!active) return;
    if (!confirm(`Delete "${active.title}"?`)) return;
    setSnippets((prev) => prev.filter((s) => s.id !== active.id));
    setActiveId(null);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-[#1e1e1e] text-[#d4d4d4]">
      {/* Header / dropzone */}
      <header
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer border-2 border-dashed transition-all px-6 py-4 flex items-center justify-between gap-4 ${
          dragOver ? "border-cyan-400 bg-cyan-400/10" : "border-white/10 bg-[#252526]"
        }`}
      >
        <div className="flex items-center gap-3">
          <Upload size={20} className={dragOver ? "text-cyan-300" : "text-white/60"} />
          <div>
            <div className="font-semibold text-white">Lua Vault</div>
            <div className="text-xs text-white/60">
              Drop <code>.lua</code> / <code>.txt</code> files here, or click to browse
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              setModal({ title: "", description: "", code: "", language: "lua" });
              setShowModal(true);
            }}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded bg-cyan-500 text-black hover:bg-cyan-400"
          >
            <Plus size={14} /> New snippet
          </button>
          <button
            disabled
            className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded bg-white/5 text-white/40 cursor-not-allowed"
            title="Reserved for future"
          >
            <Play size={14} /> Run
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".lua,.txt"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <aside className="w-64 border-r border-white/10 bg-[#252526] flex flex-col">
          <div className="p-2 border-b border-white/10">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search everything…"
                className="w-full pl-7 pr-2 py-1.5 text-sm bg-[#1e1e1e] border border-white/10 rounded focus:border-cyan-400 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {filteredSidebar.length === 0 ? (
              <div className="p-3 text-xs text-white/40">No snippets.</div>
            ) : (
              filteredSidebar.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 border-l-2 hover:bg-white/5 ${
                    s.id === activeId ? "border-cyan-400 bg-white/5" : "border-transparent"
                  }`}
                >
                  <FileCode size={14} className="text-white/50 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm truncate">{s.title || "(untitled)"}</div>
                    <div className="text-[10px] text-white/40 truncate">{s.language}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0">
          {active ? (
            <>
              <div className="px-4 py-2 border-b border-white/10 bg-[#252526] flex items-center gap-2">
                <input
                  value={active.title}
                  onChange={(e) => updateActive({ title: e.target.value })}
                  className="bg-transparent text-sm font-semibold text-white focus:outline-none focus:border-b focus:border-cyan-400"
                />
                <input
                  value={active.description}
                  onChange={(e) => updateActive({ description: e.target.value })}
                  placeholder="Description…"
                  className="flex-1 bg-transparent text-xs text-white/60 focus:outline-none"
                />
                <select
                  value={active.language}
                  onChange={(e) => updateActive({ language: e.target.value })}
                  className="text-xs bg-[#1e1e1e] border border-white/10 rounded px-2 py-1"
                >
                  <option value="lua">lua</option>
                  <option value="plaintext">plaintext</option>
                  <option value="javascript">javascript</option>
                  <option value="typescript">typescript</option>
                  <option value="python">python</option>
                </select>
                <button
                  onClick={deleteActive}
                  className="p-1.5 rounded text-white/60 hover:text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <Editor
                  height="100%"
                  theme="vs-dark"
                  language={active.language}
                  value={active.code}
                  onChange={(v) => updateActive({ code: v ?? "" })}
                  onMount={onEditorMount}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    tabSize: 2,
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
              No snippet selected. Drop a file or create one.
            </div>
          )}

          {/* Jarvis Search Panel */}
          <section className="h-56 border-t border-white/10 bg-[#1e1e1e] flex flex-col">
            <div className="px-3 py-1.5 text-[11px] uppercase tracking-widest text-cyan-300/80 border-b border-white/10">
              Jarvis Search {query && <span className="text-white/40 normal-case tracking-normal">— {lineHits.length} line hits for “{query}”</span>}
            </div>
            <div className="flex-1 overflow-auto font-mono text-xs">
              {!query ? (
                <div className="p-3 text-white/40">Type in the search bar to scan every line across all snippets.</div>
              ) : lineHits.length === 0 ? (
                <div className="p-3 text-white/40">No matches.</div>
              ) : (
                lineHits.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => gotoHit(h.snippetId, h.line)}
                    className="w-full text-left px-3 py-1 flex gap-3 hover:bg-cyan-500/10 border-l-2 border-transparent hover:border-cyan-400"
                  >
                    <span className="text-white/40 shrink-0 w-40 truncate">{h.title}:{h.line}</span>
                    <span
                      className="text-white/80 truncate"
                      dangerouslySetInnerHTML={{ __html: highlight(h.text, query) }}
                    />
                  </button>
                ))
              )}
            </div>
          </section>
        </main>
      </div>

      {/* Manual paste modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-[#252526] border border-white/10 rounded-lg w-full max-w-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-white">New snippet</div>
            <input
              value={modal.title}
              onChange={(e) => setModal({ ...modal, title: e.target.value })}
              placeholder="Title"
              className="w-full bg-[#1e1e1e] border border-white/10 rounded px-2 py-1.5 text-sm focus:border-cyan-400 focus:outline-none"
            />
            <input
              value={modal.description}
              onChange={(e) => setModal({ ...modal, description: e.target.value })}
              placeholder="Description"
              className="w-full bg-[#1e1e1e] border border-white/10 rounded px-2 py-1.5 text-sm focus:border-cyan-400 focus:outline-none"
            />
            <div className="flex gap-2">
              <select
                value={modal.language}
                onChange={(e) => setModal({ ...modal, language: e.target.value })}
                className="text-xs bg-[#1e1e1e] border border-white/10 rounded px-2 py-1"
              >
                <option value="lua">lua</option>
                <option value="plaintext">plaintext</option>
                <option value="javascript">javascript</option>
                <option value="typescript">typescript</option>
                <option value="python">python</option>
              </select>
            </div>
            <textarea
              value={modal.code}
              onChange={(e) => setModal({ ...modal, code: e.target.value })}
              placeholder="Paste code here…"
              rows={12}
              className="w-full bg-[#1e1e1e] border border-white/10 rounded p-2 text-xs font-mono focus:border-cyan-400 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!modal.title.trim() && !modal.code.trim()) {
                    toast.error("Title or code required");
                    return;
                  }
                  addSnippet({
                    title: modal.title.trim() || "Untitled",
                    description: modal.description.trim(),
                    code: modal.code,
                    language: modal.language,
                  });
                  setShowModal(false);
                  toast.success("Snippet saved");
                }}
                className="text-xs px-3 py-1.5 rounded bg-cyan-500 text-black hover:bg-cyan-400"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Silence unused loader import in some bundler configs
void loader;
