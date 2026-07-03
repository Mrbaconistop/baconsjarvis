import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ReactNode, useEffect, useState } from "react";
import * as LucideIcons from "lucide-react";
import {
  LayoutDashboard,
  Clock,
  Globe,
  Activity,
  Settings,
  LogOut,
  MessageSquare,
  KeyRound,
  DollarSign,
  Bell,
  Map as MapIcon,
  GraduationCap,
  Menu,
  X,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCustomTabs } from "@/lib/custom-tabs.functions";
import { JarvisOrb } from "./JarvisOrb";
import { appBus, type AppAction } from "@/lib/mapBus";
import { toast } from "sonner";

const NAV = [
  { to: "/dashboard", label: "Command", icon: LayoutDashboard, tag: "00" },
  { to: "/chat", label: "Chat", icon: MessageSquare, tag: "01" },
  { to: "/time", label: "Time & Tasks", icon: Clock, tag: "02" },
  { to: "/vault", label: "Vault", icon: KeyRound, tag: "03" },
  { to: "/spending", label: "Portfolio", icon: DollarSign, tag: "04" },
  { to: "/briefing", label: "Briefing", icon: Bell, tag: "05" },
  { to: "/map", label: "Map", icon: MapIcon, tag: "09" },
  { to: "/world", label: "World", icon: Globe, tag: "06" },
  { to: "/pulse", label: "Pulse", icon: Activity, tag: "07" },
  { to: "/backend", label: "Backend", icon: Activity, tag: "10" },
  { to: "/lab", label: "Lab", icon: GraduationCap, tag: "12" },
  { to: "/settings", label: "Settings", icon: Settings, tag: "08" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [time, setTime] = useState(() => new Date());
  const [navOpen, setNavOpen] = useState(false);

  // Custom tabs (created by JARVIS or via /tabs/$slug edit)
  const fetchTabs = useServerFn(listCustomTabs);
  const { data: customTabs = [] } = useQuery({
    queryKey: ["custom-tabs-nav"],
    queryFn: () => fetchTabs(),
    staleTime: 30_000,
  });
  useEffect(() => {
    const ch = supabase
      .channel("custom_tabs_nav")
      .on("postgres_changes", { event: "*", schema: "public", table: "custom_tabs" }, () => {
        qc.invalidateQueries({ queryKey: ["custom-tabs-nav"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Close drawer on route change
  useEffect(() => {
    setNavOpen(false);
  }, [loc.pathname]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const activeItem = NAV.find((n) => loc.pathname.startsWith(n.to));

  const SidebarBody = (
    <>
      <div className="px-5 py-5 flex items-center gap-3 border-b border-arc/10">
        <div className="relative">
          <JarvisOrb size={42} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg leading-none">JARVIS</div>
          <div className="font-mono text-[9px] tracking-[0.3em] text-arc">COMMAND</div>
        </div>
        <button
          onClick={() => setNavOpen(false)}
          className="lg:hidden p-2 -mr-2 text-hud-dim hover:text-arc"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
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

        {customTabs.length > 0 && (
          <div className="pt-4 mt-2 border-t border-arc/10">
            <div className="px-3 pb-2 font-mono text-[9px] tracking-[0.3em] text-arc/60">CUSTOM</div>
            {customTabs.map((t: any, i: number) => {
              const to = `/tabs/${t.slug}`;
              const active = loc.pathname === to;
              const IconComp =
                (LucideIcons as any)[t.icon] && typeof (LucideIcons as any)[t.icon] === "function"
                  ? (LucideIcons as any)[t.icon]
                  : Sparkles;
              return (
                <Link
                  key={t.id}
                  to="/tabs/$slug"
                  params={{ slug: t.slug }}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-md transition relative ${
                    active
                      ? "bg-arc/15 text-arc shadow-arc"
                      : "text-muted-foreground hover:text-foreground hover:bg-arc/5"
                  }`}
                >
                  <span className="font-mono text-[10px] text-arc/60 w-5">C{String(i + 1).padStart(2, "0")}</span>
                  <IconComp size={16} />
                  <span className="text-sm font-medium truncate">{t.label}</span>
                  {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-arc rounded-r animate-hud-pulse" />}
                </Link>
              );
            })}
          </div>
        )}
      </nav>

      <div className="px-5 py-4 border-t border-arc/10 space-y-2">
        <div className="font-mono text-[10px] text-hud-dim">SYSTEM TIME</div>
        <div className="font-mono text-sm text-arc text-glow" suppressHydrationWarning>
          {time.toLocaleTimeString()}
        </div>
        <div className="font-mono text-[10px] text-hud-dim" suppressHydrationWarning>
          {time.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
        </div>
        <a
          href="https://baconanalyzer.lovable.app"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block text-xs text-hud-dim hover:text-arc transition"
        >
          📊 Check out Bacon's stock analyzer!
        </a>
        <button
          onClick={signOut}
          className="mt-3 w-full flex items-center gap-2 text-xs text-hud-dim hover:text-critical transition"
        >
          <LogOut size={12} /> Disconnect
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background grid-bg">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-arc/15 bg-background/40 backdrop-blur-xl flex-col">
        {SidebarBody}
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setNavOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] border-r border-arc/20 bg-background/95 backdrop-blur-xl flex flex-col animate-in slide-in-from-left duration-200">
            {SidebarBody}
          </aside>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-3 py-2.5 border-b border-arc/15 bg-background/60 backdrop-blur sticky top-0 z-30">
          <button
            onClick={() => setNavOpen(true)}
            className="p-2 -ml-1 rounded-md hover:bg-arc/10 text-arc"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <JarvisOrb size={26} />
          <div className="flex-1 min-w-0">
            <div className="font-display text-sm leading-none truncate">
              {activeItem?.label ?? "JARVIS"}
            </div>
            <div className="font-mono text-[9px] tracking-[0.25em] text-arc/70" suppressHydrationWarning>
              {time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </div>
          </div>
        </div>
        <div className="flex-1 min-w-0">{children}</div>
      </main>
    </div>
  );
}
