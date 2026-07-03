import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { getCustomTab, updateCustomTab, deleteCustomTab } from "@/lib/custom-tabs.functions";
import { listThreads, createThread, deleteThread, getMessages } from "@/lib/chat.functions";
import { PageHeader } from "@/components/jarvis/HudBits";
import { ChatWindow } from "@/components/jarvis/ChatWindow";
import { Pencil, Save, Trash2, X, Sparkles, MessageSquare, Plus, PanelRightOpen, PanelRightClose } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/tabs/$slug")({
  ssr: false,
  head: () => ({ meta: [{ title: "Custom Tab — JARVIS" }] }),
  component: CustomTabPage,
});


function CustomTabPage() {
  const { slug } = Route.useParams();
  const qc = useQueryClient();
  const fetchTab = useServerFn(getCustomTab);
  const doUpdate = useServerFn(updateCustomTab);
  const doDelete = useServerFn(deleteCustomTab);

  const { data: tab, isLoading, refetch } = useQuery({
    queryKey: ["custom-tab", slug],
    queryFn: () => fetchTab({ data: { slug } }),
  });

  // Realtime: refresh when JARVIS updates this tab
  useEffect(() => {
    const ch = supabase
      .channel(`custom_tabs:${slug}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "custom_tabs" }, () => {
        refetch();
        qc.invalidateQueries({ queryKey: ["custom-tabs-nav"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [slug, refetch, qc]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [label, setLabel] = useState("");
  const [assistantOpen, setAssistantOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem("tab-assistant-open");
    return v === null ? true : v === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("tab-assistant-open", assistantOpen ? "1" : "0");
  }, [assistantOpen]);

  useEffect(() => {
    if (tab) {
      setDraft(tab.content_html || "");
      setLabel(tab.label || "");
    }
  }, [tab]);

  const srcDoc = useMemo(() => wrapHtml(tab?.content_html || ""), [tab?.content_html]);

  async function save() {
    if (!tab) return;
    await doUpdate({ data: { id: tab.id, content_html: draft, label } });
    toast.success("Tab saved");
    setEditing(false);
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
          <Link to="/dashboard" className="inline-block mt-4 text-arc text-sm underline">Back to command</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag={`TAB · ${tab.slug.toUpperCase()}`}
        title={tab.label}
        subtitle={tab.description || "Custom mini-app created by JARVIS."}
      />
      <div className="px-4 sm:px-8 pb-3 flex flex-wrap items-center gap-2">
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
          >
            <Pencil size={12} /> Edit
          </button>
        ) : (
          <>
            <button
              onClick={save}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-arc text-arc-foreground shadow-arc text-xs"
            >
              <Save size={12} /> Save
            </button>
            <button
              onClick={() => { setEditing(false); setDraft(tab.content_html); setLabel(tab.label); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/20 text-xs"
            >
              <X size={12} /> Cancel
            </button>
          </>
        )}
        <button
          onClick={() => setAssistantOpen((v) => !v)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-arc/30 text-xs hover:bg-arc/10"
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


      <div className="flex-1 min-h-0 px-4 sm:px-8 pb-6 flex gap-4">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="grid lg:grid-cols-2 gap-4 h-full">
              <div className="flex flex-col gap-2">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none"
                  placeholder="Tab label"
                />
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="flex-1 min-h-[300px] bg-background/40 border border-arc/20 rounded-md p-3 text-xs font-mono focus:border-arc focus:outline-none resize-none"
                  placeholder="<!-- Write HTML/CSS/JS here. It renders in a sandboxed iframe. -->"
                />
              </div>
              <div className="rounded-md overflow-hidden border border-arc/20 bg-white">
                <iframe title="preview" srcDoc={wrapHtml(draft)} sandbox="allow-scripts" className="w-full h-full min-h-[300px]" />
              </div>
            </div>
          ) : tab.content_html?.trim() ? (
            <iframe
              title={tab.label}
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-forms allow-popups"
              className="w-full h-full min-h-[400px] rounded-2xl border border-arc/20 bg-white shadow-arc"
            />
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

    </div>
  );
}

function wrapHtml(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root { color-scheme: light dark; }
  html,body { margin:0; padding:16px; font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background: #0b1220; color: #e6f2ff; }
  a { color: #4dd0ff; }
  button, input, select, textarea { font: inherit; }
</style>
</head><body>${body}</body></html>`;
}
