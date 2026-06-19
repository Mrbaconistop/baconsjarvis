import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { QuickActionBar } from "@/components/jarvis/QuickActionBar";
import { PriorityHub } from "@/components/jarvis/PriorityHub";
import { PageHeader } from "@/components/jarvis/HudBits";
import { useRealtimeRefresh } from "@/components/jarvis/useRealtimeRefresh";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { morningBriefing } from "@/lib/jarvis.functions";
import { listFeeds } from "@/lib/social.functions";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { formatRelative } from "@/lib/time-utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Command Center — JARVIS" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useRouteContext({ from: "/_authenticated" });
  useRealtimeRefresh(user.id);
  const list = useServerFn(listFeeds);
  const brief = useServerFn(morningBriefing);

  const { data: feeds } = useQuery({ queryKey: ["feeds"], queryFn: () => list() });
  const [busy, setBusy] = useState(false);

  async function generateBriefing() {
    setBusy(true);
    try { await brief(); toast.success("Briefing ready, Sir."); }
    catch (e: any) { toast.error(e?.message ?? "Could not generate briefing"); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag="00 · COMMAND"
        title="Welcome back, Sir."
        subtitle="Triaged signals, ranked by what deserves your attention."
        right={
          <div className="flex gap-2">
            <button
              onClick={generateBriefing} disabled={busy}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md bg-arc text-arc-foreground shadow-arc hover:opacity-90 transition disabled:opacity-50"
            >
              <Sparkles size={12} /> Generate briefing
            </button>
          </div>
        }
      />

      {/* Live ticker */}
      <LiveTicker feeds={feeds ?? []} />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        <QuickActionBar />
        <PriorityHub />
      </div>
    </div>
  );
}

function LiveTicker({ feeds }: { feeds: any[] }) {
  if (!feeds.length) return null;
  const items = feeds.slice(0, 12);
  return (
    <div className="border-y border-arc/10 bg-background/30 overflow-hidden">
      <div className="flex whitespace-nowrap animate-ticker py-2">
        {[...items, ...items].map((f, i) => (
          <span key={i} className="font-mono text-xs text-hud-dim mx-6 inline-flex items-center gap-2">
            <span className="text-arc">[{f.platform.toUpperCase()}]</span>
            <span className={f.sentiment_label === "negative" ? "text-critical" : f.sentiment_label === "positive" ? "text-success" : ""}>
              {f.author_name}
            </span>
            <span className="opacity-70">— {f.content.slice(0, 80)}{f.content.length > 80 ? "…" : ""}</span>
            <span className="text-hud-dim/60">· {formatRelative(f.received_at)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
