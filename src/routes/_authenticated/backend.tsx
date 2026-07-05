import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef } from "react";
import { PageHeader } from "@/components/jarvis/HudBits";
import { getBackendOverview, previewTable } from "@/lib/backend.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Database,
  KeyRound,
  FolderOpen,
  Plug,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  FileText,
  Eye,
  Plus,
  Save,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/backend")({
  ssr: false,
  head: () => ({ meta: [{ title: "Backend — JARVIS" }] }),
  component: BackendPage,
});

type Tab = "overview" | "database" | "secrets" | "files";

function BackendPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const overview = useServerFn(getBackendOverview);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["backend-overview"],
    queryFn: () => overview(),
  });

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        tag="10"
        title="Backend Control"
        subtitle="Database, secrets, environment, and file system."
        right={
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-arc/10 hover:bg-arc/20 text-arc text-xs font-mono"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
            REFRESH
          </button>
        }
      />

      <div className="flex gap-1 border-b border-arc/15">
        {(
          [
            ["overview", "Overview", Plug],
            ["database", "Database", Database],
            ["secrets", "Secrets", KeyRound],
            ["files", "Files", FolderOpen],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-mono transition border-b-2 -mb-px ${
              tab === k ? "border-arc text-arc" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading backend status…</div>}

      {tab === "overview" && data && (
        <OverviewPanel
          connection={(data as any).connection}
          tables={(data as any).tables}
          secrets={(data as any).secrets}
        />
      )}
      {tab === "database" && data && <DatabasePanel tables={(data as any).tables} />}
      {tab === "secrets" && data && <SecretsPanel secrets={(data as any).secrets} />}
      {tab === "files" && <FilesPanel />}
    </div>
  );
}

// ---------- Overview ----------
function OverviewPanel({ connection, tables, secrets }: any) {
  const totalRows = tables.reduce((sum: number, t: any) => sum + (t.rows ?? 0), 0);
  const present = secrets.filter((s: any) => s.present).length;
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Stat label="Project URL" value={connection.project_url ? new URL(connection.project_url).host : "—"} mono />
      <Stat label="Tables" value={`${tables.length}`} />
      <Stat label="Total rows (your data)" value={`${totalRows}`} />
      <Stat label="Secrets configured" value={`${present} / ${secrets.length}`} />
      <Stat label="Publishable key" value={connection.publishable_key_present ? "Loaded" : "Missing"} />
      <Stat label="Service role" value={connection.service_role_present ? "Loaded" : "Missing"} />
      <div className="md:col-span-3 glass p-4 text-xs text-muted-foreground font-mono">
        Your user id: <span className="text-arc">{connection.user_id}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="glass p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-arc/70">{label}</div>
      <div className={`mt-2 text-lg ${mono ? "font-mono" : "font-display"}`}>{value}</div>
    </div>
  );
}

// ---------- Database ----------
function DatabasePanel({ tables }: { tables: { table: string; rows: number | null; error: string | null }[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const preview = useServerFn(previewTable);
  const { data: rows, isLoading } = useQuery({
    queryKey: ["table-preview", selected],
    queryFn: () => preview({ data: { table: selected!, limit: 10 } }),
    enabled: !!selected,
  });

  return (
    <div className="grid md:grid-cols-[280px_1fr] gap-4">
      <div className="glass p-2 max-h-[60vh] overflow-y-auto">
        {tables.map((t) => (
          <button
            key={t.table}
            onClick={() => setSelected(t.table)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded text-left text-sm transition ${
              selected === t.table ? "bg-arc/20 text-arc" : "hover:bg-arc/5"
            }`}
          >
            <span className="font-mono truncate">{t.table}</span>
            <span className="text-[10px] text-muted-foreground">{t.rows ?? "—"}</span>
          </button>
        ))}
      </div>
      <div className="glass p-4 min-h-[400px]">
        {!selected ? (
          <div className="text-sm text-muted-foreground">Select a table to preview rows.</div>
        ) : isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Eye size={14} className="text-arc" />
              <span className="font-mono text-sm">{selected}</span>
              <span className="text-[10px] text-muted-foreground">({(rows as any[])?.length ?? 0} rows shown)</span>
            </div>
            <pre className="text-[11px] font-mono bg-black/40 p-3 rounded overflow-auto max-h-[55vh]">
              {JSON.stringify(rows ?? [], null, 2)}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Secrets ----------
function SecretsPanel({
  secrets,
}: {
  secrets: { name: string; description: string; managed?: string; present: boolean }[];
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        Values are never displayed. Connector-managed secrets are edited via the Connectors panel; others via the
        secrets tooling.
      </div>
      {secrets.map((s) => (
        <div key={s.name} className="glass p-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-sm">{s.name}</div>
            <div className="text-xs text-muted-foreground">
              {s.description}
              {s.managed ? <span className="ml-2 text-arc/70">· {s.managed}</span> : null}
            </div>
          </div>
          <span
            className={`text-[10px] font-mono px-2 py-1 rounded ${
              s.present ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
            }`}
          >
            {s.present ? "LOADED" : "MISSING"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Files (Full) ----------
function FilesPanel() {
  const ctx = useRouteContext({ from: "/_authenticated" });
  const userId = (ctx as any).user.id as string;
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState("");
  const [newBody, setNewBody] = useState("");
  const [editing, setEditing] = useState<{ name: string; body: string } | null>(null);

  const {
    data: files = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["user-files", userId],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("user-files").list(userId, {
        limit: 200,
        sortBy: { column: "created_at", order: "desc" },
      });
      if (error) throw error;
      return (data ?? []).filter((f) => f.name !== ".emptyFolderPlaceholder");
    },
  });

  async function uploadFile(file: File) {
    const path = `${userId}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("user-files").upload(path, file, { upsert: false });
    if (error) return toast.error(error.message);
    toast.success(`Uploaded ${file.name}`);
    qc.invalidateQueries({ queryKey: ["user-files", userId] });
  }

  async function createTextFile() {
    if (!newName.trim()) return toast.error("Name required");
    const safe = newName.replace(/[^\w.\-]/g, "_");
    const blob = new Blob([newBody], { type: "text/plain" });
    const { error } = await supabase.storage
      .from("user-files")
      .upload(`${userId}/${safe}`, blob, { upsert: true, contentType: "text/plain" });
    if (error) return toast.error(error.message);
    toast.success(`Created ${safe}`);
    setNewName("");
    setNewBody("");
    qc.invalidateQueries({ queryKey: ["user-files", userId] });
  }

  async function downloadFile(name: string) {
    const { data, error } = await supabase.storage.from("user-files").download(`${userId}/${name}`);
    if (error || !data) return toast.error(error?.message ?? "Download failed");
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function openInEditor(name: string) {
    const { data, error } = await supabase.storage.from("user-files").download(`${userId}/${name}`);
    if (error || !data) return toast.error(error?.message ?? "Open failed");
    const body = await data.text();
    setEditing({ name, body });
  }

  async function saveEditor() {
    if (!editing) return;
    const blob = new Blob([editing.body], { type: "text/plain" });
    const { error } = await supabase.storage
      .from("user-files")
      .upload(`${userId}/${editing.name}`, blob, { upsert: true, contentType: "text/plain" });
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["user-files", userId] });
  }

  async function deleteFile(name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    const { error } = await supabase.storage.from("user-files").remove([`${userId}/${name}`]);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["user-files", userId] });
  }

  return (
    <div className="grid md:grid-cols-[1fr_360px] gap-4">
      <div className="glass p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-sm flex items-center gap-2">
            <FolderOpen size={14} className="text-arc" /> Your files
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 px-3 py-1.5 bg-arc/10 hover:bg-arc/20 text-arc text-xs font-mono rounded"
            >
              <Upload size={12} /> UPLOAD
            </button>
            <button onClick={() => refetch()} className="p-1.5 rounded hover:bg-arc/10 text-muted-foreground">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : files.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center border border-dashed border-arc/20 rounded">
            No files yet. Upload one or create a text file.
          </div>
        ) : (
          <div className="divide-y divide-arc/10 max-h-[60vh] overflow-y-auto">
            {files.map((f) => (
              <div key={f.name} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={14} className="text-arc shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm truncate">{f.name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {f.metadata?.size ? `${(f.metadata.size / 1024).toFixed(1)} KB` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <IconBtn onClick={() => openInEditor(f.name)} title="Edit">
                    <Eye size={14} />
                  </IconBtn>
                  <IconBtn onClick={() => downloadFile(f.name)} title="Download">
                    <Download size={14} />
                  </IconBtn>
                  <IconBtn onClick={() => deleteFile(f.name)} title="Delete" danger>
                    <Trash2 size={14} />
                  </IconBtn>
                </div>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div className="mt-4 border border-arc/30 rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-mono text-sm">{editing.name}</div>
              <div className="flex gap-2">
                <button
                  onClick={saveEditor}
                  className="flex items-center gap-1 px-3 py-1 text-xs bg-arc/20 text-arc rounded"
                >
                  <Save size={12} /> SAVE
                </button>
                <button onClick={() => setEditing(null)} className="px-3 py-1 text-xs rounded hover:bg-arc/10">
                  CANCEL
                </button>
              </div>
            </div>
            <textarea
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              className="w-full h-64 bg-black/40 p-3 rounded font-mono text-xs outline-none"
            />
          </div>
        )}
      </div>

      <div className="glass p-4 space-y-3 h-fit">
        <div className="font-mono text-sm flex items-center gap-2">
          <Plus size={14} className="text-arc" /> New text file
        </div>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="filename.txt"
          className="w-full bg-black/40 px-3 py-2 rounded text-sm font-mono outline-none border border-arc/15"
        />
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder="File contents…"
          className="w-full h-48 bg-black/40 px-3 py-2 rounded text-xs font-mono outline-none border border-arc/15"
        />
        <button
          onClick={createTextFile}
          className="w-full py-2 bg-arc/15 hover:bg-arc/25 text-arc text-xs font-mono rounded"
        >
          CREATE FILE
        </button>
        <div className="text-[10px] text-muted-foreground">
          Files are private to your account and stored in the <span className="text-arc font-mono">user-files</span>{" "}
          bucket.
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }: any) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded hover:bg-arc/10 ${danger ? "text-red-400 hover:bg-red-500/10" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}
