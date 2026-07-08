import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  getSystemHealth,
  getRouterTraces,
  getWatcherRuns,
  runMemoryRecall,
} from "@/lib/diagnostics.functions";
import { CheckCircle2, XCircle, RefreshCw, Loader2 } from "lucide-react";

function Dot({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 size={14} className="text-success inline-block" />
    : <XCircle size={14} className="text-destructive inline-block" />;
}

function SectionHeader({ label, onRefresh, loading }: { label: string; onRefresh?: () => void; loading?: boolean }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="font-mono text-[10px] tracking-[0.3em] text-arc">{label}</div>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-xs px-2 py-1 rounded border border-arc/30 hover:bg-arc/10 flex items-center gap-1 disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      )}
    </div>
  );
}

export function DiagnosticsTab() {
  const healthFn = useServerFn(getSystemHealth);
  const tracesFn = useServerFn(getRouterTraces);
  const watchersFn = useServerFn(getWatcherRuns);
  const recallFn = useServerFn(runMemoryRecall);

  const health = useQuery({ queryKey: ["diag", "health"], queryFn: () => healthFn(), refetchInterval: 30_000 });
  const traces = useQuery({ queryKey: ["diag", "traces"], queryFn: () => tracesFn({ data: { limit: 25 } }) });
  const watchers = useQuery({ queryKey: ["diag", "watchers"], queryFn: () => watchersFn({ data: { limit: 25 } }) });

  const [query, setQuery] = useState("");
  const [recallResult, setRecallResult] = useState<{ ms: number; rows: any[] } | null>(null);
  const [recalling, setRecalling] = useState(false);

  async function doRecall() {
    if (!query.trim()) return;
    setRecalling(true);
    try {
      const r = await recallFn({ data: { query: query.trim(), limit: 10 } });
      setRecallResult(r as any);
    } catch (e: any) {
      setRecallResult({ ms: 0, rows: [{ error: e?.message ?? String(e) }] });
    } finally {
      setRecalling(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* System Health */}
      <section className="glass-strong hud-corners rounded-xl p-5">
        <SectionHeader label="SYSTEM HEALTH" onRefresh={() => health.refetch()} loading={health.isFetching} />
        {health.isLoading ? (
          <div className="text-sm text-hud-dim">Probing…</div>
        ) : health.data ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded bg-background/40 border border-arc/10">
                <div className="text-[10px] font-mono text-hud-dim mb-1">DATABASE</div>
                <div className="flex items-center gap-2">
                  <Dot ok={health.data.db.ok} />
                  <span>{health.data.db.ok ? `OK · ${health.data.db.pingMs}ms` : `FAIL · ${health.data.db.error}`}</span>
                </div>
              </div>
              <div className="p-3 rounded bg-background/40 border border-arc/10">
                <div className="text-[10px] font-mono text-hud-dim mb-1">LAST WATCHER RUN</div>
                {health.data.lastWatcher ? (
                  <div className="flex items-center gap-2">
                    <Dot ok={health.data.lastWatcher.ok} />
                    <span className="font-mono text-xs">
                      {health.data.lastWatcher.watcher} · {new Date(health.data.lastWatcher.ran_at).toLocaleTimeString()} · {health.data.lastWatcher.duration_ms}ms
                    </span>
                  </div>
                ) : (
                  <span className="text-hud-dim">Never</span>
                )}
              </div>
            </div>

            <div className="p-3 rounded bg-background/40 border border-arc/10">
              <div className="text-[10px] font-mono text-hud-dim mb-2">SECRETS PRESENT (SERVER-SIDE)</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-xs">
                {Object.entries(health.data.secrets).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <Dot ok={!!v} />
                    <span className="font-mono">{k}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {Object.entries(health.data.counts).map(([k, v]) => (
                <div key={k} className="p-3 rounded bg-background/40 border border-arc/10">
                  <div className="text-[10px] font-mono text-hud-dim">{k.replace(/Count$/, "").toUpperCase()}</div>
                  <div className="text-lg font-semibold">{v ?? "—"}</div>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-hud-dim font-mono">snapshot @ {new Date(health.data.ts).toLocaleString()}</div>
          </div>
        ) : (
          <div className="text-destructive text-sm">Failed to load health</div>
        )}
      </section>

      {/* Model Router Trace */}
      <section className="glass-strong hud-corners rounded-xl p-5">
        <SectionHeader label="MODEL ROUTER TRACE" onRefresh={() => traces.refetch()} loading={traces.isFetching} />
        {traces.data && traces.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-hud-dim font-mono">
                <tr className="text-left border-b border-arc/10">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Intent</th>
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">Img</th>
                  <th className="py-2 pr-3">Recall</th>
                  <th className="py-2">Prompt</th>
                </tr>
              </thead>
              <tbody>
                {traces.data.map((t: any) => (
                  <tr key={t.id} className="border-b border-arc/5 hover:bg-arc/5">
                    <td className="py-1.5 pr-3 font-mono text-hud-dim whitespace-nowrap">{new Date(t.created_at).toLocaleTimeString()}</td>
                    <td className="py-1.5 pr-3"><span className="px-1.5 py-0.5 rounded bg-arc/10 font-mono">{t.intent}</span></td>
                    <td className="py-1.5 pr-3 font-mono">{t.provider}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.model_id}</td>
                    <td className="py-1.5 pr-3">{t.has_image ? "🖼️" : ""}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.recalled_count}</td>
                    <td className="py-1.5 max-w-[280px] truncate text-hud-dim" title={t.user_text_snippet ?? ""}>
                      {t.user_text_snippet ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-hud-dim text-sm">No traces yet. Send a chat message to populate.</div>
        )}
      </section>

      {/* Memory Recall Inspector */}
      <section className="glass-strong hud-corners rounded-xl p-5">
        <SectionHeader label="MEMORY RECALL INSPECTOR" />
        <div className="flex gap-2 mb-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doRecall()}
            placeholder="Search your past chat memory (FTS keywords)…"
            className="flex-1 bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
          />
          <button
            onClick={doRecall}
            disabled={recalling || !query.trim()}
            className="text-xs px-4 py-2 rounded-md bg-arc text-arc-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            {recalling ? "Recalling…" : "Recall"}
          </button>
        </div>
        {recallResult && (
          <div className="space-y-2">
            <div className="text-[10px] font-mono text-hud-dim">
              {recallResult.rows.length} result(s) in {recallResult.ms}ms
            </div>
            {recallResult.rows.length === 0 ? (
              <div className="text-hud-dim text-sm">No matches.</div>
            ) : (
              <ul className="space-y-2">
                {recallResult.rows.map((r: any, i: number) => (
                  <li key={r.id ?? i} className="p-3 rounded bg-background/40 border border-arc/10 text-sm">
                    {r.error ? (
                      <span className="text-destructive">{r.error}</span>
                    ) : (
                      <>
                        <div className="flex justify-between text-[10px] font-mono text-hud-dim mb-1">
                          <span>{r.role} · {new Date(r.created_at).toLocaleString()}</span>
                          <span>rank {Number(r.rank).toFixed(3)}</span>
                        </div>
                        <div className="text-foreground/90">{r.message}</div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Watcher Logs */}
      <section className="glass-strong hud-corners rounded-xl p-5">
        <SectionHeader label="WATCHER LOGS" onRefresh={() => watchers.refetch()} loading={watchers.isFetching} />
        {watchers.data && watchers.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-hud-dim font-mono">
                <tr className="text-left border-b border-arc/10">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Watcher</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Duration</th>
                  <th className="py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {watchers.data.map((w: any) => (
                  <tr key={w.id} className="border-b border-arc/5 hover:bg-arc/5 align-top">
                    <td className="py-1.5 pr-3 font-mono text-hud-dim whitespace-nowrap">{new Date(w.ran_at).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 font-mono">{w.watcher}</td>
                    <td className="py-1.5 pr-3"><Dot ok={w.ok} /> {w.ok ? "ok" : "fail"}</td>
                    <td className="py-1.5 pr-3 font-mono">{w.duration_ms ?? "—"}ms</td>
                    <td className="py-1.5 max-w-[420px] truncate font-mono text-hud-dim" title={w.error ?? JSON.stringify(w.meta)}>
                      {w.error ?? JSON.stringify(w.meta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-hud-dim text-sm">No watcher runs yet. Cron fires every 5 minutes.</div>
        )}
      </section>
    </div>
  );
}
