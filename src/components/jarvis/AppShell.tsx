import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ReactNode, useEffect, useState } from "react";
import { LayoutDashboard, Clock, Globe, Activity, Settings, LogOut, MessageSquare, KeyRound, Wallet, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { JarvisOrb } from "./JarvisOrb";

const NAV = [
  { to: "/dashboard", label: "Command", icon: LayoutDashboard, tag: "00" },
  { to: "/chat", label: "Chat", icon: MessageSquare, tag: "01" },
  { to: "/time", label: "Time", icon: Clock, tag: "02" },
  { to: "/vault", label: "Vault", icon: KeyRound, tag: "03" },
  { to: "/spending", label: "Spending", icon: Wallet, tag: "04" },
  { to: "/briefing", label: "Briefing", icon: Bell, tag: "05" },
  { to: "/world", label: "World", icon: Globe, tag: "06" },
  { to: "/pulse", label: "Pulse", icon: Activity, tag: "07" },
  { to: "/settings", label: "Settings", icon: Settings, tag: "08" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex bg-background grid-bg">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-arc/15 bg-background/40 backdrop-blur-xl flex flex-col">
        <div className="px-5 py-6 flex items-center gap-3 border-b border-arc/10">
          <div className="relative">
            <JarvisOrb size={42} />
          </div>
          <div>
            <div className="font-display text-lg leading-none">JARVIS</div>
            <div className="font-mono text-[9px] tracking-[0.3em] text-arc">COMMAND</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => {
            const active = loc.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-md transition relative ${
                  active
                    ? "bg-arc/15 text-arc shadow-arc"
                    : "text-muted-foreground hover:text-foreground hover:bg-arc/5"
                }`}
              >
                <span className="font-mono text-[10px] text-arc/60 w-5">{item.tag}</span>
                <Icon size={16} />
                <span className="text-sm font-medium">{item.label}</span>
                {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-arc rounded-r animate-hud-pulse" />}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-arc/10 space-y-2">
          <div className="font-mono text-[10px] text-hud-dim">SYSTEM TIME</div>
          <div className="font-mono text-sm text-arc text-glow">{time.toLocaleTimeString()}</div>
          <div className="font-mono text-[10px] text-hud-dim">{time.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
          <button
            onClick={signOut}
            className="mt-3 w-full flex items-center gap-2 text-xs text-hud-dim hover:text-critical transition"
          >
            <LogOut size={12} /> Disconnect
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
