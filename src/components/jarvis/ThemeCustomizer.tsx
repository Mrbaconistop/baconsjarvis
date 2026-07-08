import { useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Palette, Bell, BellOff } from "lucide-react";
import {
  THEME_TOKENS,
  THEME_PRESETS,
  useTheme,
  type ThemeOverrides,
} from "@/lib/theme";
import { notifPermission, requestNotifPermission } from "@/lib/browser-notifications";

/** Convert an OKLCH string like "oklch(0.82 0.16 210)" to an approx hex for <input type=color>. */
function tokenValueForPicker(current: string | undefined, fallback: string): string {
  if (!current) return fallback;
  if (current.startsWith("#")) return current.slice(0, 7);
  // input[type=color] only handles hex, so we round-trip via a temp element.
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("div");
  probe.style.color = current;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const m = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return fallback;
  const [, r, g, b] = m;
  return "#" + [r, g, b].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

export function ThemeCustomizer() {
  const { overrides, setToken, reset, setAll } = useTheme();
  const [permState, setPermState] = useState(notifPermission());

  function applyPreset(overrides: ThemeOverrides, label: string) {
    setAll(overrides);
    toast.success(`Theme: ${label}`);
  }

  async function enableNotifs() {
    const r = await requestNotifPermission();
    setPermState(r);
    if (r === "granted") toast.success("Notifications enabled");
    else if (r === "denied") toast.error("Notifications blocked in browser settings");
    else if (r === "unsupported") toast.error("Not supported in this browser");
  }

  const groups: Record<string, typeof THEME_TOKENS[number][]> = { surface: [], brand: [], status: [] };
  THEME_TOKENS.forEach((t) => groups[t.group].push(t));

  return (
    <section className="glass-strong hud-corners rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] tracking-[0.3em] text-arc flex items-center gap-2">
          <Palette size={12} /> APPEARANCE
        </div>
        <button
          onClick={() => { reset(); toast.success("Theme reset"); }}
          className="text-xs px-3 py-1.5 rounded-md border border-arc/30 hover:bg-arc/10 flex items-center gap-1.5"
        >
          <RotateCcw size={12} /> Reset
        </button>
      </div>

      {/* Presets */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-hud-dim mb-2">Presets</div>
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.overrides, p.label)}
              className="text-xs px-3 py-1.5 rounded-md border border-arc/25 bg-background/40 hover:bg-arc/10 transition"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Per-token editors */}
      {(["brand", "surface", "status"] as const).map((group) => (
        <div key={group}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-hud-dim mb-2">{group}</div>
          <div className="grid grid-cols-2 gap-2">
            {groups[group].map((t) => {
              const value = overrides[t.key];
              return (
                <label key={t.key} className="flex items-center gap-2 p-2 rounded-md bg-background/40 border border-arc/10 text-xs">
                  <input
                    type="color"
                    value={tokenValueForPicker(value, "#00c8ff")}
                    onChange={(e) => setToken(t.key, e.target.value)}
                    className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                    title={`--${t.key}`}
                  />
                  <span className="flex-1">{t.label}</span>
                  <span className="font-mono text-[9px] text-hud-dim truncate max-w-[80px]" title={value}>
                    {value ?? "default"}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {/* Notifications */}
      <div className="pt-4 border-t border-arc/10">
        <div className="text-[10px] font-mono uppercase tracking-wider text-hud-dim mb-2">Notifications</div>
        <div className="flex items-center gap-3">
          {permState === "granted" ? (
            <div className="flex items-center gap-2 text-xs text-success">
              <Bell size={14} /> Browser notifications enabled
            </div>
          ) : (
            <button
              onClick={enableNotifs}
              disabled={permState === "denied" || permState === "unsupported"}
              className="text-xs px-3 py-1.5 rounded-md border border-arc/30 bg-arc/10 hover:bg-arc/20 disabled:opacity-40 flex items-center gap-1.5"
            >
              {permState === "denied" ? <BellOff size={12} /> : <Bell size={12} />}
              {permState === "denied"
                ? "Blocked (change in browser settings)"
                : permState === "unsupported"
                  ? "Not supported"
                  : "Enable browser notifications"}
            </button>
          )}
        </div>
        <p className="mt-2 text-[10px] text-hud-dim">
          High + critical notifications appear as OS notifications; all levels show in-app toasts.
        </p>
      </div>
    </section>
  );
}
