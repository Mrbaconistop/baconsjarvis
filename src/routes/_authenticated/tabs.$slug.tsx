import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useRef } from "react";
import { getCustomTab, updateCustomTab, deleteCustomTab, createCustomTab } from "@/lib/custom-tabs.functions";
import { listThreads, createThread, deleteThread, getMessages } from "@/lib/chat.functions";
import { PageHeader } from "@/components/jarvis/HudBits";
import { ChatWindow } from "@/components/jarvis/ChatWindow";
import { askCodeAssistant } from "@/lib/jarvis.functions";
import { callTabApi } from "@/lib/tab-api.functions";
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
  Terminal,
  Package,
  Copy,
  FileCode,
  Braces,
  Palette,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------
type FilesShape = { html: string; css: string; js: string };

type TabConfig = {
  layout: "default" | "browser" | "chat" | "minimal";
  theme: "dark" | "light" | "auto";
  containerPadding: number;
  files?: FilesShape; // when defined → multi-file mode
  libraries?: string[]; // CDN URLs (.js or .css auto-detected)
  autoSave?: boolean;
  consoleEnabled?: boolean;
  editorFontSize?: number;
};

const DEFAULT_CONFIG: TabConfig = {
  layout: "default",
  theme: "dark",
  containerPadding: 16,
  libraries: [],
  autoSave: true,
  consoleEnabled: true,
  editorFontSize: 12,
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

type ConsoleLog = { level: "log" | "info" | "warn" | "error"; text: string; ts: number };

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
  const doApiCall = useServerFn(callTabApi);

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
  const [draft, setDraft] = useState(""); // legacy single-file HTML
  const [files, setFiles] = useState<FilesShape>({ html: "", css: "", js: "" });
  const [activeLang, setActiveLang] = useState<"html" | "css" | "js" | "libs">("html");
  const [libDraft, setLibDraft] = useState("");
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState<TabConfig>(DEFAULT_CONFIG);

  // Console panel
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const [showConsole, setShowConsole] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("tab-console-open") === "1";
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

  const multiFile = !!config.files;

  // --- Effects ---
  useEffect(() => {
    if (tab) {
      setDraft(tab.content_html || "");
      setLabel(tab.label || "");
      const merged = { ...DEFAULT_CONFIG, ...(tab.config || {}) } as TabConfig;
      setConfig(merged);
      if (merged.files) setFiles(merged.files);
    }
  }, [tab]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("tab-console-open", showConsole ? "1" : "0");
    }
  }, [showConsole]);

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

      // Console bridge from iframe
      if (type === "console-log" && event.data.args !== undefined) {
        setConsoleLogs((prev) => {
          const next = [
            ...prev,
            { level: event.data.level || "log", text: String(event.data.args), ts: Date.now() },
          ];
          return next.slice(-300);
        });
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [askAssistant]);

  // ---- Helpers ----
  const effectiveFiles: FilesShape = multiFile ? files : { html: draft, css: "", js: "" };
  const srcDoc = useMemo(() => wrapHtml(effectiveFiles, config), [effectiveFiles.html, effectiveFiles.css, effectiveFiles.js, config]);

  function combinedContentHtml(): string {
    if (!multiFile) return draft;
    // Persist a self-contained snapshot to content_html too, so imports/exports
    // and legacy consumers still see something usable.
    const { html, css, js } = files;
    return `${css ? `<style>\n${css}\n</style>\n` : ""}${html}${js ? `\n<script>\n${js}\n<\/script>` : ""}`;
  }

  async function save() {
    if (!tab) return;
    const nextConfig: TabConfig = multiFile ? { ...config, files } : config;
    const nextContent = combinedContentHtml();
    await doUpdate({
      data: {
        id: tab.id,
        content_html: nextContent,
        label,
        config: nextConfig,
      },
    });
    toast.success("Tab saved");
    setEditing(false);
    setConsoleLogs([]);
    saveSnapshot({
      id: tab.id,
      slug: tab.slug,
      label,
      icon: tab.icon || "Sparkles",
      description: tab.description || null,
      content_html: nextContent,
      config: nextConfig,
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

  function insertTemplate(kind: string = "hello") {
    const T = TEMPLATES[kind] || TEMPLATES.hello;
    if (multiFile) {
      setFiles(T.files);
      setConfig({ ...config, files: T.files, libraries: T.libraries ?? config.libraries });
      setActiveLang("html");
    } else {
      setDraft(T.combined);
    }
    toast.info(`Template inserted: ${T.name}`);
  }

  async function copyToClipboard() {
    try {
      const text = multiFile ? combinedContentHtml() : draft;
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch (e: any) {
      toast.error(e?.message || "Copy failed");
    }
  }

  function downloadStandalone() {
    if (!tab) return;
    const html = srcDoc;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tab.slug}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded standalone HTML");
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
            <select
              onChange={(e) => {
                if (e.target.value) {
                  insertTemplate(e.target.value);
                  e.target.value = "";
                }
              }}
              defaultValue=""
              className="bg-background/40 border border-arc/30 rounded-md px-2 py-1.5 text-xs hover:bg-arc/10 focus:border-arc focus:outline-none"
              title="Insert template"
            >
              <option value="" disabled>+ Template</option>
              {Object.entries(TEMPLATES).map(([k, v]) => (
                <option key={k} value={k}>{v.name}</option>
              ))}
            </select>
          </>
        )}

        {(tab.content_html?.trim() || multiFile) && !editing && (
          <>
            <button
              onClick={() => setShowConsole((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs ${
                showConsole ? "border-arc bg-arc/15 text-arc" : "border-arc/30 hover:bg-arc/10"
              }`}
              title="Toggle console panel"
            >
              <Terminal size={12} /> Console
              {consoleLogs.some((l) => l.level === "error") && (
                <span className="ml-1 size-1.5 rounded-full bg-critical animate-pulse" />
              )}
            </button>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
              title="Copy source"
            >
              <Copy size={12} /> Copy
            </button>
            <button
              onClick={downloadStandalone}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
              title="Download standalone HTML"
            >
              <Download size={12} /> .html
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
              <div className="flex flex-col gap-2 min-h-0">
                <div className="flex items-center gap-2">
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="flex-1 bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none"
                    placeholder="Tab label"
                  />
                  {!multiFile ? (
                    <button
                      onClick={() => {
                        setFiles({ html: draft, css: "", js: "" });
                        setConfig({ ...config, files: { html: draft, css: "", js: "" } });
                        setActiveLang("html");
                        toast.info("Split into HTML / CSS / JS files");
                      }}
                      className="text-[10px] font-mono px-2 py-1.5 rounded border border-arc/30 hover:bg-arc/10 whitespace-nowrap"
                      title="Convert to multi-file coding mode"
                    >
                      SPLIT →
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const combined = combinedContentHtml();
                        setDraft(combined);
                        const { files: _drop, ...rest } = config;
                        setConfig(rest);
                        toast.info("Merged into single HTML file");
                      }}
                      className="text-[10px] font-mono px-2 py-1.5 rounded border border-arc/30 hover:bg-arc/10 whitespace-nowrap"
                      title="Merge back to single file"
                    >
                      MERGE ←
                    </button>
                  )}
                </div>

                {multiFile && (
                  <div className="flex gap-0.5 border-b border-arc/15">
                    {([
                      { id: "html", label: "index.html", Icon: FileCode },
                      { id: "css", label: "style.css", Icon: Palette },
                      { id: "js", label: "script.js", Icon: Braces },
                      { id: "libs", label: `libs (${(config.libraries || []).length})`, Icon: Package },
                    ] as const).map(({ id, label: l, Icon }) => (
                      <button
                        key={id}
                        onClick={() => setActiveLang(id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono border-b-2 -mb-px transition ${
                          activeLang === id
                            ? "border-arc text-arc bg-arc/5"
                            : "border-transparent text-hud-dim hover:text-foreground"
                        }`}
                      >
                        <Icon size={11} /> {l}
                      </button>
                    ))}
                  </div>
                )}

                {multiFile && activeLang === "libs" ? (
                  <div className="flex-1 min-h-0 flex flex-col gap-2 bg-background/40 border border-arc/20 rounded-md p-3">
                    <div className="text-[10px] text-hud-dim font-mono">
                      CDN URLs — <code>.js</code> injected as &lt;script&gt;, <code>.css</code> as &lt;link&gt;.
                    </div>
                    <div className="flex gap-1">
                      <input
                        value={libDraft}
                        onChange={(e) => setLibDraft(e.target.value)}
                        placeholder="https://cdn.jsdelivr.net/npm/chart.js"
                        className="flex-1 bg-background/60 border border-arc/20 rounded-md px-2 py-1.5 text-xs font-mono focus:border-arc focus:outline-none"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && libDraft.trim()) {
                            setConfig({ ...config, libraries: [...(config.libraries || []), libDraft.trim()] });
                            setLibDraft("");
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          if (!libDraft.trim()) return;
                          setConfig({ ...config, libraries: [...(config.libraries || []), libDraft.trim()] });
                          setLibDraft("");
                        }}
                        className="text-xs px-3 py-1.5 rounded bg-arc text-arc-foreground shadow-arc"
                      >
                        Add
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {[
                        { l: "React 18", u: "https://unpkg.com/react@18/umd/react.production.min.js" },
                        { l: "ReactDOM 18", u: "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" },
                        { l: "Tailwind Play", u: "https://cdn.tailwindcss.com" },
                        { l: "Chart.js", u: "https://cdn.jsdelivr.net/npm/chart.js" },
                        { l: "Three.js", u: "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js" },
                        { l: "GSAP", u: "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js" },
                        { l: "D3", u: "https://cdn.jsdelivr.net/npm/d3@7" },
                        { l: "Alpine", u: "https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js" },
                        { l: "htmx", u: "https://unpkg.com/htmx.org@1.9.10" },
                      ].map((p) => (
                        <button
                          key={p.u}
                          onClick={() => {
                            if ((config.libraries || []).includes(p.u)) return;
                            setConfig({ ...config, libraries: [...(config.libraries || []), p.u] });
                          }}
                          className="text-[10px] font-mono px-2 py-0.5 rounded border border-arc/25 hover:bg-arc/10"
                        >
                          + {p.l}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1">
                      {(config.libraries || []).length === 0 ? (
                        <div className="text-xs text-hud-dim italic">No libraries yet.</div>
                      ) : (
                        (config.libraries || []).map((u, i) => (
                          <div key={i} className="flex items-center gap-2 bg-background/60 rounded px-2 py-1 text-[11px] font-mono">
                            <span className="text-arc/60">{/\.css(\?|$)/i.test(u) ? "CSS" : "JS "}</span>
                            <span className="flex-1 truncate" title={u}>{u}</span>
                            <button
                              onClick={() => {
                                const next = [...(config.libraries || [])];
                                next.splice(i, 1);
                                setConfig({ ...config, libraries: next });
                              }}
                              className="text-hud-dim hover:text-critical"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <textarea
                    value={multiFile ? files[activeLang as "html" | "css" | "js"] : draft}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (multiFile) {
                        const k = activeLang as "html" | "css" | "js";
                        const nextFiles = { ...files, [k]: v };
                        setFiles(nextFiles);
                        if (config.autoSave !== false && tab) {
                          if (saveTimeout.current) clearTimeout(saveTimeout.current);
                          saveTimeout.current = setTimeout(() => {
                            const nextConfig: TabConfig = { ...config, files: nextFiles };
                            const nextContent = `${nextFiles.css ? `<style>\n${nextFiles.css}\n</style>\n` : ""}${nextFiles.html}${nextFiles.js ? `\n<script>\n${nextFiles.js}\n<\/script>` : ""}`;
                            doUpdate({ data: { id: tab.id, content_html: nextContent, label, config: nextConfig } }).catch(() => {});
                          }, 600);
                        }
                      } else {
                        setDraft(v);
                        if (config.autoSave !== false && tab) {
                          if (saveTimeout.current) clearTimeout(saveTimeout.current);
                          saveTimeout.current = setTimeout(() => {
                            doUpdate({ data: { id: tab.id, content_html: v, label, config } }).catch(() => {});
                          }, 600);
                        }
                      }
                    }}
                    spellCheck={false}
                    style={{ fontSize: `${config.editorFontSize || 12}px`, lineHeight: 1.55 }}
                    className="flex-1 min-h-[300px] bg-background/40 border border-arc/20 rounded-md p-3 font-mono focus:border-arc focus:outline-none resize-none"
                    placeholder={
                      multiFile
                        ? activeLang === "html"
                          ? "<!-- HTML body — CSS/JS live in the other tabs -->"
                          : activeLang === "css"
                            ? "/* Full stylesheet */"
                            : "// JavaScript — runs after DOM is ready"
                        : "<!-- Write HTML/CSS/JS here. It renders in a sandboxed iframe. -->"
                    }
                  />
                )}

                <div className="text-[10px] text-hud-dim flex flex-wrap gap-3">
                  <span>Ctrl+S → Save</span>
                  <span>Ctrl+E → Toggle</span>
                  <span>Ctrl+Shift+F → Fullscreen</span>
                  <span>Ctrl+Shift+R → Reload</span>
                  {config.autoSave !== false && <span className="text-arc/70">● Autosave on</span>}
                </div>
              </div>

              <div className="rounded-md overflow-hidden border border-arc/20 bg-white flex flex-col min-h-[300px]">
                <iframe
                  title="preview"
                  srcDoc={srcDoc}
                  sandbox="allow-scripts allow-same-origin allow-fullscreen allow-forms allow-popups"
                  className="w-full flex-1"
                />
              </div>
            </div>
          ) : tab.content_html?.trim() || multiFile ? (
            <div className="flex flex-col h-full min-h-[400px]">
              <iframe
                ref={iframeRef}
                title={tab.label}
                srcDoc={srcDoc}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-fullscreen"
                className="w-full flex-1 min-h-[300px] rounded-2xl border border-arc/20 bg-white shadow-arc"
              />
              {showConsole && (
                <ConsolePanel logs={consoleLogs} onClear={() => setConsoleLogs([])} onClose={() => setShowConsole(false)} />
              )}
            </div>
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
    qc.setQueryData(["tab-messages", t.id], []);
    await qc.invalidateQueries({ queryKey: ["tab-threads", tabSlug] });
    setActiveId(t.id);
  }
  async function onDelete(id: string) {
    await remove({ data: { id } });
    qc.removeQueries({ queryKey: ["tab-messages", id] });
    qc.removeQueries({ queryKey: ["tab-messages"] });
    await qc.invalidateQueries({ queryKey: ["tab-threads", tabSlug] });
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
// Helper: wrapHtml — multi-file aware, CDN library injection, console bridge
// ------------------------------------------------------------
function wrapHtml(files: FilesShape, config: TabConfig): string {
  const theme = config.theme === "auto" ? "light dark" : config.theme;
  const padding = config.containerPadding || 16;
  const layoutClass = config.layout || "default";
  const libs = (config.libraries || []).filter((u) => typeof u === "string" && u.trim());
  const consoleOn = config.consoleEnabled !== false;

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

  const libTags = libs
    .map((u) => {
      const clean = u.trim();
      const isCss = /\.css(\?|$)/i.test(clean);
      return isCss
        ? `<link rel="stylesheet" href="${escapeHtml(clean)}">`
        : `<script src="${escapeHtml(clean)}" crossorigin="anonymous"></script>`;
    })
    .join("\n  ");

  const consoleBridge = consoleOn
    ? `<script>
(function(){
  if (window.__jarvisConsoleBridged) return; window.__jarvisConsoleBridged = true;
  var post = function(level, args){
    try {
      var out = Array.prototype.slice.call(args).map(function(a){
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch(e){ return String(a); } }
        return String(a);
      }).join(' ');
      parent.postMessage({ type: 'console-log', level: level, args: out }, '*');
    } catch(e){}
  };
  ['log','info','warn','error'].forEach(function(lvl){
    var orig = console[lvl].bind(console);
    console[lvl] = function(){ post(lvl, arguments); orig.apply(null, arguments); };
  });
  window.addEventListener('error', function(e){ post('error', [e.message + ' @ ' + (e.filename||'') + ':' + (e.lineno||0)]); });
  window.addEventListener('unhandledrejection', function(e){ post('error', ['Unhandled promise: ' + (e.reason && e.reason.message || e.reason)]); });
})();
<\/script>`
    : "";

  const host = typeof window !== "undefined" ? window.location.host : "preview";
  const body = files.html || "";

  return `<!doctype html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
${consoleBridge}
${libTags}
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
${files.css || ""}
</style>
</head>
<body class="layout-${layoutClass}">
  ${
    layoutClass === "browser"
      ? `
    <div class="browser-bar">
      <div class="dots"><span style="background:#ff5f56"></span><span style="background:#ffbd2e"></span><span style="background:#27c93f"></span></div>
      <div class="url">${escapeHtml(host)}</div>
    </div>
    <div class="browser-body">${body}</div>
  `
      : body
  }
${files.js ? `<script>\ntry {\n${files.js}\n} catch(e){ console.error(e); }\n<\/script>` : ""}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ------------------------------------------------------------
// ConsolePanel — captures iframe console.* + errors
// ------------------------------------------------------------
function ConsolePanel({
  logs,
  onClear,
  onClose,
}: {
  logs: ConsoleLog[];
  onClear: () => void;
  onClose: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [logs]);
  return (
    <div className="mt-2 rounded-md border border-arc/25 bg-background/70 backdrop-blur overflow-hidden max-h-56 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-arc/15 bg-background/60">
        <Terminal size={12} className="text-arc" />
        <div className="text-[10px] font-mono tracking-[0.25em] text-arc/80 flex-1">CONSOLE · {logs.length}</div>
        <button onClick={onClear} className="text-[10px] font-mono text-hud-dim hover:text-foreground">CLEAR</button>
        <button onClick={onClose} className="text-hud-dim hover:text-foreground"><X size={12} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono text-[11px]">
        {logs.length === 0 ? (
          <div className="text-hud-dim italic">No output yet — logs from your tab will appear here.</div>
        ) : (
          logs.map((l, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap break-all border-l-2 pl-2 ${
                l.level === "error"
                  ? "border-critical text-critical"
                  : l.level === "warn"
                    ? "border-warning text-warning"
                    : l.level === "info"
                      ? "border-arc/50 text-arc/90"
                      : "border-arc/15 text-foreground/85"
              }`}
            >
              <span className="opacity-40 mr-1">[{new Date(l.ts).toLocaleTimeString([], { hour12: false })}]</span>
              {l.text}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Starter templates
// ------------------------------------------------------------
type Template = { name: string; combined: string; files: FilesShape; libraries?: string[] };

const TEMPLATES: Record<string, Template> = {
  hello: {
    name: "Hello counter",
    files: {
      html: `<div class="wrap">\n  <h1>Hello, JARVIS!</h1>\n  <p>Click below.</p>\n  <button id="btn">Clicked <span id="c">0</span> times</button>\n</div>`,
      css: `.wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:12px}\nbutton{padding:10px 18px;border-radius:8px;background:#7c3aed;color:#fff;border:0;cursor:pointer;font-size:15px}`,
      js: `let n=0;document.getElementById('btn').onclick=()=>document.getElementById('c').textContent=++n;`,
    },
    combined: `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:12px"><h1>Hello, JARVIS!</h1><button onclick="this.textContent='Clicked '+ (++window.__c||(window.__c=1))+' times'">Click</button></div>`,
  },
  fetch: {
    name: "Fetch API demo",
    files: {
      html: `<div style="padding:20px;font-family:system-ui">\n  <h2>Random cat fact</h2>\n  <button id="go">Fetch</button>\n  <pre id="out" style="margin-top:12px;background:#111;padding:12px;border-radius:8px;color:#9cf"></pre>\n</div>`,
      css: `button{padding:8px 14px;background:#4dd0ff;color:#012;border:0;border-radius:6px;cursor:pointer;font-weight:600}`,
      js: `const out=document.getElementById('out');\ndocument.getElementById('go').onclick=async()=>{\n  out.textContent='Loading…';\n  try{const r=await fetch('https://catfact.ninja/fact');const j=await r.json();out.textContent=j.fact}\n  catch(e){out.textContent='Error: '+e.message}\n};`,
    },
    combined: "",
  },
  canvas: {
    name: "Canvas bouncing ball",
    files: {
      html: `<canvas id="c" width="600" height="400" style="display:block;margin:auto;background:#0b1220;border-radius:12px"></canvas>`,
      css: `body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0}`,
      js: `const c=document.getElementById('c'),g=c.getContext('2d');\nlet x=100,y=100,vx=3,vy=2;\nfunction f(){g.fillStyle='#0b1220';g.fillRect(0,0,c.width,c.height);\n  g.fillStyle='#4dd0ff';g.beginPath();g.arc(x,y,20,0,Math.PI*2);g.fill();\n  x+=vx;y+=vy;if(x<20||x>c.width-20)vx*=-1;if(y<20||y>c.height-20)vy*=-1;\n  requestAnimationFrame(f);}f();`,
    },
    combined: "",
  },
  chart: {
    name: "Chart.js line chart",
    files: {
      html: `<div style="max-width:700px;margin:40px auto;padding:20px;background:#fff;border-radius:12px;color:#111">\n  <h2>Weekly demo</h2>\n  <canvas id="chart"></canvas>\n</div>`,
      css: ``,
      js: `new Chart(document.getElementById('chart'),{\n  type:'line',\n  data:{labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],\n    datasets:[{label:'Traffic',data:[12,19,7,15,22,8,14],borderColor:'#7c3aed',backgroundColor:'rgba(124,58,237,.15)',fill:true,tension:.35}]},\n  options:{responsive:true}\n});`,
    },
    libraries: ["https://cdn.jsdelivr.net/npm/chart.js"],
    combined: "",
  },
  form: {
    name: "Form → localStorage",
    files: {
      html: `<form id="f" style="max-width:400px;margin:40px auto;display:flex;flex-direction:column;gap:10px;padding:20px;background:#111;border-radius:10px">\n  <h3>Notes</h3>\n  <textarea id="t" rows="5" style="padding:8px;border-radius:6px;background:#222;color:#eee;border:1px solid #333"></textarea>\n  <button style="padding:8px;background:#4dd0ff;color:#012;border:0;border-radius:6px">Save</button>\n  <div id="status" style="color:#9cf;font-size:13px"></div>\n</form>`,
      css: ``,
      js: `const t=document.getElementById('t'),s=document.getElementById('status');\nt.value=localStorage.getItem('note')||'';\ndocument.getElementById('f').onsubmit=e=>{e.preventDefault();localStorage.setItem('note',t.value);s.textContent='Saved '+new Date().toLocaleTimeString();};`,
    },
    combined: "",
  },
  react: {
    name: "React (UMD) todo",
    files: {
      html: `<div id="root" style="padding:24px;font-family:system-ui"></div>`,
      css: `input{padding:6px;border-radius:4px;border:1px solid #333;background:#222;color:#eee}\nbutton{padding:6px 10px;border-radius:4px;border:0;background:#7c3aed;color:#fff;cursor:pointer;margin-left:6px}\nli{padding:4px 0}`,
      js: `const {useState}=React;\nfunction App(){\n  const [items,setItems]=useState([]);\n  const [t,setT]=useState('');\n  return React.createElement('div',null,\n    React.createElement('h2',null,'Todos'),\n    React.createElement('input',{value:t,onChange:e=>setT(e.target.value)}),\n    React.createElement('button',{onClick:()=>{if(t){setItems([...items,t]);setT('')}}},'Add'),\n    React.createElement('ul',null,items.map((x,i)=>React.createElement('li',{key:i},x)))\n  );\n}\nReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));`,
    },
    libraries: [
      "https://unpkg.com/react@18/umd/react.production.min.js",
      "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
    ],
    combined: "",
  },
  tailwind: {
    name: "Tailwind card",
    files: {
      html: `<div class="min-h-screen bg-slate-900 flex items-center justify-center p-8">\n  <div class="bg-slate-800 rounded-2xl p-8 shadow-2xl max-w-md">\n    <h1 class="text-3xl font-bold text-white">Tailwind ready</h1>\n    <p class="mt-3 text-slate-300">Utility classes work via the Play CDN.</p>\n    <button class="mt-6 px-5 py-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg">Go</button>\n  </div>\n</div>`,
      css: ``,
      js: ``,
    },
    libraries: ["https://cdn.tailwindcss.com"],
    combined: "",
  },
};

// Backfill legacy `combined` for templates that skipped it.
for (const k of Object.keys(TEMPLATES)) {
  const t = TEMPLATES[k];
  if (!t.combined) {
    t.combined = `${t.files.css ? `<style>\n${t.files.css}\n</style>\n` : ""}${t.files.html}${t.files.js ? `\n<script>\n${t.files.js}\n<\/script>` : ""}`;
  }
}


