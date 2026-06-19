import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { ParticleField } from "@/components/jarvis/ParticleField";
import { JarvisOrb } from "@/components/jarvis/JarvisOrb";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "JARVIS — Your Personal Command Center" },
      { name: "description", content: "Stop drowning in tabs. JARVIS triages your calendar, inbox, and social signals — and tells you what matters next." },
      { property: "og:title", content: "JARVIS — Your Personal Command Center" },
      { property: "og:description", content: "Stop drowning in tabs. JARVIS triages your calendar, inbox, and social signals — and tells you what matters next." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden grid-bg">
      <ParticleField />
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-arc/20 border border-arc flex items-center justify-center shadow-arc">
            <div className="h-3 w-3 rounded-full bg-arc animate-hud-pulse" />
          </div>
          <div>
            <div className="font-display text-lg leading-none">JARVIS</div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-arc">COMMAND CENTER</div>
          </div>
        </div>
        <div className="font-mono text-xs text-hud-dim flex items-center gap-4">
          <span>{time.toLocaleTimeString()}</span>
          <Link to="/auth" className="rounded-md bg-arc px-4 py-2 text-arc-foreground font-medium shadow-arc hover:opacity-90 transition">
            Sign in
          </Link>
        </div>
      </div>

      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-40 pb-16 max-w-4xl mx-auto">
        <div className="font-mono text-xs tracking-[0.4em] text-arc text-glow mb-6">
          [ INTELLIGENT TRIAGE · ACTIVE ]
        </div>
        <h1 className="font-display text-5xl md:text-7xl leading-[1.05] text-glow">
          Your personal <span className="text-arc">command center</span>.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          JARVIS unifies your calendar, inbox, and every social channel into one priority feed —
          ranks what matters, drafts your replies, and respects your time.
        </p>
        <div className="mt-10 flex flex-wrap gap-3 justify-center">
          <Link to="/auth" className="rounded-md bg-arc px-6 py-3 font-medium text-arc-foreground shadow-arc hover:opacity-90 transition">
            Boot the command center
          </Link>
          <a href="#capabilities" className="rounded-md border border-arc/30 px-6 py-3 hover:bg-arc/5 transition">
            See capabilities
          </a>
        </div>

        <div className="mt-20 relative">
          <JarvisOrb size={260} />
        </div>
      </section>

      <section id="capabilities" className="relative z-10 max-w-6xl mx-auto px-6 pb-24 grid md:grid-cols-3 gap-5">
        {[
          { tag: "TIME", title: "Anticipatory reminders", body: "Flight tomorrow? JARVIS knows traffic is heavy and tells you to leave by 06:30. Calendar and Gmail parsed automatically." },
          { tag: "WORLD", title: "Sentiment triage", body: "Every mention scored. Hostile posts surface as Critical with a measured AI-drafted reply ready in one tap." },
          { tag: "PULSE", title: "When to post next", body: "Engagement plotted against your calendar density. JARVIS recommends the three best windows for next week." },
        ].map((c) => (
          <div key={c.tag} className="glass-strong hud-corners rounded-xl p-6">
            <div className="font-mono text-[10px] tracking-[0.3em] text-arc">{c.tag} MODULE</div>
            <h3 className="mt-3 font-display text-xl">{c.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
