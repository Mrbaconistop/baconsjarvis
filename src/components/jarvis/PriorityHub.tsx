import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listNotifications, dismissNotification } from "@/lib/notifications.functions";
import { draftReply } from "@/lib/jarvis.functions";
import { markFeedHandled } from "@/lib/social.functions";
import { PriorityChip } from "./HudBits";
import { formatRelative } from "@/lib/time-utils";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Check } from "lucide-react";

type Action = { type: string; label: string; minutes?: number; feedId?: string };
type Notification = {
  id: string; type: string; priority: "critical" | "high" | "normal" | "low";
  title: string; message: string; action_payload: Action[]; created_at: string; read_status: boolean;
  source_id?: string | null;
};

export function PriorityHub() {
  const list = useServerFn(listNotifications);
  const dismiss = useServerFn(dismissNotification);
  const draft = useServerFn(draftReply);
  const handled = useServerFn(markFeedHandled);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => list(),
  });

  const [drafting, setDrafting] = useState<Record<string, string | "loading">>({});
  const [copied, setCopied] = useState<string | null>(null);

  async function runAction(n: Notification, a: Action) {
    if (a.type === "dismiss" || a.type === "snooze" || a.type === "ignore" || a.type === "view") {
      await dismiss({ data: { id: n.id } });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      if (a.type === "snooze") toast.success(`Snoozed ${a.minutes ?? 60}m, Sir.`);
    } else if (a.type === "reply_ai") {
      const feedId = a.feedId ?? n.source_id;
      if (!feedId) return toast.error("No source feed.");
      setDrafting((s) => ({ ...s, [n.id]: "loading" }));
      try {
        const res = await draft({ data: { feedId, tone: "measured" } });
        setDrafting((s) => ({ ...s, [n.id]: res.draft }));
      } catch (e: any) {
        toast.error(e?.message ?? "Draft failed");
        setDrafting((s) => { const c = { ...s }; delete c[n.id]; return c; });
      }
    } else if (a.type === "accept_with_note") {
      toast.success("Accepted with note. (Demo)");
      await dismiss({ data: { id: n.id } });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }
  }

  async function sendDraft(n: Notification, a: Action) {
    const feedId = a.feedId ?? n.source_id;
    if (feedId) await handled({ data: { id: feedId } });
    await dismiss({ data: { id: n.id } });
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["feeds"] });
    toast.success("Reply sent. (Demo — connect platform to deliver for real.)");
  }

  if (isLoading) return <div className="glass rounded-xl p-6 text-sm text-muted-foreground">Scanning channels…</div>;
  if (!data?.length) return <div className="glass rounded-xl p-6 text-sm text-muted-foreground">All quiet, Sir.</div>;

  const grouped: Record<string, Notification[]> = { critical: [], high: [], normal: [], low: [] };
  (data as Notification[]).forEach((n) => grouped[n.priority]?.push(n));

  return (
    <div className="space-y-5">
      {(["critical", "high", "normal", "low"] as const).map((level) => {
        const items = grouped[level];
        if (!items?.length) return null;
        return (
          <section key={level}>
            <div className="flex items-center gap-3 mb-2">
              <PriorityChip level={level} />
              <div className="h-px flex-1 bg-arc/10" />
              <span className="font-mono text-[10px] text-hud-dim">{items.length}</span>
            </div>
            <div className="space-y-3">
              {items.map((n) => (
                <article key={n.id} className={`${level === "critical" ? "glass-critical" : "glass-strong"} hud-corners rounded-xl p-5`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-display text-base">{n.title}</h3>
                        <span className="font-mono text-[10px] text-hud-dim">· {formatRelative(n.created_at)}</span>
                      </div>
                      <p className="text-sm text-foreground/90 leading-relaxed">{n.message}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {n.action_payload?.map((a, i) => (
                      <button
                        key={i}
                        onClick={() => runAction(n, a)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-md border transition ${
                          a.type === "reply_ai" || a.type === "accept_with_note"
                            ? "bg-arc text-arc-foreground border-arc shadow-arc hover:opacity-90"
                            : "border-arc/30 hover:bg-arc/10"
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                  {drafting[n.id] && (
                    <div className="mt-4 p-3 rounded-md bg-arc/5 border border-arc/20">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-mono text-[10px] text-arc">DRAFTED REPLY</div>
                        {drafting[n.id] !== "loading" && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(drafting[n.id] as string);
                                setCopied(n.id);
                                setTimeout(() => setCopied(null), 1500);
                              }}
                              className="text-xs flex items-center gap-1 px-2 py-1 hover:bg-arc/10 rounded"
                            >
                              {copied === n.id ? <Check size={12} /> : <Copy size={12} />}
                              Copy
                            </button>
                            <button
                              onClick={() => sendDraft(n, n.action_payload.find((a) => a.type === "reply_ai")!)}
                              className="text-xs px-3 py-1 bg-arc text-arc-foreground rounded font-medium"
                            >
                              Send
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-sm whitespace-pre-wrap">
                        {drafting[n.id] === "loading" ? "JARVIS is composing…" : drafting[n.id]}
                      </p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
