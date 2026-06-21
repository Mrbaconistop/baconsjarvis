import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProfile, listAccounts, getAiProvider, updateAiProvider } from "@/lib/profile.functions";
import { PageHeader } from "@/components/jarvis/HudBits";
import { Twitter, Linkedin, Instagram, Facebook, Mail, Calendar, CheckCircle2, Circle, Cpu } from "lucide-react";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — JARVIS" }] }),
  component: SettingsPage,
});

const PLATFORM_META: Record<string, { label: string; icon: any; note: string }> = {
  twitter: { label: "Twitter / X", icon: Twitter, note: "Bring your own X API credentials to enable." },
  linkedin: { label: "LinkedIn", icon: Linkedin, note: "Requires LinkedIn marketing developer approval." },
  instagram: { label: "Instagram", icon: Instagram, note: "Requires Instagram Graph API access." },
  facebook: { label: "Facebook Page", icon: Facebook, note: "Requires Facebook Pages developer app." },
  gmail: { label: "Gmail", icon: Mail, note: "Connect to let JARVIS read & draft mail." },
  calendar: { label: "Google Calendar", icon: Calendar, note: "Connect to surface upcoming events." },
};

function SettingsPage() {
  const qc = useQueryClient();
  const prof = useServerFn(getProfile);
  const accts = useServerFn(listAccounts);
  const getProvider = useServerFn(getAiProvider);
  const updateProvider = useServerFn(updateAiProvider);

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => prof() });
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => accts() });
  const { data: aiProviderData, isLoading: aiLoading } = useQuery({
    queryKey: ["ai-provider"],
    queryFn: () => getProvider(),
  });

  const [connecting, setConnecting] = useState(false);

  async function connectGoogle() {
    setConnecting(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/settings",
        extraParams: { prompt: "consent", access_type: "offline" },
      });
      if (result.error) {
        toast.error("Could not connect Google");
        return;
      }
      if (!result.redirected) toast.success("Google connected");
    } finally {
      setConnecting(false);
    }
  }

  const aiMutation = useMutation({
    mutationFn: (provider: string) => updateProvider({ data: { provider: provider as any } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["ai-provider"] });
      if (result?.ok) {
        toast.success("AI provider updated! Reloading...");
        setTimeout(() => window.location.reload(), 1000);
      } else {
        toast.error("Failed to update provider");
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to update provider");
    },
  });

  const currentProvider = aiProviderData?.provider || "groq";

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag="04 · SETTINGS"
        title="Configuration"
        subtitle="How JARVIS knows you and the channels you've connected."
      />
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
          <div className="flex items-center justify-between mb-4">
            <div className="font-mono text-[10px] tracking-[0.3em] text-arc">CONNECTED CHANNELS</div>
            <button
              onClick={connectGoogle}
              disabled={connecting}
              className="text-xs px-3 py-1.5 rounded-md border border-arc/30 bg-arc/10 hover:bg-arc/20 transition disabled:opacity-50"
            >
              {connecting ? "Opening…" : "Connect Google (Gmail + Calendar)"}
            </button>
          </div>
          <div className="space-y-2">
            {(["calendar", "gmail", "twitter", "linkedin", "instagram", "facebook"] as const).map((p) => {
              const meta = PLATFORM_META[p];
              const Icon = meta.icon;
              const acct = accounts?.find((a: any) => a.platform === p);
              const live = !!acct && acct.status === "connected";
              return (
                <div key={p} className="flex items-center gap-3 p-3 rounded-md bg-background/40 border border-arc/10">
                  <Icon size={16} className={live ? "text-success" : "text-hud-dim"} />
                  <div className="flex-1">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {meta.label}
                      {live ? (
                        <CheckCircle2 size={12} className="text-success" />
                      ) : (
                        <Circle size={12} className="text-hud-dim" />
                      )}
                    </div>
                    <div className="text-xs text-hud-dim">{meta.note}</div>
                  </div>
                  <span
                    className={`font-mono text-[10px] uppercase tracking-wider ${live ? "text-success" : "text-hud-dim"}`}
                  >
                    {live ? "Live" : "Not connected"}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-hud-dim">
            Nothing is linked automatically. Connect each channel here whenever you're ready.
          </p>
        </section>

        {/* AI Provider Selection */}
        <section className="glass-strong hud-corners rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Cpu size={16} className="text-arc" />
            <div className="font-mono text-[10px] tracking-[0.3em] text-arc">AI PROVIDER</div>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Choose which AI engine powers JARVIS. Changes take effect immediately.
          </p>

          {aiLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-3">
              {[
                { id: "groq", label: "Groq (Fast, Free)", desc: "Llama 3.1 8B — fastest responses, free tier" },
                { id: "deepseek", label: "DeepSeek (Cheap, Smart)", desc: "DeepSeek Chat — low cost, high quality" },
                { id: "gemini", label: "Google Gemini (Free)", desc: "Gemini 2.0 Flash — free tier, good quality" },
              ].map((opt) => {
                const isActive = currentProvider === opt.id;
                const isPending = aiMutation.isPending && aiMutation.variables === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => aiMutation.mutate(opt.id)}
                    disabled={isPending || isActive}
                    className={`w-full text-left p-4 rounded-lg border-2 transition ${
                      isActive
                        ? "border-arc bg-arc/10 shadow-arc"
                        : "border-arc/20 hover:border-arc/50 bg-background/30"
                    } ${isPending ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">
                          {opt.label}
                          {isPending && " (updating...)"}
                        </div>
                        <div className="text-xs text-muted-foreground">{opt.desc}</div>
                      </div>
                      {isActive && <span className="text-arc text-sm font-mono">● ACTIVE</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 p-3 bg-arc/5 border border-arc/20 rounded-lg">
            <div className="font-mono text-[10px] text-arc">CURRENT PROVIDER</div>
            <div className="font-display text-lg mt-1 capitalize">{currentProvider}</div>
            <div className="text-xs text-hud-dim mt-1">
              {currentProvider === "groq" && "Using Llama 3.1 8B via Groq API"}
              {currentProvider === "deepseek" && "Using DeepSeek Chat API"}
              {currentProvider === "gemini" && "Using Gemini 2.0 Flash via Google API"}
            </div>
          </div>
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
