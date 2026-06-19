import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { ParticleField } from "@/components/jarvis/ParticleField";
import { JarvisOrb } from "@/components/jarvis/JarvisOrb";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [{ title: "Sign in — JARVIS" }, { name: "description", content: "Access your JARVIS command center." }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "sign_up") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin + "/dashboard" },
        });
        if (error) throw error;
        toast.success("Welcome aboard, Sir.");
        navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back, Sir.");
        navigate({ to: "/dashboard" });
      }
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center grid-bg overflow-hidden p-6">
      <ParticleField />
      <div className="absolute top-20 -z-0 opacity-40"><JarvisOrb size={520} /></div>
      <div className="glass-strong hud-corners rounded-2xl w-full max-w-md p-8 relative z-10">
        <div className="text-center mb-6">
          <div className="font-mono text-[10px] tracking-[0.4em] text-arc">[ AUTHENTICATION ]</div>
          <h1 className="font-display text-3xl mt-2 text-glow">Identify yourself, Sir</h1>
          <p className="mt-2 text-xs text-hud-dim">Email & docs can be connected later from Settings.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email" required placeholder="email@domain.com" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md bg-background/50 border border-arc/20 px-3 py-2.5 font-mono text-sm focus:border-arc focus:outline-none transition"
          />
          <input
            type="password" required minLength={6} placeholder="password (6+ chars)" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md bg-background/50 border border-arc/20 px-3 py-2.5 font-mono text-sm focus:border-arc focus:outline-none transition"
          />
          <button
            type="submit" disabled={loading}
            className="w-full rounded-md bg-arc py-2.5 font-medium text-arc-foreground shadow-arc hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? "Initialising…" : mode === "sign_in" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3 text-[10px] font-mono text-hud-dim">
          <div className="h-px flex-1 bg-arc/20" /> OR <div className="h-px flex-1 bg-arc/20" />
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            try {
              const result = await lovable.auth.signInWithOAuth("google", {
                redirect_uri: window.location.origin + "/dashboard",
              });
              if (result.error) throw new Error(result.error.message ?? "Google sign-in failed");
              if (result.redirected) return;
              navigate({ to: "/dashboard" });
            } catch (err: any) {
              toast.error(err.message ?? "Google sign-in failed");
              setLoading(false);
            }
          }}
          className="w-full flex items-center justify-center gap-2 rounded-md bg-background/60 border border-arc/30 py-2.5 text-sm hover:border-arc transition disabled:opacity-50"
        >
          <GoogleMark /> Continue with Google
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === "sign_in" ? "sign_up" : "sign_in")}
          className="mt-4 w-full text-center text-xs text-hud-dim hover:text-arc transition"
        >
          {mode === "sign_in" ? "No account yet? Create one." : "Already have an account? Sign in."}
        </button>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.1 4 9.3 8.4 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.2 39.6 16 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.7l6.2 5.2C41.2 35.5 44 30.2 44 24c0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}
