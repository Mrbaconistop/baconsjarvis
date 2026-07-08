import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BookOpen, Trash2, RefreshCw, ExternalLink, Plus, Power, PowerOff } from "lucide-react";
import {
  addLibraryFromUrl,
  listLibraries,
  refreshLibrary,
  removeLibrary,
  subscribeLibraries,
  toggleLibrary,
  type LibraryEntry,
} from "@/lib/libraries";

export function LibraryManager() {
  const [libs, setLibs] = useState<LibraryEntry[]>(() => listLibraries());
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => subscribeLibraries(() => setLibs(listLibraries())), []);

  async function onAdd() {
    if (!url.trim()) return;
    setAdding(true);
    try {
      const entry = await addLibraryFromUrl(url, name || undefined, note || undefined);
      toast.success(`Loaded "${entry.name}" (${(entry.bytes / 1024).toFixed(1)} kb)`);
      setUrl("");
      setName("");
      setNote("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load library");
    } finally {
      setAdding(false);
    }
  }

  async function onRefresh(id: string) {
    try {
      const updated = await refreshLibrary(id);
      if (updated) toast.success(`Refreshed "${updated.name}"`);
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    }
  }

  const activeCount = libs.filter((l) => l.active).length;
  const totalBytes = libs.filter((l) => l.active).reduce((s, l) => s + l.bytes, 0);

  return (
    <section className="space-y-4">
      <div className="glass-strong hud-corners rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono text-[10px] tracking-[0.3em] text-arc flex items-center gap-2">
            <BookOpen size={12} /> KNOWLEDGE LIBRARIES
          </div>
          <div className="text-[10px] font-mono text-hud-dim">
            {activeCount} active · {(totalBytes / 1024).toFixed(1)} kb injected
          </div>
        </div>
        <p className="text-xs text-hud-dim mb-4">
          Paste any raw text/code URL (GitHub raw, Gist, docs, etc.). Active libraries are attached to every JARVIS
          message so answers stay within their real API — no invented functions.
        </p>
        <div className="grid gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://raw.githubusercontent.com/…/lib.lua"
            className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note / how to use it (optional)"
              className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
            />
          </div>
          <button
            onClick={onAdd}
            disabled={adding || !url.trim()}
            className="self-start text-xs px-4 py-2 rounded-md bg-arc text-arc-foreground shadow-arc hover:opacity-90 transition disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Plus size={12} /> {adding ? "Fetching…" : "Add library"}
          </button>
        </div>
      </div>

      <div className="glass-strong hud-corners rounded-xl p-5">
        <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-3">LOADED ({libs.length})</div>
        {libs.length === 0 ? (
          <div className="text-xs text-hud-dim">No libraries loaded yet.</div>
        ) : (
          <div className="space-y-2">
            {libs.map((lib) => {
              const open = expanded === lib.id;
              return (
                <div
                  key={lib.id}
                  className={`rounded-md border transition ${
                    lib.active ? "border-arc/40 bg-arc/5" : "border-arc/10 bg-background/30"
                  }`}
                >
                  <div className="flex items-center gap-2 p-3">
                    <button
                      onClick={() => toggleLibrary(lib.id)}
                      className={`p-1.5 rounded ${
                        lib.active ? "text-arc hover:bg-arc/15" : "text-hud-dim hover:bg-arc/10"
                      }`}
                      title={lib.active ? "Active — click to disable" : "Disabled — click to enable"}
                    >
                      {lib.active ? <Power size={14} /> : <PowerOff size={14} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{lib.name}</div>
                      <div className="text-[10px] font-mono text-hud-dim truncate">
                        {(lib.bytes / 1024).toFixed(1)} kb · fetched{" "}
                        {new Date(lib.fetchedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                      </div>
                      {lib.note && <div className="text-[11px] text-hud-dim mt-0.5 italic">{lib.note}</div>}
                    </div>
                    <a
                      href={lib.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded text-hud-dim hover:text-arc hover:bg-arc/10"
                      title="Open source URL"
                    >
                      <ExternalLink size={14} />
                    </a>
                    <button
                      onClick={() => onRefresh(lib.id)}
                      className="p-1.5 rounded text-hud-dim hover:text-arc hover:bg-arc/10"
                      title="Re-fetch"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      onClick={() => setExpanded(open ? null : lib.id)}
                      className="text-[10px] font-mono px-2 py-1 rounded border border-arc/20 text-hud-dim hover:text-arc"
                    >
                      {open ? "HIDE" : "PEEK"}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Remove "${lib.name}"?`)) removeLibrary(lib.id);
                      }}
                      className="p-1.5 rounded text-hud-dim hover:text-critical hover:bg-critical/10"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {open && (
                    <pre className="mx-3 mb-3 p-3 rounded bg-background/60 border border-arc/10 text-[11px] font-mono overflow-auto max-h-64 whitespace-pre-wrap break-words">
                      {lib.content.slice(0, 6000)}
                      {lib.content.length > 6000 ? "\n… (truncated in preview)" : ""}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
