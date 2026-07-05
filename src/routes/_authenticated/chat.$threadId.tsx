import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listThreads, createThread, deleteThread, getMessages } from "@/lib/chat.functions";
import { ChatWindow } from "@/components/jarvis/ChatWindow";
import { Plus, MessageSquare, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/jarvis/HudBits";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Chat — JARVIS" }] }),
  component: ChatPage,
});

function ChatPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const list = useServerFn(listThreads);
  const create = useServerFn(createThread);
  const remove = useServerFn(deleteThread);
  const fetchMessages = useServerFn(getMessages);

  const { data: threads = [] } = useQuery({ queryKey: ["threads"], queryFn: () => list() });
  const { data: initial = [], isLoading } = useQuery({
    queryKey: ["chat-messages", threadId],
    queryFn: () => fetchMessages({ data: { threadId } }),
  });

  const [creating, setCreating] = useState(false);
  async function newThread() {
    setCreating(true);
    try {
      const t = await create({ data: {} });
      qc.invalidateQueries({ queryKey: ["threads"] });
      navigate({ to: "/chat/$threadId", params: { threadId: t.id } });
    } finally { setCreating(false); }
  }

  async function onDelete(id: string) {
    await remove({ data: { id } });
    qc.invalidateQueries({ queryKey: ["threads"] });
    if (id === threadId) {
      const remaining = threads.filter((t: any) => t.id !== id);
      if (remaining.length) navigate({ to: "/chat/$threadId", params: { threadId: remaining[0].id } });
      else navigate({ to: "/chat" });
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader tag="05 · CHAT" title="Conversation" subtitle="Speak with JARVIS. Tools for reminders & vault are wired in." />
      <div className="flex-1 flex min-h-0">
        <aside className="hidden md:flex w-64 border-r border-arc/15 flex-col bg-background/30">
          <div className="p-3 border-b border-arc/10">
            <button onClick={newThread} disabled={creating}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-arc text-arc-foreground shadow-arc text-xs font-medium hover:opacity-90 disabled:opacity-50">
              <Plus size={14} /> New conversation
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {threads.map((t: any) => {
              const active = t.id === threadId;
              return (
                <div key={t.id} className={`group flex items-center rounded-md transition ${active ? "bg-arc/15" : "hover:bg-arc/5"}`}>
                  <Link to="/chat/$threadId" params={{ threadId: t.id }}
                    className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-xs">
                    <MessageSquare size={12} className={active ? "text-arc" : "text-hud-dim"} />
                    <span className="truncate">{t.title}</span>
                  </Link>
                  <button onClick={() => onDelete(t.id)}
                    className="p-2 opacity-0 group-hover:opacity-100 text-hud-dim hover:text-critical transition" aria-label="Delete">
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="p-8 text-hud-dim text-sm font-mono">Loading…</div>
          ) : (
            <ChatWindow threadId={threadId} initial={initial as any} />
          )}
        </div>
      </div>
    </div>
  );
}
