import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listReminders, createReminder, toggleReminder, deleteReminder } from "@/lib/reminders.functions";
import { PageHeader, PriorityChip } from "@/components/jarvis/HudBits";
import { formatRelative, formatClock, formatDateLong, minutesUntil } from "@/lib/time-utils";
import { useState } from "react";
import { Check, Plus, Trash2, Calendar } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/time")({
  head: () => ({ meta: [{ title: "Time — JARVIS" }] }),
  component: TimePage,
});

function TimePage() {
  const qc = useQueryClient();
  const list = useServerFn(listReminders);
  const create = useServerFn(createReminder);
  const toggle = useServerFn(toggleReminder);
  const del = useServerFn(deleteReminder);
  const { data, isLoading } = useQuery({ queryKey: ["reminders"], queryFn: () => list() });

  const [title, setTitle] = useState("");
  const [datetime, setDatetime] = useState("");
  const [priority, setPriority] = useState<"critical" | "high" | "normal" | "low">("normal");
  const [recurrence, setRecurrence] = useState<"" | "daily" | "weekdays" | "weekly" | "monthly">("");

  async function add() {
    if (!title.trim() || !datetime) return;
    try {
      await create({
        data: {
          title,
          datetime: new Date(datetime).toISOString(),
          priority,
          recurrence: recurrence || null,
        },
      });
      qc.invalidateQueries({ queryKey: ["reminders"] });
      setTitle("");
      setDatetime("");
      setPriority("normal");
      setRecurrence("");
      toast.success("Logged, Sir.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  const reminders = data ?? [];
  const upcoming = reminders.filter((r: any) => !r.is_completed);
  const done = reminders.filter((r: any) => r.is_completed);

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag="01 · TIME"
        title="Schedule & reminders"
        subtitle="Pulled from your calendar and inbox, plus what you tell me."
      />
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        <div className="glass-strong hud-corners rounded-xl p-5">
          <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-3 flex items-center gap-2">
            <Plus size={12} /> NEW REMINDER
          </div>
          <div className="grid md:grid-cols-[1fr_220px_140px_140px_auto] gap-3">
            <input
              placeholder="e.g. Coffee with Marina"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
            />
            <input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none"
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as any)}
              className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
            >
              <option value="">One-off</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <button
              onClick={add}
              className="bg-arc text-arc-foreground rounded-md px-4 text-sm font-medium shadow-arc hover:opacity-90 transition"
            >
              Add
            </button>
          </div>
          <p className="mt-2 text-xs text-hud-dim">
            Tip: tell JARVIS in chat — "remind me every weekday at 8am to stretch" — and it will set it for you.
          </p>
        </div>

        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

        <section>
          <h2 className="font-display text-lg mb-3 flex items-center gap-2">
            <Calendar size={16} className="text-arc" /> Upcoming
          </h2>
          <div className="space-y-2">
            {upcoming.length === 0 && (
              <div className="glass rounded-lg p-4 text-sm text-muted-foreground">Clear horizon, Sir.</div>
            )}
            {upcoming.map((r: any) => {
              const mins = minutesUntil(r.datetime);
              const imminent = mins > 0 && mins <= 30;
              return (
                <article
                  key={r.id}
                  className={`${r.priority === "critical" ? "glass-critical" : "glass-strong"} rounded-lg p-4 flex items-start gap-4`}
                >
                  <button
                    onClick={async () => {
                      await toggle({ data: { id: r.id, completed: true } });
                      qc.invalidateQueries({ queryKey: ["reminders"] });
                    }}
                    className="mt-1 h-5 w-5 rounded border border-arc/40 hover:bg-arc/20 flex items-center justify-center transition"
                    aria-label="Complete"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium">{r.title}</h3>
                      <PriorityChip level={r.priority} />
                      {r.recurrence && (
                        <span className="text-[10px] font-mono text-arc bg-arc/10 border border-arc/20 px-1.5 py-0.5 rounded uppercase">
                          {r.recurrence}
                        </span>
                      )}
                      {imminent && (
                        <span className="text-[10px] font-mono text-critical animate-critical-pulse">IMMINENT</span>
                      )}
                    </div>
                    {r.description && <p className="text-sm text-muted-foreground mt-1">{r.description}</p>}
                    <div className="mt-1.5 font-mono text-xs text-arc">
                      {formatDateLong(r.datetime)} · {formatClock(r.datetime)}
                      <span className="text-hud-dim"> · {formatRelative(r.datetime)}</span>
                      {r.source_type && <span className="text-hud-dim"> · from {r.source_type}</span>}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      await del({ data: { id: r.id } });
                      qc.invalidateQueries({ queryKey: ["reminders"] });
                    }}
                    className="text-hud-dim hover:text-critical transition p-1"
                    aria-label="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        {done.length > 0 && (
          <section>
            <h2 className="font-display text-lg mb-3 text-hud-dim flex items-center gap-2">
              <Check size={16} /> Completed
            </h2>
            <div className="space-y-2 opacity-60">
              {done.slice(0, 10).map((r: any) => (
                <article key={r.id} className="glass rounded-lg p-3 flex items-center gap-3">
                  <button
                    onClick={async () => {
                      await toggle({ data: { id: r.id, completed: false } });
                      qc.invalidateQueries({ queryKey: ["reminders"] });
                    }}
                    className="h-4 w-4 rounded bg-arc/40 flex items-center justify-center"
                  >
                    <Check size={10} className="text-arc-foreground" />
                  </button>
                  <span className="text-sm line-through">{r.title}</span>
                  <span className="ml-auto font-mono text-xs text-hud-dim">{formatRelative(r.datetime)}</span>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
