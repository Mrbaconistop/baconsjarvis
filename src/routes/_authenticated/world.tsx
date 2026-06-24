import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listFeeds,
  markFeedHandled,
  refreshFeed,
  fetchDiscordMessages,
  fetchDiscordDMs,
  getDiscordChannel,
  setDiscordChannel,
} from "@/lib/social.functions";
import { draftReply } from "@/lib/jarvis.functions";
import { PageHeader, PriorityChip } from "@/components/jarvis/HudBits";
import { formatRelative } from "@/lib/time-utils";
import { useState } from "react";
import {
  Twitter,
  Linkedin,
  Instagram,
  Facebook,
  Check,
  Sparkles,
  RefreshCw,
  MessageCircle,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/world")({
  head: () => ({
    meta: [
      { title: "World — JARVIS" },
      { name: "description", content: "Social command center across every platform." },
    ],
  }),
  component: WorldPage,
});

const PLATFORMS = [
  { id: "twitter", label: "Twitter / X", icon: Twitter },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin },
  { id: "instagram", label: "Instagram", icon: Instagram },
  { id: "facebook", label: "Facebook", icon: Facebook },
  { id: "discord", label: "Discord", icon: MessageCircle },
  { id: "discord_dm", label: "Discord DM", icon: MessageCircle },
] as const;

function WorldPage() {
  const qc = useQueryClient();
  const list = useServerFn(listFeeds);
  const handled = useServerFn(markFeedHandled);
  const draft = useServerFn(draftReply);
  const refresh = useServerFn(refreshFeed);
  const fetchDiscord = useServerFn(fetchDiscordMessages);
  const fetchDMs = useServerFn(fetchDiscordDMs);
  const getChannel = useServerFn(getDiscordChannel);
  const setChannel = useServerFn(setDiscordChannel);

  const [refreshing, setRefreshing] = useState(false);
  const [fetchingDiscord, setFetchingDiscord] = useState(false);
  const [fetchingDMs, setFetchingDMs] = useState(false);
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [channelInput, setChannelInput] = useState("");

  const { data, refetch } = useQuery({
    queryKey: ["feeds"],
    queryFn: () => list(),
  });

  const { data: channelData, refetch: refetchChannel } = useQuery({
    queryKey: ["discord-channel"],
    queryFn: () => getChannel(),
  });

  const [filter, setFilter] = useState<"all" | "negative" | "actionable">("all");

  const feeds = (data ?? []).filter((f: any) => {
    if (filter === "negative") return f.sentiment_label === "negative";
    if (filter === "actionable") return f.is_actionable && !f.is_handled;
    return true;
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refresh();
      await refetch();
      toast.success("Feed refreshed, Sir.");
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleFetchDiscord() {
    setFetchingDiscord(true);
    try {
      const result = await fetchDiscord({});
      await refetch();
      toast.success(`Fetched ${result?.length || 0} Discord messages, Sir.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to fetch Discord messages");
    } finally {
      setFetchingDiscord(false);
    }
  }

  async function handleFetchDMs() {
    setFetchingDMs(true);
    try {
      const result = await fetchDMs({});
      await refetch();
      toast.success(`Fetched ${result?.length || 0} Discord DMs, Sir.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to fetch DMs");
    } finally {
      setFetchingDMs(false);
    }
  }

  async function handleSetChannel() {
    if (!channelInput.trim()) return toast.error("Channel ID required");
    try {
      await setChannel({ data: { channelId: channelInput.trim() } });
      await refetchChannel();
      setShowChannelModal(false);
      setChannelInput("");
      toast.success("Discord channel set, Sir.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to set channel");
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag="02 · WORLD"
        title="Social command center"
        subtitle="Mentions, DMs, and requests — scored and triaged."
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border border-arc/30 hover:bg-arc/10 transition disabled:opacity-50"
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              onClick={handleFetchDiscord}
              disabled={fetchingDiscord}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border border-arc/30 hover:bg-arc/10 transition disabled:opacity-50"
            >
              <MessageCircle size={12} className={fetchingDiscord ? "animate-spin" : ""} />
              {fetchingDiscord ? "Fetching…" : "Discord"}
            </button>
            <button
              onClick={handleFetchDMs}
              disabled={fetchingDMs}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border border-arc/30 hover:bg-arc/10 transition disabled:opacity-50"
            >
              <MessageCircle size={12} className={fetchingDMs ? "animate-spin" : ""} />
              {fetchingDMs ? "Fetching…" : "DMs"}
            </button>
            <button
              onClick={() => setShowChannelModal(true)}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border border-arc/30 hover:bg-arc/10 transition"
            >
              <Settings2 size={12} />
            </button>
            <div className="flex gap-1 bg-background/40 border border-arc/20 rounded-md p-1">
              {(["all", "actionable", "negative"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`px-3 py-1 text-xs font-mono uppercase tracking-wider rounded ${filter === k ? "bg-arc text-arc-foreground" : "text-hud-dim hover:text-foreground"}`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 grid xl:grid-cols-4 lg:grid-cols-2 gap-5">
        {PLATFORMS.map((p) => {
          const items = feeds.filter((f: any) => f.platform === p.id);
          const Icon = p.icon;
          return (
            <section key={p.id} className="glass-strong hud-corners rounded-xl flex flex-col min-h-[300px]">
              <header className="px-4 py-3 border-b border-arc/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon size={14} className="text-arc" />
                  <h3 className="font-display text-sm">{p.label}</h3>
                </div>
                <span className="font-mono text-[10px] text-hud-dim">{items.length}</span>
              </header>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {items.length === 0 && (
                  <div className="text-xs text-hud-dim p-4 text-center">
                    {p.id === "discord"
                      ? "No Discord messages yet. Configure the channel and fetch."
                      : p.id === "discord_dm"
                        ? "No DMs fetched yet. Click 'DMs' to fetch."
                        : "Nothing here yet."}
                  </div>
                )}
                {items.map((f: any) => (
                  <FeedCard
                    key={f.id}
                    feed={f}
                    onDraft={async () => {
                      const res = await draft({
                        data: { feedId: f.id, tone: f.sentiment_label === "negative" ? "measured" : "warm" },
                      });
                      return res.draft;
                    }}
                    onHandle={async () => {
                      await handled({ data: { id: f.id } });
                      qc.invalidateQueries({ queryKey: ["feeds"] });
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Discord Channel Modal */}
      {showChannelModal && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-6"
          onClick={() => setShowChannelModal(false)}
        >
          <div className="glass-strong hud-corners rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg">Discord Channel</h2>
              <button onClick={() => setShowChannelModal(false)} className="text-hud-dim hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Current channel: <span className="text-arc font-mono">{channelData?.channelId || "Not set"}</span>
            </p>
            <input
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
              placeholder="Enter Discord channel ID"
              className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none"
            />
            <button
              onClick={handleSetChannel}
              className="w-full mt-4 bg-arc text-arc-foreground py-2 rounded-md shadow-arc hover:opacity-90 transition"
            >
              Set Channel
            </button>
            <p className="text-[10px] text-hud-dim mt-3">
              Right‑click a Discord channel → Copy ID (enable Developer Mode in Settings first).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedCard({
  feed,
  onDraft,
  onHandle,
}: {
  feed: any;
  onDraft: () => Promise<string>;
  onHandle: () => Promise<void>;
}) {
  const [drafted, setDrafted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function makeDraft() {
    setBusy(true);
    try {
      setDrafted(await onDraft());
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  const sentimentColor =
    feed.sentiment_label === "negative"
      ? "text-critical"
      : feed.sentiment_label === "positive"
        ? "text-success"
        : "text-hud-dim";

  return (
    <article
      className={`rounded-md p-3 ${feed.priority === "critical" ? "border border-critical/40 bg-critical/5" : "bg-background/40 border border-arc/10"} ${feed.is_handled ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{feed.author_name}</div>
          {feed.author_handle && <div className="font-mono text-[10px] text-hud-dim">{feed.author_handle}</div>}
        </div>
        <PriorityChip level={feed.priority} />
      </div>
      <p className="text-sm">{feed.content}</p>
      <div className="mt-2 flex items-center justify-between text-[10px] font-mono">
        <span className={sentimentColor}>
          {feed.sentiment_label?.toUpperCase()}{" "}
          {feed.sentiment_score != null &&
            `· ${feed.sentiment_score > 0 ? "+" : ""}${Number(feed.sentiment_score).toFixed(2)}`}
        </span>
        <span className="text-hud-dim">{formatRelative(feed.received_at)}</span>
      </div>
      {!feed.is_handled && (
        <div className="mt-2 flex gap-1">
          <button
            onClick={makeDraft}
            disabled={busy}
            className="flex-1 text-xs flex items-center justify-center gap-1 px-2 py-1.5 border border-arc/30 rounded hover:bg-arc/10 transition disabled:opacity-50"
          >
            <Sparkles size={10} /> {busy ? "…" : "Draft"}
          </button>
          <button
            onClick={onHandle}
            className="text-xs flex items-center gap-1 px-2 py-1.5 border border-arc/30 rounded hover:bg-arc/10 transition"
          >
            <Check size={10} /> Done
          </button>
        </div>
      )}
      {drafted && (
        <div className="mt-2 p-2 rounded bg-arc/5 border border-arc/20">
          <div className="font-mono text-[9px] text-arc mb-1">JARVIS DRAFT</div>
          <p className="text-xs">{drafted}</p>
        </div>
      )}
    </article>
  );
}
