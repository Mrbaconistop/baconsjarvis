import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/jarvis/HudBits";
import {
  listWebhooks,
  saveWebhook,
  deleteWebhook,
  testWebhook,
  fireDailyNow,
  getTodayCheckin,
  saveCheckin,
} from "@/lib/discord.functions";
import { createNotification } from "@/lib/notifications.functions";
import { Trash2, Send, Zap, Plus, Bell } from "lucide-react";

export const Route = createFileRoute("/_authenticated/briefing")({
  head: () => ({ meta: [{ title: "Daily Briefing — JARVIS" }] }),
  component: BriefingPage,
});

function BriefingPage() {
  const qc = useQueryClient();
  const list = useServerFn(listWebhooks);
  const save = useServerFn(saveWebhook);
  const del = useServerFn(deleteWebhook);
  const test = useServerFn(testWebhook);
  const fire = useServerFn(fireDailyNow);
  const getCi = useServerFn(getTodayCheckin);
  const saveCi = useServerFn(saveCheckin);
  const createNotif = useServerFn(createNotification);

  const { data: hooks } = useQuery({ queryKey: ["discord-webhooks"], queryFn: () => list() });
  const { data: checkin } = useQuery({ queryKey: ["checkin-today"], queryFn: () => getCi() });

  const refresh = () => qc.invalidateQueries({ queryKey: ["discord-webhooks"] });

  const fireMut = useMutation({
    mutationFn: () => fire(),
    onSuccess: (r: any) => toast.success(`Sent ${r.sent} briefing(s) to Discord`),
    onError: (e: any) => toast.error(String(e.message ?? e)),
  });

  const [notifBusy, setNotifBusy] = useState(false);

  async function sendTestNotification() {
    setNotifBusy(true);
    try {
      await createNotif({
        data: {
          type: "alert",
          priority: "critical",
          title: "🔔 Test Push Notification",
          message: "This is a test alert from JARVIS. Your Discord push notifications are working!",
          action_payload: [{ type: "dismiss", label: "Dismiss" }],
          send_push: true,
        },
      });
      toast.success("Test notification sent to Discord!");
    } catch (e: any) {
      toast.error(e?.message || "Failed to send test notification");
    } finally {
      setNotifBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag="05 · BRIEFING"
        title="Daily Discord Briefing"
        subtitle="JARVIS pushes a daily digest to Discord at 12:00 UTC — inbox, agenda, reminders, spending, and your check-in."
        right={
          <div className="flex gap-2">
            <button
              onClick={sendTestNotification}
              disabled={notifBusy}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border border-arc/30 bg-arc/10 hover:bg-arc/20 transition disabled:opacity-50"
            >
              <Bell size={12} /> {notifBusy ? "Sending…" : "Test Push"}
            </button>
            <button
              onClick={() => fireMut.mutate()}
              disabled={fireMut.isPending}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md bg-arc text-arc-foreground shadow-arc hover:opacity-90 transition disabled:opacity-50"
            >
              <Zap size={12} /> {fireMut.isPending ? "Sending…" : "Send briefing now"}
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 max-w-3xl">
        <CheckinCard
          initial={checkin}
          onSave={async (vals) => {
            await saveCi({ data: vals });
            toast.success("Check-in logged");
            qc.invalidateQueries({ queryKey: ["checkin-today"] });
          }}
        />

        <section className="glass-strong hud-corners rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="font-mono text-[10px] tracking-[0.3em] text-arc">DISCORD WEBHOOKS</div>
            <button
              onClick={() => fireMut.mutate()}
              disabled={fireMut.isPending}
              className="text-xs px-3 py-1.5 rounded-md border border-arc/30 bg-arc/10 hover:bg-arc/20 flex items-center gap-2 disabled:opacity-50"
            >
              <Zap size={12} /> {fireMut.isPending ? "Sending…" : "Send briefing now"}
            </button>
          </div>

          <div className="space-y-3">
            {(hooks ?? []).map((h: any) => (
              <WebhookRow
                key={h.id}
                hook={h}
                onSave={async (patch: any) => {
                  await save({ data: { ...h, ...patch } });
                  refresh();
                  toast.success("Saved");
                }}
                onTest={async () => {
                  try {
                    await test({ data: { id: h.id } });
                    toast.success("Test sent");
                  } catch (e: any) {
                    toast.error(e.message);
                  }
                }}
                onDelete={async () => {
                  await del({ data: { id: h.id } });
                  refresh();
                }}
              />
            ))}
            <NewWebhook
              onCreate={async (vals: any) => {
                await save({ data: vals });
                refresh();
                toast.success("Webhook added");
              }}
            />
          </div>
          <p className="mt-4 text-xs text-hud-dim">
            Create a webhook in your Discord channel (Edit Channel → Integrations → Webhooks) and paste the URL here.
            Daily delivery fires at 12:00 UTC. Test push notifications using the button above.
          </p>
        </section>
      </div>
    </div>
  );
}

// ---------- CheckinCard ----------
function CheckinCard({ initial, onSave }: { initial: any; onSave: (v: any) => Promise<void> }) {
  const [w, setW] = useState(initial?.weight_lbs ?? "");
  const [h, setH] = useState(initial?.height_in ?? "");
  const [mood, setMood] = useState(initial?.mood ?? "");
  const [energy, setEnergy] = useState(initial?.energy ?? "");
  const [sleep, setSleep] = useState(initial?.sleep_hours ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <section className="glass-strong hud-corners rounded-xl p-5">
      <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-4">TODAY'S CHECK-IN</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Num label="Weight (lbs)" value={w} onChange={setW} />
        <Num label="Height (in)" value={h} onChange={setH} />
        <Num label="Sleep (h)" value={sleep} onChange={setSleep} />
        <Num label="Energy (1–10)" value={energy} onChange={setEnergy} />
        <Field label="Mood" value={mood} onChange={setMood} placeholder="great / tired / focused" />
        <Field label="Notes" value={notes} onChange={setNotes} placeholder="optional" />
      </div>
      <button
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave({
              weight_lbs: w === "" ? null : Number(w),
              height_in: h === "" ? null : Number(h),
              mood: mood || null,
              energy: energy === "" ? null : Number(energy),
              sleep_hours: sleep === "" ? null : Number(sleep),
              notes: notes || null,
            });
          } finally {
            setSaving(false);
          }
        }}
        className="mt-4 text-xs px-3 py-1.5 rounded-md border border-arc/30 bg-arc/10 hover:bg-arc/20 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Log check-in"}
      </button>
    </section>
  );
}

function Num({ label, value, onChange }: any) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-wider text-hud-dim">{label.toUpperCase()}</span>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-background/40 border border-arc/20 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-arc"
      />
    </label>
  );
}

function Field({ label, value, onChange, placeholder }: any) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-wider text-hud-dim">{label.toUpperCase()}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full bg-background/40 border border-arc/20 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-arc"
      />
    </label>
  );
}

// ---------- SECTIONS with @everyone toggle ----------
const SECTIONS = [
  ["include_email", "Email digest"],
  ["include_calendar", "Calendar"],
  ["include_reminders", "Reminders"],
  ["include_spending", "Spending"],
  ["include_checkin", "Check-in"],
  ["include_mention_everyone", "@everyone ping"],
] as const;

function WebhookRow({ hook, onSave, onTest, onDelete }: any) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(hook.name);
  const [url, setUrl] = useState(hook.url);
  const [enabled, setEnabled] = useState(hook.enabled);
  const [flags, setFlags] = useState<any>(Object.fromEntries(SECTIONS.map(([k]) => [k, hook[k] ?? false])));

  return (
    <div className="border border-arc/15 rounded-md bg-background/30">
      <div className="flex items-center gap-3 p-3">
        <button onClick={() => setOpen(!open)} className="flex-1 text-left">
          <div className="text-sm font-medium">{hook.name}</div>
          <div className="text-xs text-hud-dim truncate">{hook.url.replace(/\/[^/]+$/, "/•••")}</div>
        </button>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            onChange={async (e) => {
              setEnabled(e.target.checked);
              await onSave({ enabled: e.target.checked });
            }}
          />
          On
        </label>
        <button onClick={onTest} className="p-1.5 rounded hover:bg-arc/10" title="Send test">
          <Send size={14} />
        </button>
        <button onClick={onDelete} className="p-1.5 rounded hover:bg-critical/10 text-critical" title="Delete">
          <Trash2 size={14} />
        </button>
      </div>
      {open && (
        <div className="border-t border-arc/10 p-3 space-y-3">
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Webhook URL" value={url} onChange={setUrl} placeholder="https://discord.com/api/webhooks/..." />
          <div>
            <div className="font-mono text-[10px] tracking-wider text-hud-dim mb-2">SECTIONS</div>
            <div className="flex flex-wrap gap-3">
              {SECTIONS.map(([k, lbl]) => (
                <label key={k} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!!flags[k]}
                    onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })}
                  />
                  {lbl}
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={() => onSave({ name, url, ...flags })}
            className="text-xs px-3 py-1.5 rounded-md border border-arc/30 bg-arc/10 hover:bg-arc/20"
          >
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

function NewWebhook({ onCreate }: any) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Daily Briefing");
  const [url, setUrl] = useState("");

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-xs text-arc border border-dashed border-arc/30 rounded-md hover:bg-arc/5"
      >
        <Plus size={14} /> Add Discord webhook
      </button>
    );
  return (
    <div className="border border-arc/20 rounded-md p-3 space-y-3 bg-background/30">
      <Field label="Name" value={name} onChange={setName} />
      <Field label="Webhook URL" value={url} onChange={setUrl} placeholder="https://discord.com/api/webhooks/..." />
      <div className="flex gap-2">
        <button
          onClick={async () => {
            if (!url.includes("discord.com/api/webhooks/")) {
              toast.error("That doesn't look like a Discord webhook URL");
              return;
            }
            await onCreate({
              name,
              url,
              enabled: true,
              include_email: true,
              include_calendar: true,
              include_reminders: true,
              include_checkin: true,
              include_spending: true,
              include_mention_everyone: false,
            });
            setOpen(false);
            setUrl("");
          }}
          className="text-xs px-3 py-1.5 rounded-md border border-arc/30 bg-arc/10 hover:bg-arc/20"
        >
          Create
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-xs px-3 py-1.5 rounded-md border border-arc/20 hover:bg-arc/5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
