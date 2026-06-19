import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEngagement } from "@/lib/pulse.functions";
import { PageHeader } from "@/components/jarvis/HudBits";
import { useMemo } from "react";

export const Route = createFileRoute("/_authenticated/pulse")({
  head: () => ({ meta: [{ title: "Pulse — JARVIS" }, { name: "description", content: "Engagement vs. calendar — best times to post next week." }] }),
  component: PulsePage,
});

const HOURS = [7, 10, 13, 16, 19, 22];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function PulsePage() {
  const list = useServerFn(listEngagement);
  const { data, isLoading } = useQuery({ queryKey: ["pulse"], queryFn: () => list() });

  const analysis = useMemo(() => {
    if (!data) return null;
    // engagement avg by day-of-week × hour-of-day
    const eng: Record<string, { sum: number; n: number }> = {};
    for (const s of data.stats as any[]) {
      const dow = new Date(s.stat_date).getDay(); // 0=Sun
      const dayIdx = (dow + 6) % 7; // shift to 0=Mon
      const key = `${dayIdx}-${s.hour_of_day}`;
      eng[key] = eng[key] ?? { sum: 0, n: 0 };
      eng[key].sum += s.engagements / Math.max(s.impressions, 1);
      eng[key].n += 1;
    }
    const cells: { day: number; hour: number; rate: number; busy: number }[] = [];
    let max = 0;
    for (let d = 0; d < 7; d++) {
      for (const h of HOURS) {
        const e = eng[`${d}-${h}`];
        const rate = e ? e.sum / e.n : 0;
        if (rate > max) max = rate;
        cells.push({ day: d, hour: h, rate, busy: 0 });
      }
    }
    // calendar busyness for next week
    const next = new Date();
    for (const r of data.reminders as any[]) {
      const dt = new Date(r.datetime);
      const days = Math.floor((dt.getTime() - next.getTime()) / 86400000);
      if (days < 0 || days >= 7) continue;
      const dow = (dt.getDay() + 6) % 7;
      const hour = dt.getHours();
      cells.forEach((c) => {
        if (c.day === dow && Math.abs(c.hour - hour) <= 1) c.busy += 1;
      });
    }
    const best = [...cells]
      .filter((c) => c.busy === 0 && c.rate > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 3);
    return { cells, max, best };
  }, [data]);

  return (
    <div className="flex flex-col h-screen">
      <PageHeader tag="03 · PULSE" title="Weekly pulse" subtitle="Where your audience is when you have time to post." />
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {isLoading && <div className="text-sm text-muted-foreground">Aggregating signal…</div>}
        {analysis && (
          <>
            <section className="glass-strong hud-corners rounded-xl p-5">
              <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-3">ENGAGEMENT × AVAILABILITY · NEXT 7 DAYS</div>
              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-1">
                  <thead>
                    <tr>
                      <th className="w-14"></th>
                      {DAYS.map((d) => (
                        <th key={d} className="font-mono text-[10px] text-hud-dim font-normal">{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {HOURS.map((h) => (
                      <tr key={h}>
                        <td className="font-mono text-[10px] text-hud-dim pr-2">{String(h).padStart(2, "0")}:00</td>
                        {DAYS.map((_, dIdx) => {
                          const c = analysis.cells.find((c) => c.day === dIdx && c.hour === h);
                          if (!c) return <td key={dIdx}/>;
                          const intensity = analysis.max ? c.rate / analysis.max : 0;
                          const busy = c.busy > 0;
                          return (
                            <td key={dIdx}>
                              <div
                                className="h-9 rounded relative flex items-center justify-center"
                                style={{
                                  backgroundColor: `oklch(0.78 0.18 210 / ${0.08 + intensity * 0.55})`,
                                  border: busy ? "1px solid var(--warning)" : "1px solid oklch(0.82 0.16 210 / 0.15)",
                                }}
                                title={`Engagement ${(intensity * 100).toFixed(0)}%${busy ? " · calendar conflict" : ""}`}
                              >
                                {busy && <span className="font-mono text-[8px] text-warning">BUSY</span>}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center gap-4 font-mono text-[10px] text-hud-dim">
                <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-arc/60"/> high engagement</span>
                <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border border-warning"/> calendar conflict</span>
              </div>
            </section>

            <section className="glass-strong hud-corners rounded-xl p-5">
              <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-3">RECOMMENDED WINDOWS</div>
              {analysis.best.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sir, your week is full. I recommend scheduling content the following Monday morning.</p>
              ) : (
                <ul className="space-y-2">
                  {analysis.best.map((c, i) => (
                    <li key={i} className="flex items-center justify-between p-3 rounded-md bg-arc/5 border border-arc/20">
                      <div className="font-display">
                        <span className="text-arc">#{i + 1}</span> · {DAYS[c.day]} at {String(c.hour).padStart(2, "0")}:00
                      </div>
                      <div className="font-mono text-xs text-hud-dim">
                        engagement {(c.rate * 100).toFixed(1)}% · calendar clear
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
