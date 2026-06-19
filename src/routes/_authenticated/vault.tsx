import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listVault, upsertVault, deleteVault } from "@/lib/vault.functions";
import { hasVaultPin, setVaultPin } from "@/lib/vault-pin.functions";
import { PageHeader } from "@/components/jarvis/HudBits";
import { useState } from "react";
import { KeyRound, StickyNote, UserCircle2, Plus, Trash2, Eye, EyeOff, Save, X, Lock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vault")({
  ssr: false,
  head: () => ({ meta: [{ title: "Vault — JARVIS" }] }),
  component: VaultPage,
});

type Kind = "credential" | "note" | "contact";

const KIND_META: Record<Kind, { icon: any; label: string }> = {
  credential: { icon: KeyRound, label: "Credentials" },
  contact: { icon: UserCircle2, label: "Contacts" },
  note: { icon: StickyNote, label: "Notes" },
};

function VaultPage() {
  const qc = useQueryClient();
  const list = useServerFn(listVault);
  const save = useServerFn(upsertVault);
  const remove = useServerFn(deleteVault);
  const { data = [] } = useQuery({ queryKey: ["vault"], queryFn: () => list() });

  const [tab, setTab] = useState<Kind>("credential");
  const [editing, setEditing] = useState<any | null>(null);
  const items = (data as any[]).filter((i) => i.kind === tab);

  function newItem() {
    const blank: any = { kind: tab, label: "", data: tab === "credential"
      ? { username: "", password: "", url: "" }
      : tab === "contact" ? { name: "", email: "", phone: "", notes: "" }
      : { body: "" } };
    setEditing(blank);
  }

  async function onSave(item: any) {
    try {
      await save({ data: { id: item.id, kind: item.kind, label: item.label, data: item.data, tags: item.tags ?? [] } });
      qc.invalidateQueries({ queryKey: ["vault"] });
      setEditing(null);
      toast.success("Saved to vault.");
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this item?")) return;
    await remove({ data: { id } });
    qc.invalidateQueries({ queryKey: ["vault"] });
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader tag="06 · VAULT" title="Private vault"
        subtitle="Credentials and contacts JARVIS can recall on demand."
        right={
          <button onClick={newItem} className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md bg-arc text-arc-foreground shadow-arc hover:opacity-90">
            <Plus size={12} /> New {KIND_META[tab].label.toLowerCase().replace(/s$/, "")}
          </button>
        }
      />

      <div className="px-8 pt-4">
        <PinCard />
      </div>

      <div className="px-8 pt-4">
        <div className="inline-flex gap-1 bg-background/40 border border-arc/20 rounded-md p-1">
          {(Object.keys(KIND_META) as Kind[]).map((k) => {
            const Icon = KIND_META[k].icon;
            const active = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded inline-flex items-center gap-1.5 ${active ? "bg-arc text-arc-foreground" : "text-hud-dim hover:text-foreground"}`}>
                <Icon size={12} /> {KIND_META[k].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {items.length === 0 ? (
          <div className="glass-strong hud-corners rounded-xl p-10 text-center text-hud-dim">
            <div className="font-mono text-[10px] text-arc mb-2">VAULT EMPTY</div>
            Add your first {KIND_META[tab].label.toLowerCase().replace(/s$/, "")} or ask JARVIS to save it for you.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((item) => (
              <VaultCard key={item.id} item={item} onEdit={() => setEditing(item)} onDelete={() => onDelete(item.id)} />
            ))}
          </div>
        )}
      </div>

      {editing && <Editor item={editing} onSave={onSave} onClose={() => setEditing(null)} />}
    </div>
  );
}

function VaultCard({ item, onEdit, onDelete }: { item: any; onEdit: () => void; onDelete: () => void }) {
  const Icon = KIND_META[item.kind as Kind].icon;
  const [reveal, setReveal] = useState(false);
  return (
    <article className="glass-strong hud-corners rounded-xl p-4 group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={14} className="text-arc shrink-0" />
          <h3 className="font-display text-sm truncate">{item.label}</h3>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
          <button onClick={onEdit} className="text-xs px-2 py-1 rounded border border-arc/30 hover:bg-arc/10">Edit</button>
          <button onClick={onDelete} className="p-1.5 rounded border border-arc/30 hover:bg-critical/10 hover:text-critical hover:border-critical/40 transition" aria-label="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="space-y-1 font-mono text-xs text-hud-dim">
        {item.kind === "credential" && (<>
          {item.data?.url && <div className="truncate">{item.data.url}</div>}
          {item.data?.username && <div className="truncate">{item.data.username}</div>}
          {item.data?.password && (
            <div className="flex items-center gap-2">
              <span className="truncate">{reveal ? item.data.password : "••••••••••"}</span>
              <button onClick={() => setReveal((r) => !r)} className="text-arc">
                {reveal ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
            </div>
          )}
        </>)}
        {item.kind === "contact" && (<>
          {item.data?.name && <div className="truncate">{item.data.name}</div>}
          {item.data?.email && <div className="truncate">{item.data.email}</div>}
          {item.data?.phone && <div className="truncate">{item.data.phone}</div>}
        </>)}
        {item.kind === "note" && (
          <p className="text-xs text-foreground/80 line-clamp-4 whitespace-pre-wrap">{item.data?.body}</p>
        )}
      </div>
    </article>
  );
}

function Editor({ item, onSave, onClose }: { item: any; onSave: (i: any) => void; onClose: () => void }) {
  const [draft, setDraft] = useState({ ...item, data: { ...(item.data ?? {}) } });
  function setData(k: string, v: string) { setDraft({ ...draft, data: { ...draft.data, [k]: v } }); }
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="glass-strong hud-corners rounded-xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display">{draft.id ? "Edit" : "New"} {KIND_META[draft.kind as Kind].label.replace(/s$/, "")}</h2>
          <button onClick={onClose} className="text-hud-dim hover:text-foreground"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <Field label="Label" value={draft.label} onChange={(v: string) => setDraft({ ...draft, label: v })} />
          {draft.kind === "credential" && (<>
            <Field label="URL" value={draft.data.url ?? ""} onChange={(v: string) => setData("url", v)} />
            <Field label="Username" value={draft.data.username ?? ""} onChange={(v: string) => setData("username", v)} />
            <Field label="Password" type="password" value={draft.data.password ?? ""} onChange={(v: string) => setData("password", v)} />
          </>)}
          {draft.kind === "contact" && (<>
            <Field label="Name" value={draft.data.name ?? ""} onChange={(v: string) => setData("name", v)} />
            <Field label="Email" value={draft.data.email ?? ""} onChange={(v: string) => setData("email", v)} />
            <Field label="Phone" value={draft.data.phone ?? ""} onChange={(v: string) => setData("phone", v)} />
            <Field label="Notes" textarea value={draft.data.notes ?? ""} onChange={(v: string) => setData("notes", v)} />
          </>)}
          {draft.kind === "note" && (
            <Field label="Body" textarea rows={6} value={draft.data.body ?? ""} onChange={(v: string) => setData("body", v)} />
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-2 rounded border border-arc/20 hover:bg-arc/5">Cancel</button>
          <button onClick={() => onSave(draft)} disabled={!draft.label.trim()}
            className="text-xs px-3 py-2 rounded bg-arc text-arc-foreground shadow-arc inline-flex items-center gap-1.5 disabled:opacity-50">
            <Save size={12} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", textarea, rows = 2 }: any) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] tracking-[0.2em] text-hud-dim mb-1">{label.toUpperCase()}</span>
      {textarea ? (
        <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)}
          className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none" />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none" />
      )}
    </label>
  );
}
