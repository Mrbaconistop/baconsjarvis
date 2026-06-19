import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProfile, listAccounts } from "@/lib/profile.functions";
import { PageHeader } from "@/components/jarvis/HudBits";
import { Twitter, Linkedin, Instagram, Facebook, Mail, Calendar, CheckCircle2, Circle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — JARVIS" }] }),
  component: SettingsPage,
});

const PLATFORM_META: Record<string, { label: string; icon: any; note: string }> = {
  twitter:   { label: "Twitter / X",   icon: Twitter,   note: "Connect requires X API credentials. Currently showing demo data." },
  linkedin:  { label: "LinkedIn",      icon: Linkedin,  note: "Requires LinkedIn marketing developer approval. Showing demo data." },
  instagram: { label: "Instagram",     icon: Instagram, note: "Requires Instagram Graph API access. Showing demo data." },
  facebook:  { label: "Facebook Page", icon: Facebook,  note: "Requires FB Pages developer app. Showing demo data." },
  gmail:     { label: "Gmail",         icon: Mail,      note: "Connected via Lovable connector." },
  calendar:  { label: "Google Calendar", icon: Calendar, note: "Connected via Lovable connector." },
};

function SettingsPage() {
  const prof = useServerFn(getProfile);
  const accts = useServerFn(listAccounts);
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => prof() });
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => accts() });

  return (
    <div className="flex flex-col h-screen">
      <PageHeader tag="04 · SETTINGS" title="Configuration" subtitle="How JARVIS knows you and the channels you've connected." />
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 max-w-3xl">
        <section className="glass-strong hud-corners rounded-xl p-5">
          <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-4">PROFILE</div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Name" value={profile?.name ?? "—"} />
            <Field label="Email" value={profile?.email ?? "—"} />
            <Field label="Address as" value={profile?.address_as ?? "Sir"} />
            <Field label="Briefing time" value={profile?.preferred_briefing_time ?? "08:00"} />
            <Field label="Timezone" value={profile?.timezone ?? "UTC"} />
          </div>
        </section>

        <section className="glass-strong hud-corners rounded-xl p-5">
          <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-4">CONNECTED CHANNELS</div>
          <div className="space-y-2">
            {(["calendar", "gmail", "twitter", "linkedin", "instagram", "facebook"] as const).map((p) => {
              const meta = PLATFORM_META[p];
              const Icon = meta.icon;
              const live = p === "calendar" || p === "gmail";
              const acct = accounts?.find((a: any) => a.platform === p);
              return (
                <div key={p} className="flex items-center gap-3 p-3 rounded-md bg-background/40 border border-arc/10">
                  <Icon size={16} className={live ? "text-success" : "text-hud-dim"} />
                  <div className="flex-1">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {meta.label}
                      {live ? <CheckCircle2 size={12} className="text-success" /> : <Circle size={12} className="text-hud-dim" />}
                    </div>
                    <div className="text-xs text-hud-dim">{meta.note}</div>
                  </div>
                  <span className={`font-mono text-[10px] uppercase tracking-wider ${live ? "text-success" : "text-warning"}`}>
                    {live ? "Live" : (acct?.status ?? "demo")}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-hud-dim">
            To go live on social platforms, register developer apps with each provider and share the
            client credentials. JARVIS will then run sentiment, drafting, and live monitoring against
            real mentions.
          </p>
        </section>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-wider text-hud-dim">{label.toUpperCase()}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}
