// User-controllable theme system. CSS variables live in styles.css; this
// module lets both the user and JARVIS override them at runtime.
//
// Storage: localStorage (per-browser, no round-trip). Applied by injecting a
// <style id="jarvis-theme-overrides"> tag into <head> whose body is
// :root { --token: value; ... }.

import { useCallback, useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "jarvis-theme-overrides";
export const THEME_EVENT = "jarvis-theme-change";
const STYLE_ID = "jarvis-theme-overrides";

/** Every token the user (or JARVIS) can override. Keep these matched to styles.css. */
export const THEME_TOKENS = [
  { key: "background", label: "Background", group: "surface" },
  { key: "foreground", label: "Text", group: "surface" },
  { key: "card", label: "Card surface", group: "surface" },
  { key: "popover", label: "Popover", group: "surface" },
  { key: "muted", label: "Muted", group: "surface" },
  { key: "accent", label: "Accent", group: "surface" },
  { key: "border", label: "Border", group: "surface" },
  { key: "arc", label: "Arc reactor (primary)", group: "brand" },
  { key: "arc-glow", label: "Arc glow", group: "brand" },
  { key: "arc-foreground", label: "Arc text", group: "brand" },
  { key: "primary", label: "Primary", group: "brand" },
  { key: "secondary", label: "Secondary", group: "brand" },
  { key: "critical", label: "Critical", group: "status" },
  { key: "warning", label: "Warning", group: "status" },
  { key: "success", label: "Success", group: "status" },
  { key: "hud", label: "HUD", group: "status" },
  { key: "hud-dim", label: "HUD dim", group: "status" },
] as const;

export type ThemeTokenKey = (typeof THEME_TOKENS)[number]["key"];
export type ThemeOverrides = Partial<Record<ThemeTokenKey | string, string>>;

export function readThemeOverrides(): ThemeOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function serialize(overrides: ThemeOverrides): string {
  const decls = Object.entries(overrides)
    .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join("\n");
  return decls ? `:root, .dark {\n${decls}\n}\n` : "";
}

export function applyThemeOverrides(overrides: ThemeOverrides) {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = serialize(overrides);
}

export function writeThemeOverrides(overrides: ThemeOverrides) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(overrides));
  applyThemeOverrides(overrides);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: overrides }));
}

export function resetTheme() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  applyThemeOverrides({});
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: {} }));
}

/** React hook: current overrides + setter. Reacts to other tabs / JARVIS. */
export function useTheme() {
  const [overrides, setOverrides] = useState<ThemeOverrides>(() => readThemeOverrides());

  useEffect(() => {
    applyThemeOverrides(overrides);
  }, [overrides]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as ThemeOverrides | undefined;
      if (detail) setOverrides(detail);
      else setOverrides(readThemeOverrides());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) setOverrides(readThemeOverrides());
    };
    window.addEventListener(THEME_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setToken = useCallback((key: string, value: string) => {
    setOverrides((prev) => {
      const next = { ...prev, [key]: value };
      writeThemeOverrides(next);
      return next;
    });
  }, []);

  const clearToken = useCallback((key: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      writeThemeOverrides(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setOverrides({});
    resetTheme();
  }, []);

  return { overrides, setToken, clearToken, reset, setAll: (v: ThemeOverrides) => { setOverrides(v); writeThemeOverrides(v); } };
}

/** Named presets JARVIS or the user can apply in one click. */
export const THEME_PRESETS: { id: string; label: string; overrides: ThemeOverrides }[] = [
  {
    id: "default",
    label: "Arc Reactor (default)",
    overrides: {},
  },
  {
    id: "crimson",
    label: "Crimson",
    overrides: {
      background: "oklch(0.13 0.03 25)",
      arc: "oklch(0.72 0.20 25)",
      "arc-glow": "oklch(0.68 0.24 25)",
      "arc-foreground": "oklch(0.10 0.02 25)",
      primary: "oklch(0.72 0.20 25)",
      "primary-foreground": "oklch(0.10 0.02 25)",
    },
  },
  {
    id: "matrix",
    label: "Matrix Green",
    overrides: {
      background: "oklch(0.10 0.02 145)",
      arc: "oklch(0.80 0.20 145)",
      "arc-glow": "oklch(0.75 0.24 145)",
      "arc-foreground": "oklch(0.08 0.02 145)",
      primary: "oklch(0.80 0.20 145)",
      "primary-foreground": "oklch(0.08 0.02 145)",
    },
  },
  {
    id: "amber",
    label: "Amber HUD",
    overrides: {
      background: "oklch(0.12 0.02 60)",
      arc: "oklch(0.82 0.18 75)",
      "arc-glow": "oklch(0.78 0.22 75)",
      "arc-foreground": "oklch(0.10 0.02 60)",
      primary: "oklch(0.82 0.18 75)",
      "primary-foreground": "oklch(0.10 0.02 60)",
    },
  },
  {
    id: "light",
    label: "Daylight",
    overrides: {
      background: "oklch(0.98 0.005 240)",
      foreground: "oklch(0.20 0.02 245)",
      card: "oklch(0.96 0.005 240)",
      popover: "oklch(0.96 0.005 240)",
      muted: "oklch(0.92 0.01 240)",
      "muted-foreground": "oklch(0.40 0.02 240)",
      border: "oklch(0.85 0.01 240)",
    },
  },
];
