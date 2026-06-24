import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/jarvis/HudBits";
import { getBackendOverview, previewTable } from "@/lib/backend.functions";
import { Database, KeyRound, FolderOpen, Plug, RefreshCw, Eye } from "lucide-react";

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
      {tab === "files" && <div className="text-sm text-muted-foreground">Files tab coming soon</div>}
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
