import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProfile, listAccounts, getLLMConfig, updateLLMConfig } from "@/lib/profile.functions";
import { PageHeader } from "@/components/jarvis/HudBits";
import { Twitter, Linkedin, Instagram, Facebook, Mail, Calendar, CheckCircle2, Circle } from "lucide-react";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { useState, useEffect } from "react";

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
  const prof = useServerFn(getProfile);
  const accts = useServerFn(listAccounts);
  const getConfig = useServerFn(getLLMConfig);
  const updateConfig = useServerFn(updateLLMConfig);

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => prof() });
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => accts() });
  const { data: llmConfig, refetch } = useQuery({
    queryKey: ["llm-config"],
    queryFn: () => getConfig(),
  });

  const [connecting, setConnecting] = useState(false);
  const [provider, setProvider] = useState<"groq" | "deepseek" | "lovable" | "system">("system");
  const [apiKey, setApiKey] = useState("");
  const [savingLlm, setSavingLlm] = useState(false);

  useEffect(() => {
    if (llmConfig) {
      setProvider(llmConfig.provider as typeof provider);
      setApiKey(llmConfig.apiKey || "");
    }
  }, [llmConfig]);

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

  async function saveLlm() {
    setSavingLlm(true);
    try {
      await updateConfig({ data: { provider, apiKey: apiKey || undefined } });
      await refetch();
      toast.success("AI provider updated");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update");
    } finally {
      setSavingLlm(false);
    }
  }

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
          <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-4">AI PROVIDER</div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <label className="text-sm font-medium">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as typeof provider)}
                className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
              >
                <option value="system">System default</option>
                <option value="groq">Groq</option>
                <option value="deepseek">DeepSeek</option>
                <option value="lovable">Lovable</option>
              </select>
            </div>
            {provider !== "system" && (
              <div className="flex flex-wrap items-center gap-4">
                <label className="text-sm font-medium">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your API key"
                  className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none w-64"
                />
              </div>
            )}
            <button
              onClick={saveLlm}
              disabled={savingLlm || (provider !== "system" && !apiKey)}
              className="text-xs px-4 py-2 rounded-md bg-arc text-arc-foreground shadow-arc hover:opacity-90 transition disabled:opacity-50"
            >
              {savingLlm ? "Saving…" : "Save AI settings"}
            </button>
            <p className="text-xs text-hud-dim mt-2">
              Choose a provider and enter your own API key to override the system default. The key is stored securely in
              your user profile.
            </p>
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
