import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useRef } from "react";
import { getCustomTab, updateCustomTab, deleteCustomTab, createCustomTab } from "@/lib/custom-tabs.functions";
import { listThreads, createThread, deleteThread, getMessages } from "@/lib/chat.functions";
import { PageHeader } from "@/components/jarvis/HudBits";
import { ChatWindow } from "@/components/jarvis/ChatWindow";
import { askCodeAssistant } from "@/lib/jarvis.functions";
import {
  Pencil,
  Save,
  Trash2,
  X,
  Sparkles,
  MessageSquare,
  Plus,
  PanelRightOpen,
  PanelRightClose,
  Maximize2,
  Minimize2,
  Settings,
  History,
  Download,
  Upload,
  RotateCcw,
  Check,
  RefreshCw,
  Code2,
  FilePlus,
  GitPullRequest,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------
type TabConfig = {
  layout: "default" | "browser" | "chat" | "minimal";
  theme: "dark" | "light" | "auto";
  containerPadding: number;
};

type Snapshot = {
  id: string;
  slug: string;
  label: string;
  icon: string;
  description: string | null;
  content_html: string;
  config: TabConfig;
  updated_at: string;
  timestamp: number;
};

// ------------------------------------------------------------
// Route
// ------------------------------------------------------------
export const Route = createFileRoute("/_authenticated/tabs/$slug")({
  ssr: false,
  head: () => ({ meta: [{ title: "Custom Tab — JARVIS" }] }),
  component: CustomTabPage,
});

// ------------------------------------------------------------
// Page Component
// ------------------------------------------------------------
function CustomTabPage() {
  const { slug } = Route.useParams();
  const qc = useQueryClient();
  const fetchTab = useServerFn(getCustomTab);
  const doUpdate = useServerFn(updateCustomTab);
  const doDelete = useServerFn(deleteCustomTab);
  const doCreate = useServerFn(createCustomTab);
  const askAssistant = useServerFn(askCodeAssistant);

  // --- Data ---
  const {
    data: tab,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["custom-tab", slug],
    queryFn: () => fetchTab({ data: { slug } }),
  });

  // Realtime refresh
  useEffect(() => {
    const ch = supabase
      .channel(`custom_tabs:${slug}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "custom_tabs" }, () => {
        refetch();
        qc.invalidateQueries({ queryKey: ["custom-tabs-nav"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [slug, refetch, qc]);

  // --- State ---
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState<TabConfig>({
    layout: "default",
    theme: "dark",
    containerPadding: 16,
  });

  // Fullscreen (parent‑side)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`tab-fullscreen-${tab?.id}`) === "true";
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Modals
  const [showConfig, setShowConfig] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importPreview, setImportPreview] = useState<any>(null);

  // Assistant toggle
  const [assistantOpen, setAssistantOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem("tab-assistant-open");
    return v === null ? true : v === "1";
  });

  // Auto‑save debounce
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Effects ---
  useEffect(() => {
    if (tab) {
      setDraft(tab.content_html || "");
      setLabel(tab.label || "");
      setConfig(tab.config || { layout: "default", theme: "dark", containerPadding: 16 });
    }
  }, [tab]);

  // Persist fullscreen state
  useEffect(() => {
    if (tab?.id) {
      localStorage.setItem(`tab-fullscreen-${tab.id}`, isFullscreen ? "true" : "false");
    }
    if (isFullscreen) {
      document.documentElement.classList.add("tab-fullscreen-mode");
    } else {
      document.documentElement.classList.remove("tab-fullscreen-mode");
    }
    return () => {
      document.documentElement.classList.remove("tab-fullscreen-mode");
    };
  }, [isFullscreen, tab?.id]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("tab-assistant-open", assistantOpen ? "1" : "0");
    }
  }, [assistantOpen]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case "s": // Ctrl+S -> Save
            e.preventDefault();
            if (editing) save();
            break;
          case "e": // Ctrl+E -> Toggle edit
            e.preventDefault();
            if (editing) save();
            else setEditing(true);
            break;
          case "f": // Ctrl+Shift+F -> Fullscreen (parent)
            if (e.shiftKey) {
              e.preventDefault();
              setIsFullscreen(!isFullscreen);
            }
            break;
          case "r": // Ctrl+Shift+R -> Reload
            if (e.shiftKey) {
              e.preventDefault();
              reloadIframe();
            }
            break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  // ---- postMessage listener for storage + AI (using server function) ----
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const { type, key, value, requestId, code, prompt, language } = event.data || {};

      // Storage handlers
      if (type === "storage-get") {
        const stored = localStorage.getItem(key);
        const iframe = iframeRef.current;
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            {
              type: "storage-get-response",
              key,
              value: stored,
              requestId,
            },
            "*",
          );
        }
        return;
      }
      if (type === "storage-set") {
        localStorage.setItem(key, value);
        const iframe = iframeRef.current;
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            {
              type: "storage-set-response",
              key,
              requestId,
            },
            "*",
          );
        }
        return;
      }

      // AI Request – now using the server function
      if (type === "ai-request" && code !== undefined && prompt !== undefined) {
        try {
          const result = await askAssistant({
            data: { code, prompt, language: language || "plaintext" },
          });
          const iframe = iframeRef.current;
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(
              {
                type: "ai-response",
                response: result.response,
                requestId,
              },
              "*",
            );
          }
        } catch (err: any) {
          const iframe = iframeRef.current;
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(
              {
                type: "ai-response",
                response: `Sorry, Sir. I encountered an error: ${err.message}`,
                requestId,
              },
              "*",
            );
          }
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [askAssistant]);

  // ---- Helpers ----
  const srcDoc = useMemo(() => {
    return wrapHtml(draft, config);
  }, [draft, config]);

  async function save() {
    if (!tab) return;
    await doUpdate({
      data: {
        id: tab.id,
        content_html: draft,
        label,
        config,
      },
    });
    toast.success("Tab saved");
    setEditing(false);
    saveSnapshot({
      id: tab.id,
      slug: tab.slug,
      label,
      icon: tab.icon || "Sparkles",
      description: tab.description || null,
      content_html: draft,
      config,
      updated_at: new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: ["custom-tab", slug] });
    qc.invalidateQueries({ queryKey: ["custom-tabs-nav"] });
  }

  async function remove() {
    if (!tab) return;
    if (!confirm(`Delete "${tab.label}"?`)) return;
    await doDelete({ data: { id: tab.id } });
    toast.success("Tab deleted");
    qc.invalidateQueries({ queryKey: ["custom-tabs-nav"] });
    window.location.href = "/dashboard";
  }

  function reloadIframe() {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
    toast.info("Iframe reloaded");
  }

  // ---- Format / Template helpers ----
  function formatCode() {
    let formatted = draft
      .replace(/>\s*</g, ">\n<")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
    let indent = 0;
    const lines = formatted.split("\n");
    const indented = lines.map((line) => {
      const close = line.match(/<\/[^>]+>/);
      if (close) indent = Math.max(0, indent - 1);
      const result = "  ".repeat(indent) + line;
      const open = line.match(/<[^/][^>]*>/);
      if (open && !line.includes("/>")) indent++;
      return result;
    });
    setDraft(indented.join("\n"));
    toast.info("Code formatted");
  }

  function insertTemplate() {
    const template = `<!-- Paste your HTML/JS here -->
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0b1220;color:#e6f2ff;font-family:system-ui;">
  <h1>Hello, JARVIS!</h1>
  <p>This tab was built from a template.</p>
  <button onclick="alert('Clicked!')" style="padding:8px 16px;background:#7c3aed;border:none;border-radius:8px;color:white;cursor:pointer;">Click me</button>
  <div id="counter" style="margin-top:20px;font-size:24px;">0</div>
</div>
<script>
  let count = 0;
  document.querySelector('button')?.addEventListener('click', () => {
    document.getElementById('counter').textContent = ++count;
  });
<\/script>`;
    setDraft(template);
    toast.info("Template inserted");
  }

  // ---- Versioning ----
  function saveSnapshot(t: any) {
    const key = `tab-versions-${t.id}`;
    const stored = localStorage.getItem(key);
    let versions: Snapshot[] = stored ? JSON.parse(stored) : [];
    const newSnap: Snapshot = { ...t, timestamp: Date.now() };
    versions = [newSnap, ...versions.filter((v) => v.id === t.id)];
    if (versions.length > 5) versions = versions.slice(0, 5);
    localStorage.setItem(key, JSON.stringify(versions));
  }

  function getSnapshots(id: string): Snapshot[] {
    const key = `tab-versions-${id}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  }

  async function revertSnapshot(snap: Snapshot) {
    if (!tab) return;
    if (!confirm(`Revert to version from ${new Date(snap.timestamp).toLocaleString()}?`)) return;
    await doUpdate({
      data: {
        id: tab.id,
        label: snap.label,
        icon: snap.icon,
        description: snap.description,
        content_html: snap.content_html,
        config: snap.config,
      },
    });
    toast.success("Reverted to snapshot");
    setShowVersions(false);
    qc.invalidateQueries({ queryKey: ["custom-tab", slug] });
    qc.invalidateQueries({ queryKey: ["custom-tabs-nav"] });
  }

  // ---- Export / Import ----
  function exportTab() {
    if (!tab) return;
    const exportData = {
      id: tab.id,
      slug: tab.slug,
      label: tab.label,
      icon: tab.icon,
      description: tab.description,
      content_html: tab.content_html,
      config: tab.config || { layout: "default", theme: "dark", containerPadding: 16 },
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tab-${tab.slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Tab exported");
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        if (!json.label || !json.content_html) {
          toast.error("Invalid import file: missing label or content_html");
          return;
        }
        setImportPreview(json);
        setShowImport(true);
      } catch {
        toast.error("Invalid JSON file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function confirmImport() {
    if (!importPreview) return;
    try {
      const { id, slug: oldSlug, label, icon, description, content_html, config } = importPreview;
      const existing = await fetchTab({ data: { slug: oldSlug } }).catch(() => null);
      if (existing && existing.id) {
        if (!confirm(`A tab with slug "${oldSlug}" already exists. Overwrite it?`)) return;
        await doUpdate({
          data: {
            id: existing.id,
            label,
            icon: icon || "Sparkles",
            description: description || null,
            content_html,
            config: config || { layout: "default", theme: "dark", containerPadding: 16 },
          },
        });
        toast.success(`Tab "${label}" updated from import`);
      } else {
        const newTab = await doCreate({
          data: {
            label,
            icon: icon || "Sparkles",
            description: description || null,
            content_html,
            config: config || { layout: "default", theme: "dark", containerPadding: 16 },
            slug: oldSlug,
          },
        });
        toast.success(`Tab "${label}" created from import`);
        window.location.href = `/tabs/${newTab.slug}`;
      }
      setShowImport(false);
      setImportPreview(null);
      qc.invalidateQueries({ queryKey: ["custom-tabs-nav"] });
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    }
  }

  // ---- Render ----
  if (isLoading) {
    return <div className="p-8 font-mono text-sm text-hud-dim">Loading…</div>;
  }
  if (!tab) {
    return (
      <div className="p-8">
        <div className="glass-strong hud-corners rounded-xl p-8 max-w-md">
          <div className="font-mono text-[10px] tracking-[0.3em] text-arc">TAB · NOT FOUND</div>
          <p className="mt-3 text-sm text-muted-foreground">
            No custom tab named "{slug}", Sir. Ask JARVIS in chat to create one.
          </p>
          <Link to="/dashboard" className="inline-block mt-4 text-arc text-sm underline">
            Back to command
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex flex-col h-screen ${isFullscreen ? "fixed inset-0 z-[9999] bg-background" : ""}`}
    >
      <div className={`px-4 sm:px-8 pt-4 ${isFullscreen ? "hidden" : ""}`}>
        <PageHeader
          tag={`TAB · ${tab.slug.toUpperCase()}`}
          title={tab.label}
          subtitle={tab.description || "Custom mini-app created by JARVIS."}
        />
      </div>

      <div
        className={`px-4 sm:px-8 pb-3 flex flex-wrap items-center gap-2 ${isFullscreen ? "border-b border-arc/15 bg-background/60 backdrop-blur sticky top-0 z-10" : ""}`}
      >
        {!editing ? (
          <>
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
              title="Edit (Ctrl+E)"
            >
              <Pencil size={12} /> Edit
            </button>
            <button
              onClick={() => setShowConfig(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
            >
              <Settings size={12} /> Config
            </button>
            <button
              onClick={() => setShowVersions(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
            >
              <History size={12} /> Versions
            </button>
            <button
              onClick={exportTab}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
            >
              <Download size={12} /> Export
            </button>
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10 cursor-pointer">
              <Upload size={12} /> Import
              <input type="file" accept=".json" className="hidden" onChange={handleImportFile} />
            </label>
            <button
              onClick={reloadIframe}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
              title="Reload iframe (Ctrl+Shift+R)"
            >
              <RefreshCw size={12} /> Reload
            </button>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
              title="Sync from AI (refresh from database)"
            >
              <GitPullRequest size={12} /> Sync AI
            </button>
          </>
        ) : (
          <>
            <button
              onClick={save}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-arc text-arc-foreground shadow-arc text-xs"
            >
              <Save size={12} /> Save (Ctrl+S)
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraft(tab.content_html);
                setLabel(tab.label);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/20 text-xs"
            >
              <X size={12} /> Cancel
            </button>
            <button
              onClick={formatCode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
            >
              <Code2 size={12} /> Format
            </button>
            <button
              onClick={insertTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
            >
              <FilePlus size={12} /> Template
            </button>
          </>
        )}

        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10 ml-auto"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen (Ctrl+Shift+F)"}
        >
          {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>

        <button
          onClick={() => setAssistantOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
          title={assistantOpen ? "Hide JARVIS" : "Show JARVIS"}
        >
          {assistantOpen ? <PanelRightClose size={12} /> : <PanelRightOpen size={12} />}
          JARVIS
        </button>

        <button
          onClick={remove}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-critical/40 text-critical text-xs hover:bg-critical/10"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>

      <div className={`flex-1 min-h-0 px-4 sm:px-8 pb-6 flex gap-4 ${isFullscreen ? "pt-0" : ""}`}>
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="grid lg:grid-cols-2 gap-4 h-full">
              <div className="flex flex-col gap-2">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none"
                  placeholder="Tab label"
                />
                <textarea
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (saveTimeout.current) clearTimeout(saveTimeout.current);
                    saveTimeout.current = setTimeout(() => {
                      if (tab) {
                        doUpdate({
                          data: { id: tab.id, content_html: e.target.value, label, config },
                        }).catch(() => {});
                      }
                    }, 500);
                  }}
                  spellCheck={false}
                  className="flex-1 min-h-[300px] bg-background/40 border border-arc/20 rounded-md p-3 text-xs font-mono focus:border-arc focus:outline-none resize-none"
                  placeholder="<!-- Write HTML/CSS/JS here. It renders in a sandboxed iframe. -->"
                />
                <div className="text-[10px] text-hud-dim flex gap-3">
                  <span>Ctrl+S → Save</span>
                  <span>Ctrl+E → Toggle edit</span>
                  <span>Ctrl+Shift+F → Fullscreen</span>
                </div>
              </div>
              <div className="rounded-md overflow-hidden border border-arc/20 bg-white">
                <iframe
                  title="preview"
                  srcDoc={wrapHtml(draft, config)}
                  sandbox="allow-scripts allow-same-origin allow-fullscreen"
                  className="w-full h-full min-h-[300px]"
                />
              </div>
            </div>
          ) : tab.content_html?.trim() ? (
            <iframe
              ref={iframeRef}
              title={tab.label}
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-fullscreen"
              className="w-full h-full min-h-[400px] rounded-2xl border border-arc/20 bg-white shadow-arc"
            />
          ) : (
            <div className="glass hud-corners rounded-xl p-8 text-center">
              <Sparkles className="mx-auto text-arc" size={20} />
              <p className="mt-3 text-sm text-muted-foreground">
                This tab is empty. Ask JARVIS in the side panel to build it — try "make it a bubbly pomodoro timer".
              </p>
            </div>
          )}
        </div>

        {assistantOpen && (
          <aside className="hidden lg:flex w-[380px] shrink-0 flex-col rounded-2xl border border-arc/25 bg-background/40 backdrop-blur overflow-hidden shadow-arc">
            <TabAssistant tabSlug={slug} tabLabel={tab.label} />
          </aside>
        )}
      </div>

      {showConfig && (
        <ConfigModal
          config={config}
          label={label}
          icon={tab.icon || "Sparkles"}
          description={tab.description || ""}
          onSave={async (newConfig, newLabel, newIcon, newDesc) => {
            setConfig(newConfig);
            setLabel(newLabel);
            await doUpdate({
              data: {
                id: tab.id,
                label: newLabel,
                icon: newIcon || "Sparkles",
                description: newDesc || null,
                config: newConfig,
              },
            });
            toast.success("Configuration updated");
            setShowConfig(false);
            qc.invalidateQueries({ queryKey: ["custom-tab", slug] });
            qc.invalidateQueries({ queryKey: ["custom-tabs-nav"] });
          }}
          onClose={() => setShowConfig(false)}
        />
      )}

      {showVersions && (
        <VersionsModal
          tabId={tab.id}
          snapshots={getSnapshots(tab.id)}
          onRevert={revertSnapshot}
          onClose={() => setShowVersions(false)}
        />
      )}

      {showImport && importPreview && (
        <ImportPreviewModal
          data={importPreview}
          onConfirm={confirmImport}
          onClose={() => {
            setShowImport(false);
            setImportPreview(null);
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Subcomponents
// ------------------------------------------------------------
function TabAssistant({ tabSlug, tabLabel }: { tabSlug: string; tabLabel: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listThreads);
  const create = useServerFn(createThread);
  const remove = useServerFn(deleteThread);
  const fetchMessages = useServerFn(getMessages);

  const { data: threads = [] } = useQuery({
    queryKey: ["tab-threads", tabSlug],
    queryFn: () => list({ data: { tabSlug } }),
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId && threads.length) setActiveId(threads[0].id);
  }, [threads, activeId]);

  const { data: initial = [], isLoading } = useQuery({
    queryKey: ["tab-messages", activeId],
    queryFn: () => (activeId ? fetchMessages({ data: { threadId: activeId } }) : Promise.resolve([])),
    enabled: !!activeId,
  });

  async function newThread() {
    const t = await create({ data: { tabSlug, title: `${tabLabel} chat` } });
    qc.invalidateQueries({ queryKey: ["tab-threads", tabSlug] });
    setActiveId(t.id);
  }
  async function onDelete(id: string) {
    await remove({ data: { id } });
    qc.invalidateQueries({ queryKey: ["tab-threads", tabSlug] });
    if (id === activeId) setActiveId(null);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2.5 border-b border-arc/15 flex items-center gap-2 bg-gradient-to-r from-arc/10 to-transparent">
        <div className="size-6 rounded-full bg-arc/20 border border-arc/30 flex items-center justify-center text-arc font-mono text-[9px]">
          J
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-mono tracking-[0.25em] text-arc/80">TAB · JARVIS</div>
          <div className="text-xs text-muted-foreground truncate">Scoped to "{tabLabel}"</div>
        </div>
        <button
          onClick={newThread}
          className="p-1.5 rounded-full bg-arc text-arc-foreground shadow-arc hover:opacity-90"
          title="New conversation"
        >
          <Plus size={12} />
        </button>
      </div>

      {threads.length > 0 && (
        <div className="px-2 py-2 border-b border-arc/10 flex gap-1 overflow-x-auto scrollbar-thin">
          {threads.map((t: any) => {
            const active = t.id === activeId;
            return (
              <div
                key={t.id}
                className={`group shrink-0 flex items-center rounded-full text-[10px] pl-2.5 pr-1 py-1 border transition ${active ? "bg-arc/20 border-arc/40 text-foreground" : "border-arc/15 text-hud-dim hover:bg-arc/10"}`}
              >
                <button onClick={() => setActiveId(t.id)} className="flex items-center gap-1 max-w-[140px]">
                  <MessageSquare size={10} />
                  <span className="truncate">{t.title}</span>
                </button>
                <button
                  onClick={() => onDelete(t.id)}
                  className="ml-1 p-0.5 opacity-0 group-hover:opacity-100 text-hud-dim hover:text-critical"
                  aria-label="Delete"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex-1 min-h-0">
        {!activeId ? (
          <div className="p-6 text-center text-xs text-hud-dim">
            <Sparkles className="mx-auto text-arc mb-2" size={16} />
            <p>Start a conversation scoped to this tab.</p>
            <button
              onClick={newThread}
              className="mt-3 px-3 py-1.5 rounded-full bg-arc text-arc-foreground shadow-arc text-[11px]"
            >
              <Plus size={11} className="inline mr-1" /> New chat
            </button>
          </div>
        ) : isLoading ? (
          <div className="p-4 text-xs text-hud-dim font-mono">Loading…</div>
        ) : (
          <ChatWindow key={activeId} threadId={activeId} initial={initial as any} tabSlug={tabSlug} compact />
        )}
      </div>
    </div>
  );
}

function ConfigModal({
  config,
  label,
  icon,
  description,
  onSave,
  onClose,
}: {
  config: TabConfig;
  label: string;
  icon: string;
  description: string;
  onSave: (config: TabConfig, label: string, icon: string, description: string) => Promise<void>;
  onClose: () => void;
}) {
  const [localConfig, setLocalConfig] = useState<TabConfig>(config);
  const [localLabel, setLocalLabel] = useState(label);
  const [localIcon, setLocalIcon] = useState(icon);
  const [localDesc, setLocalDesc] = useState(description);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(localConfig, localLabel, localIcon, localDesc);
    } catch (e) {
      toast.error("Failed to save config");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="glass-strong hud-corners rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg">Tab Configuration</h2>
          <button onClick={onClose} className="text-hud-dim hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-hud-dim mb-1">LABEL</label>
            <input
              value={localLabel}
              onChange={(e) => setLocalLabel(e.target.value)}
              className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-hud-dim mb-1">ICON (Lucide name)</label>
            <input
              value={localIcon}
              onChange={(e) => setLocalIcon(e.target.value)}
              placeholder="Sparkles"
              className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-hud-dim mb-1">DESCRIPTION</label>
            <textarea
              value={localDesc}
              onChange={(e) => setLocalDesc(e.target.value)}
              rows={2}
              className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none resize-none"
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-hud-dim mb-1">LAYOUT</label>
            <select
              value={localConfig.layout}
              onChange={(e) => setLocalConfig({ ...localConfig, layout: e.target.value as any })}
              className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
            >
              <option value="default">Default (content only)</option>
              <option value="browser">Browser (toolbar header)</option>
              <option value="chat">Chat (bubbles)</option>
              <option value="minimal">Minimal (no chrome)</option>
            </select>
          </div>
          <div>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-hud-dim mb-1">THEME</label>
            <select
              value={localConfig.theme}
              onChange={(e) => setLocalConfig({ ...localConfig, theme: e.target.value as any })}
              className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="auto">Auto (system)</option>
            </select>
          </div>
          <div>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-hud-dim mb-1">
              CONTAINER PADDING: {localConfig.containerPadding}px
            </label>
            <input
              type="range"
              min="0"
              max="80"
              value={localConfig.containerPadding}
              onChange={(e) => setLocalConfig({ ...localConfig, containerPadding: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-2 rounded border border-arc/20 hover:bg-arc/5">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-2 rounded bg-arc text-arc-foreground shadow-arc inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save size={12} /> {saving ? "Saving…" : "Save Config"}
          </button>
        </div>
      </div>
    </div>
  );
}

function VersionsModal({
  tabId,
  snapshots,
  onRevert,
  onClose,
}: {
  tabId: string;
  snapshots: Snapshot[];
  onRevert: (snap: Snapshot) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="glass-strong hud-corners rounded-xl p-6 w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg flex items-center gap-2">
            <History size={16} className="text-arc" /> Version History
          </h2>
          <button onClick={onClose} className="text-hud-dim hover:text-foreground">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3">
          {snapshots.length === 0 ? (
            <div className="text-sm text-hud-dim">No versions saved yet. Save the tab to create a snapshot.</div>
          ) : (
            snapshots.map((snap, i) => (
              <div key={i} className="glass p-3 rounded-md border border-arc/15 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{snap.label}</div>
                  <div className="text-xs text-hud-dim font-mono">
                    {new Date(snap.timestamp).toLocaleString()} · {snap.config.layout}
                  </div>
                </div>
                <button
                  onClick={() => onRevert(snap)}
                  className="text-xs flex items-center gap-1 px-2 py-1 rounded border border-arc/30 hover:bg-arc/10"
                >
                  <RotateCcw size={12} /> Revert
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ImportPreviewModal({
  data,
  onConfirm,
  onClose,
}: {
  data: any;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div className="glass-strong hud-corners rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg flex items-center gap-2">
            <Upload size={16} className="text-arc" /> Import Preview
          </h2>
          <button onClick={onClose} className="text-hud-dim hover:text-foreground">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-hud-dim">Label:</span> {data.label}
          </div>
          <div>
            <span className="text-hud-dim">Icon:</span> {data.icon || "Sparkles"}
          </div>
          <div>
            <span className="text-hud-dim">Slug:</span> {data.slug}
          </div>
          <div>
            <span className="text-hud-dim">Layout:</span> {data.config?.layout || "default"}
          </div>
          <div>
            <span className="text-hud-dim">Content:</span> {data.content_html?.length || 0} chars
          </div>
          <div>
            <span className="text-hud-dim">Exported:</span> {new Date(data.exported_at).toLocaleString()}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-2 rounded border border-arc/20 hover:bg-arc/5">
            Cancel
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
            }}
            disabled={busy}
            className="text-xs px-3 py-2 rounded bg-arc text-arc-foreground shadow-arc inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Check size={12} /> {busy ? "Importing…" : "Confirm Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Helper: wrapHtml
// ------------------------------------------------------------
function wrapHtml(body: string, config: TabConfig): string {
  const theme = config.theme === "auto" ? "light dark" : config.theme;
  const padding = config.containerPadding || 16;
  const layoutClass = config.layout || "default";

  let layoutStyles = "";
  if (layoutClass === "browser") {
    layoutStyles = `
      body { padding: 0; background: #111; }
      .browser-bar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: #1a1a1a; border-bottom: 1px solid #333; font-size: 13px; font-family: system-ui; color: #ccc; }
      .browser-bar .dots { display: flex; gap: 6px; }
      .browser-bar .dots span { display: block; width: 12px; height: 12px; border-radius: 50%; background: #555; }
      .browser-bar .url { flex: 1; background: #222; padding: 4px 12px; border-radius: 6px; color: #aaa; text-align: center; font-size: 12px; }
      .browser-body { padding: ${padding}px; }
    `;
  } else if (layoutClass === "chat") {
    layoutStyles = `
      body { background: #0b1220; padding: ${padding}px; font-family: system-ui; }
      .chat-bubble { max-width: 80%; padding: 10px 16px; border-radius: 18px; margin-bottom: 8px; background: #1a2330; color: #e6f2ff; }
      .chat-bubble.user { background: #2a4a6a; margin-left: auto; border-bottom-right-radius: 4px; }
      .chat-bubble.bot { border-bottom-left-radius: 4px; }
      .chat-bubble p { margin: 0; }
    `;
  } else if (layoutClass === "minimal") {
    layoutStyles = `body { background: transparent; padding: 0; }`;
  } else {
    layoutStyles = `body { padding: ${padding}px; }`;
  }

  return `<!doctype html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root { color-scheme: ${theme}; }
  html,body {
    margin:0;
    min-height:100vh;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    background: ${config.theme === "light" ? "#f5f7fa" : "#0b1220"};
    color: ${config.theme === "light" ? "#1a1a1a" : "#e6f2ff"};
  }
  ${layoutStyles}
  .layout-${layoutClass} { display: block; }
  a { color: #4dd0ff; }
  button, input, select, textarea { font: inherit; }
  * { box-sizing: border-box; }
</style>
</head>
<body class="layout-${layoutClass}">
  ${
    layoutClass === "browser"
      ? `
    <div class="browser-bar">
      <div class="dots"><span style="background:#ff5f56"/><span style="background:#ffbd2e"/><span style="background:#27c93f"/></div>
      <div class="url">${window.location.host}</div>
    </div>
    <div class="browser-body">${body}</div>
  `
      : body
  }
</body>
</html>`;
}
