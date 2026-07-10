import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getPageCustomization,
  upsertPageCustomization,
  deletePageCustomization,
} from "@/lib/page-customizations.functions";
import { routeKeyFromPath } from "@/lib/route-key";
import { Paintbrush, Save, Trash2, X, Eye, EyeOff, Sparkles } from "lucide-react";
import { toast } from "sonner";

type Position = "top" | "bottom" | "floating" | "replace";

// ---- Live overlay renderer ----------------------------------------------
export function PageCustomLayer() {
  const loc = useLocation();
  const routeKey = routeKeyFromPath(loc.pathname);
  const fetchOne = useServerFn(getPageCustomization);
  const { data: row } = useQuery({
    queryKey: ["page-custom", routeKey],
    queryFn: () => fetchOne({ data: { route_key: routeKey } }),
    staleTime: 15_000,
  });

  const htmlContainerRef = useRef<HTMLDivElement | null>(null);
  const scriptCleanupRef = useRef<(() => void) | null>(null);

  // Inject CSS via <style> tag scoped by data attribute
  useEffect(() => {
    const styleId = `pc-style-${routeKey.replace(/[^a-z0-9-]/gi, "_")}`;
    let el = document.getElementById(styleId) as HTMLStyleElement | null;
    const css = row?.enabled && row?.css ? row.css : "";
    if (css) {
      if (!el) {
        el = document.createElement("style");
        el.id = styleId;
        document.head.appendChild(el);
      }
      el.textContent = css;
    } else if (el) {
      el.remove();
    }
    return () => { el?.remove(); };
  }, [row?.css, row?.enabled, routeKey]);

  // Run JS in a sandboxed function scope, provide cleanup hook
  useEffect(() => {
    scriptCleanupRef.current?.();
    scriptCleanupRef.current = null;
    if (!row?.enabled || !row?.js) return;
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        "container",
        "route",
        `"use strict"; let __cleanup=null; const onCleanup=(f)=>{__cleanup=f}; ${row.js}\nreturn __cleanup;`,
      );
      const cleanup = fn(htmlContainerRef.current, routeKey);
      if (typeof cleanup === "function") scriptCleanupRef.current = cleanup;
    } catch (e) {
      console.warn("[PageCustomLayer:js]", e);
    }
    return () => {
      try { scriptCleanupRef.current?.(); } catch {}
      scriptCleanupRef.current = null;
    };
  }, [row?.js, row?.enabled, routeKey]);

  if (!row?.enabled) return null;
  const html = row.html || "";
  const pos = (row.position || "bottom") as Position;

  if (!html && !row.js) return null;

  const containerCls =
    pos === "floating"
      ? "fixed bottom-4 right-4 z-40 max-w-md pointer-events-auto"
      : pos === "top"
      ? "border-b border-arc/20 bg-background/60 backdrop-blur"
      : pos === "replace"
      ? "fixed inset-0 z-40 overflow-auto bg-background"
      : "border-t border-arc/20 bg-background/60 backdrop-blur";

  return (
    <div className={containerCls} data-page-custom={routeKey}>
      <div
        ref={htmlContainerRef}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// ---- Editor dialog -------------------------------------------------------
export function PageCustomizerDialog({
  open,
  onClose,
  routeKey: forcedKey,
}: {
  open: boolean;
  onClose: () => void;
  routeKey?: string;
}) {
  const loc = useLocation();
  const qc = useQueryClient();
  const routeKey = forcedKey ?? routeKeyFromPath(loc.pathname);
  const fetchOne = useServerFn(getPageCustomization);
  const upsert = useServerFn(upsertPageCustomization);
  const del = useServerFn(deletePageCustomization);

  const { data: row, isLoading } = useQuery({
    queryKey: ["page-custom", routeKey],
    queryFn: () => fetchOne({ data: { route_key: routeKey } }),
    enabled: open,
  });

  const [tab, setTab] = useState<"css" | "js" | "html">("css");
  const [css, setCss] = useState("");
  const [js, setJs] = useState("");
  const [html, setHtml] = useState("");
  const [position, setPosition] = useState<Position>("bottom");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCss(row?.css ?? "");
    setJs(row?.js ?? "");
    setHtml(row?.html ?? "");
    setPosition((row?.position as Position) ?? "bottom");
    setEnabled(row?.enabled ?? true);
  }, [open, row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    try {
      await upsert({ data: { route_key: routeKey, css, js, html, position, enabled } });
      await qc.invalidateQueries({ queryKey: ["page-custom", routeKey] });
      toast.success(`Saved customization for /${routeKey}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete all customizations for /${routeKey}?`)) return;
    try {
      await del({ data: { route_key: routeKey } });
      await qc.invalidateQueries({ queryKey: ["page-custom", routeKey] });
      toast.success("Customization removed");
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl h-[80vh] rounded-lg border border-arc/30 bg-background flex flex-col overflow-hidden shadow-arc">
        <div className="flex items-center justify-between px-4 py-3 border-b border-arc/20">
          <div className="flex items-center gap-2">
            <Paintbrush size={16} className="text-arc" />
            <div className="font-display text-sm">Customize</div>
            <code className="font-mono text-xs text-arc/80 bg-arc/10 px-2 py-0.5 rounded">/{routeKey}</code>
          </div>
          <button onClick={onClose} className="p-1 hover:text-arc"><X size={16} /></button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-arc/10 flex-wrap text-xs">
          <button
            onClick={() => setEnabled(v => !v)}
            className={`px-2 py-1 rounded border ${enabled ? "border-arc/40 text-arc" : "border-hud-dim/30 text-hud-dim"}`}
          >
            {enabled ? <><Eye size={12} className="inline mr-1"/>Enabled</> : <><EyeOff size={12} className="inline mr-1"/>Disabled</>}
          </button>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as Position)}
            className="bg-background border border-arc/20 rounded px-2 py-1 text-xs"
          >
            <option value="bottom">Position: bottom</option>
            <option value="top">Position: top</option>
            <option value="floating">Position: floating</option>
            <option value="replace">Position: replace (full page)</option>
          </select>
          <div className="ml-auto flex gap-1">
            {(["css", "js", "html"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-2 py-1 rounded font-mono uppercase ${tab === t ? "bg-arc/20 text-arc" : "text-hud-dim hover:text-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-hud-dim text-sm">Loading…</div>
          ) : tab === "css" ? (
            <textarea
              value={css}
              onChange={(e) => setCss(e.target.value)}
              spellCheck={false}
              placeholder="/* Any CSS here overrides this page. Use selectors freely. */"
              className="w-full h-full p-3 bg-black/40 text-arc font-mono text-xs resize-none outline-none"
            />
          ) : tab === "js" ? (
            <textarea
              value={js}
              onChange={(e) => setJs(e.target.value)}
              spellCheck={false}
              placeholder={`// Runs on this route. Locals: container (custom HTML div), route (string).\n// Optional: onCleanup(() => { ... }) to unregister on route change.`}
              className="w-full h-full p-3 bg-black/40 text-arc font-mono text-xs resize-none outline-none"
            />
          ) : (
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              spellCheck={false}
              placeholder="<!-- Injected into a panel on this page. -->"
              className="w-full h-full p-3 bg-black/40 text-arc font-mono text-xs resize-none outline-none"
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-arc/20 bg-background/60">
          <div className="text-[10px] font-mono text-hud-dim">
            <Sparkles size={10} className="inline mr-1 text-arc"/>
            JARVIS can also edit this via <code>set_page_customization</code>.
          </div>
          <div className="flex gap-2">
            <button
              onClick={remove}
              className="px-3 py-1.5 text-xs border border-critical/40 text-critical/80 rounded hover:bg-critical/10"
            >
              <Trash2 size={12} className="inline mr-1" /> Reset
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 text-xs bg-arc/20 border border-arc/40 text-arc rounded hover:bg-arc/30 disabled:opacity-50"
            >
              <Save size={12} className="inline mr-1" /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Floating "Customize this page" button ------------------------------
export function PageCustomizerButton() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const routeKey = useMemo(() => routeKeyFromPath(loc.pathname), [loc.pathname]);

  // Hide on auth/index public pages
  if (routeKey === "auth" || routeKey === "index") return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Customize /${routeKey}`}
        className="fixed bottom-4 right-4 z-30 p-2.5 rounded-full border border-arc/40 bg-background/80 backdrop-blur text-arc hover:bg-arc/15 shadow-arc"
      >
        <Paintbrush size={16} />
      </button>
      <PageCustomizerDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
