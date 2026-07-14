import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getProfile,
  listAccounts,
  getLLMConfig,
  updateLLMConfig,
  storeGoogleConnection,
} from "@/lib/profile.functions";
import { PageHeader } from "@/components/jarvis/HudBits";
import { Twitter, Linkedin, Instagram, Facebook, Mail, Calendar, CheckCircle2, Circle } from "lucide-react";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { DiagnosticsTab } from "@/components/jarvis/DiagnosticsTab";
import { ThemeCustomizer } from "@/components/jarvis/ThemeCustomizer";
import { LibraryManager } from "@/components/jarvis/LibraryManager";

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

const DEFAULT_GROQ_KEY = "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";

function SettingsPage() {
  const qc = useQueryClient();
  const prof = useServerFn(getProfile);
  const accts = useServerFn(listAccounts);
  const getConfig = useServerFn(getLLMConfig);
  const updateConfig = useServerFn(updateLLMConfig);
  const storeGoogle = useServerFn(storeGoogleConnection);

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => prof() });
  const { data: accounts, refetch: refetchAccounts } = useQuery({ queryKey: ["accounts"], queryFn: () => accts() });
  const { data: llmConfig, refetch } = useQuery({
    queryKey: ["llm-config"],
    queryFn: () => getConfig(),
  });

  const [connecting, setConnecting] = useState(false);
  const [provider, setProvider] = useState<"groq" | "deepseek" | "system" | "lmstudio" | "gemini" | "openrouter" | "mistral">("system");
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState<"thinking" | "coding" | "basic">("basic");
  const [codingSubmode, setCodingSubmode] = useState<"full" | "language_only" | "direct">("full");
  const [savingLlm, setSavingLlm] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const state = urlParams.get("state");
    if (code || state) {
      storeGoogle()
        .then(() => {
          toast.success("Google connected, Sir.");
          refetchAccounts();
          window.history.replaceState({}, "", window.location.pathname);
        })
        .catch((e: any) => {
          toast.error(e.message || "Failed to save connection.");
        });
    }
  }, []);

  useEffect(() => {
    if (llmConfig) {
      setProvider(llmConfig.provider as typeof provider);
      setApiKey(llmConfig.apiKey || "");
      setMode((llmConfig.mode as "thinking" | "coding" | "basic") || "basic");
      setCodingSubmode((llmConfig.coding_submode as "full" | "language_only" | "direct") || "full");
    }
  }, [llmConfig]);

  useEffect(() => {
    if (provider === "groq" && !apiKey) {
      setApiKey(DEFAULT_GROQ_KEY);
    }
  }, [provider, apiKey]);

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
      if (result.redirected) return;
      await storeGoogle();
      toast.success("Google connected, Sir.");
      refetchAccounts();
    } catch (err: any) {
      toast.error(err.message || "Failed to connect Google");
    } finally {
      setConnecting(false);
    }
  }

  async function saveLlm() {
    setSavingLlm(true);
    try {
      const keyToSend = provider === "groq" && !apiKey ? undefined : apiKey || undefined;
      await updateConfig({
        data: {
          provider,
          apiKey: keyToSend,
          mode,
          coding_submode: mode === "coding" ? codingSubmode : undefined,
        },
      });
      await refetch();
      toast.success("AI settings updated");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update");
    } finally {
      setSavingLlm(false);
    }
  }

  const [tab, setTab] = useState<"general" | "appearance" | "libraries" | "diagnostics">("general");

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag="04 · SETTINGS"
        title="Configuration"
        subtitle="How JARVIS knows you and the channels you've connected."
      />
      <div className="px-8 pt-4 flex gap-1 border-b border-arc/10">
        {(["general", "appearance", "libraries", "diagnostics"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-[0.2em] rounded-t transition ${
              tab === t
                ? "bg-arc/10 text-arc border-b-2 border-arc"
                : "text-hud-dim hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 max-w-4xl">
        {tab === "diagnostics" ? <DiagnosticsTab /> : tab === "appearance" ? <ThemeCustomizer /> : tab === "libraries" ? <LibraryManager /> : (<>

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
                <option value="gemini">Google Gemini</option>
                <option value="groq">Groq</option>
                <option value="deepseek">DeepSeek</option>
                <option value="lmstudio">LM Studio (local)</option>
                <option value="openrouter">OpenRouter</option>
                <option value="mistral">Mistral AI</option>
              </select>

            </div>
            {provider !== "system" && (
              <div className="flex flex-wrap items-center gap-4">
                <label className="text-sm font-medium">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    provider === "groq"
                      ? "Default key is pre‑filled – replace with your own"
                      : provider === "gemini"
                        ? "Enter your Google AI API key"
                        : provider === "openrouter"
                          ? "sk-or-v1-…"
                          : "Enter your API key"
                  }

                  className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none w-64"
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <label className="text-sm font-medium">AI Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
              >
                <option value="basic">🗣️ Basic – Everyday chat</option>
                <option value="thinking">🧠 Thinking – Deep reasoning</option>
                <option value="coding">💻 Coding – Technical help</option>
              </select>
            </div>

            {/* Coding Submode – shown only when mode is "coding" */}
            {mode === "coding" && (
              <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-arc/20">
                <label className="text-sm font-medium">Coding Sub‑mode</label>
                <div className="flex gap-1 bg-background/40 border border-arc/20 rounded-md p-1">
                  {[
                    { value: "full", label: "🧠 Full Workflow", desc: "Ask language + environment" },
                    { value: "language_only", label: "💬 Language Only", desc: "Ask language only" },
                    { value: "direct", label: "⚡ Direct", desc: "Write code immediately" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setCodingSubmode(opt.value as any)}
                      className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded transition ${
                        codingSubmode === opt.value
                          ? "bg-arc text-arc-foreground"
                          : "text-hud-dim hover:text-foreground hover:bg-arc/10"
                      }`}
                      title={opt.desc}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
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
              {provider === "groq" && (
                <span className="block mt-1 text-arc/70">
                  💡 A default Groq key is pre‑filled. You can use it or replace it with your own.
                </span>
              )}
              {provider === "gemini" && (
                <span className="block mt-1 text-arc/70">
                  💡 Get your free API key from{" "}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Google AI Studio
                  </a>
                  . Default model: <span className="font-mono">gemini-1.5-flash</span>.
                </span>
              )}
              {provider === "openrouter" && (
                <span className="block mt-1 text-arc/70">
                  💡 Get a key at{" "}
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline">
                    openrouter.ai/keys
                  </a>
                  . Default model: <span className="font-mono">deepseek/deepseek-chat</span>. Change via{" "}
                  <span className="font-mono">OPENROUTER_MODEL</span> env, or pick any model slug from OpenRouter.
                </span>
              )}
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
        </>)}
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
