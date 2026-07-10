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
import { applyThemeOverrides, readThemeOverrides, writeThemeOverrides, resetTheme } from "@/lib/theme";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCustomTabs } from "@/lib/custom-tabs.functions";
import { JarvisOrb } from "./JarvisOrb";
import { appBus, type AppAction } from "@/lib/mapBus";
import { toast } from "sonner";
import { PageCustomLayer, PageCustomizerButton, PageCustomizerDialog } from "./PageCustomizer";
import { upsertPageCustomization, deletePageCustomization } from "@/lib/page-customizations.functions";
import { routeKeyFromPath } from "@/lib/route-key";

const NAV = [
  { to: "/dashboard", label: "Command", icon: LayoutDashboard, tag: "00" },
  { to: "/chat", label: "Chat", icon: MessageSquare, tag: "01" },
  { to: "/time", label: "Time & Tasks", icon: Clock, tag: "02" },
  { to: "/vault", label: "Vault", icon: KeyRound, tag: "03" },
  
  { to: "/analyzer", label: "Analyzer", icon: Activity, tag: "13" },
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
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [customizerRouteKey, setCustomizerRouteKey] = useState<string | undefined>(undefined);
  const upsertCustomFn = useServerFn(upsertPageCustomization);
  const deleteCustomFn = useServerFn(deletePageCustomization);

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

  // Global JARVIS client-action bus (navigate, toast, theme, reload…)
  useEffect(() => {
    return appBus.register((a: AppAction) => {
      try {
        switch (a.type) {
          case "navigate":
            navigate({ to: a.to as any, replace: a.replace });
            break;
          case "reload":
            window.location.reload();
            break;
          case "open_url":
            if (a.new_tab === false) window.location.href = a.url;
            else window.open(a.url, "_blank", "noopener");
            break;
          case "toast": {
            const k = a.kind ?? "info";
            (toast as any)[k]?.(a.message) ?? toast(a.message);
            break;
          }
          case "set_theme": {
            const root = document.documentElement;
            root.classList.remove("light", "dark");
            if (a.theme !== "system") root.classList.add(a.theme);
            try { localStorage.setItem("theme", a.theme); } catch {}
            break;
          }
          case "scroll_to": {
            const el = document.querySelector(a.selector);
            if (el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
            break;
          }
          case "focus_chat": {
            const ta = document.querySelector<HTMLTextAreaElement>("textarea");
            ta?.focus();
            break;
          }
          case "copy_to_clipboard":
            navigator.clipboard?.writeText(a.text).then(
              () => toast.success(a.label ? `Copied ${a.label}` : "Copied to clipboard"),
              () => toast.error("Clipboard copy failed"),
            );
            break;
          case "invalidate_queries":
            if (a.keys && a.keys.length) a.keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
            else qc.invalidateQueries();
            break;
          case "start_timer": {
            const secs = Math.max(1, Math.min(24 * 60 * 60, Math.round(a.seconds)));
            const label = a.label || `${secs}s timer`;
            toast.info(`Timer set: ${label} (${secs}s)`);
            setTimeout(() => {
              toast.success(`⏰ ${label} done, Sir.`);
              if (a.sound !== false) {
                try {
                  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
                  const ctx = new AC();
                  const o = ctx.createOscillator();
                  const g = ctx.createGain();
                  o.type = "sine"; o.frequency.value = 880;
                  o.connect(g); g.connect(ctx.destination);
                  g.gain.setValueAtTime(0.001, ctx.currentTime);
                  g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
                  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
                  o.start(); o.stop(ctx.currentTime + 0.6);
                } catch {}
              }
            }, secs * 1000);
            break;
          }
          case "speak": {
            try {
              const u = new SpeechSynthesisUtterance(a.text);
              if (a.voice) {
                const v = speechSynthesis.getVoices().find((x) => x.name.includes(a.voice!));
                if (v) u.voice = v;
              }
              speechSynthesis.speak(u);
            } catch {}
            break;
          }
          case "apply_theme_tokens": {
            const base = a.merge === false ? {} : readThemeOverrides();
            const next = { ...base, ...a.tokens };
            writeThemeOverrides(next);
            applyThemeOverrides(next);
            break;
          }
          case "reset_theme": {
            resetTheme();
            applyThemeOverrides({});
            break;
          }
          case "click": {
            const el = document.querySelector(a.selector) as HTMLElement | null;
            el?.click();
            break;
          }
          case "set_input_value": {
            const el = document.querySelector(a.selector) as HTMLInputElement | HTMLTextAreaElement | null;
            if (el) {
              const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
              setter?.call(el, a.value);
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
            break;
          }
          case "set_local_storage":
            try { localStorage.setItem(a.key, a.value); } catch {}
            break;
          case "remove_local_storage":
            try { localStorage.removeItem(a.key); } catch {}
            break;
          case "set_document_title":
            document.title = a.title;
            break;
          case "add_class": {
            const el = document.querySelector(a.selector);
            if (el) el.classList.add(a.className);
            break;
          }
          case "remove_class": {
            const el = document.querySelector(a.selector);
            if (el) el.classList.remove(a.className);
            break;
          }
        }
      } catch (e) {
        console.error("[appBus]", e);
      }
    });
  }, [navigate, qc]);

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
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-arc/15 bg-background/40 backdrop-blur-xl flex-col h-screen sticky top-0">
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
