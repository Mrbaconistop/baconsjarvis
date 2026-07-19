import { useEffect, useState } from "react";
import { Settings, Loader2, RotateCcw, Swords } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  getAnalyzerPrefs,
  setAnalyzerPrefs,
  DEFAULT_ANALYZER_PREFS,
  type AnalyzerPrefs,
} from "@/lib/analyzer-prefs.functions";

const LS_KEY = "analyzer_prefs_v1";

export function loadPrefsLocal(): AnalyzerPrefs {
  if (typeof window === "undefined") return DEFAULT_ANALYZER_PREFS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_ANALYZER_PREFS;
    return { ...DEFAULT_ANALYZER_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_ANALYZER_PREFS;
  }
}

export function savePrefsLocal(p: AnalyzerPrefs) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

type IndKey = keyof AnalyzerPrefs["indicators"];
const INDICATORS: { key: IndKey; label: string; hasPeriod: boolean; min?: number; max?: number }[] = [
  { key: "sma", label: "SMA", hasPeriod: true, min: 3, max: 200 },
  { key: "ema", label: "EMA", hasPeriod: true, min: 3, max: 200 },
  { key: "rsi", label: "RSI", hasPeriod: true, min: 3, max: 60 },
  { key: "macd", label: "MACD", hasPeriod: false },
  { key: "bollinger", label: "Bollinger", hasPeriod: true, min: 5, max: 60 },
  { key: "vwap", label: "VWAP", hasPeriod: false },
  { key: "fibonacci", label: "Fibonacci", hasPeriod: false },
];

interface Props {
  prefs: AnalyzerPrefs;
  onChange: (p: AnalyzerPrefs) => void;
  title?: string;
}

export function AnalyzerSettingsButton({ prefs, onChange, title = "Analyzer Settings" }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [local, setLocal] = useState<AnalyzerPrefs>(prefs);
  const getFn = useServerFn(getAnalyzerPrefs);
  const setFn = useServerFn(setAnalyzerPrefs);

  useEffect(() => { setLocal(prefs); }, [prefs]);

  // Hydrate from server on open
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getFn()
      .then((server) => {
        const merged = { ...DEFAULT_ANALYZER_PREFS, ...server };
        setLocal(merged);
        savePrefsLocal(merged);
        onChange(merged);
      })
      .catch(() => { /* offline / anon — keep local */ })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const apply = (next: AnalyzerPrefs) => {
    setLocal(next);
    savePrefsLocal(next);
    onChange(next);
  };

  const patchInd = (k: IndKey, patch: Partial<{ enabled: boolean; period: number }>) => {
    const cur = local.indicators[k] ?? { enabled: false };
    apply({ ...local, indicators: { ...local.indicators, [k]: { ...cur, ...patch } } });
  };

  const save = async () => {
    setSaving(true);
    try {
      await setFn({ data: local });
      toast.success("Analyzer settings saved");
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => apply(DEFAULT_ANALYZER_PREFS);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          title={title}
        >
          <Settings size={14} />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings size={16} /> {title}
            {loading && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-6 py-4">
          {/* Indicators */}
          <section>
            <div className="font-mono text-[10px] tracking-widest text-arc/70 uppercase mb-2">Indicators</div>
            <div className="space-y-2">
              {INDICATORS.map(({ key, label, hasPeriod, min = 3, max = 200 }) => {
                const ind = local.indicators[key] ?? { enabled: false, period: 14 };
                return (
                  <div key={key} className="flex items-center gap-3 text-sm">
                    <Switch
                      checked={!!ind.enabled}
                      onCheckedChange={(v) => patchInd(key, { enabled: v })}
                    />
                    <span className="w-20 font-mono text-xs">{label}</span>
                    {hasPeriod && (
                      <Input
                        type="number"
                        min={min}
                        max={max}
                        value={ind.period ?? 14}
                        onChange={(e) => patchInd(key, { period: Math.max(min, Math.min(max, Number(e.target.value) || 14)) })}
                        className="h-7 w-20 font-mono text-xs"
                        disabled={!ind.enabled}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Sensitivity */}
          <section>
            <div className="font-mono text-[10px] tracking-widest text-arc/70 uppercase mb-2">
              Pattern Sensitivity · {local.sensitivity}
            </div>
            <Slider
              value={[local.sensitivity]}
              min={0}
              max={100}
              step={1}
              onValueChange={([v]) => apply({ ...local, sensitivity: v })}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Higher = detect subtler patterns (more signals, more noise). Lower = only strong, clean patterns.
            </p>
          </section>

          {/* Lookback */}
          <section>
            <div className="font-mono text-[10px] tracking-widest text-arc/70 uppercase mb-2">Lookback</div>
            <div className="grid grid-cols-5 gap-1">
              {(["1m", "3m", "6m", "1y", "5y"] as const).map((lb) => (
                <Button
                  key={lb}
                  size="sm"
                  variant={local.lookback === lb ? "default" : "outline"}
                  onClick={() => apply({ ...local, lookback: lb })}
                  className="h-7 text-xs"
                >
                  {lb}
                </Button>
              ))}
            </div>
          </section>

          {/* News sentiment */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-[10px] tracking-widest text-arc/70 uppercase">News Sentiment</div>
              <Switch
                checked={local.sentimentEnabled}
                onCheckedChange={(v) => apply({ ...local, sentimentEnabled: v })}
              />
            </div>
            <div className={local.sentimentEnabled ? "" : "opacity-50 pointer-events-none"}>
              <div className="text-[10px] text-muted-foreground mb-1">
                Weight · {local.sentimentWeight}%
              </div>
              <Slider
                value={[local.sentimentWeight]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) => apply({ ...local, sentimentWeight: v })}
              />
            </div>
          </section>

          {/* War Mode */}
          <section className={local.warMode ? "rounded border border-critical/40 bg-critical/5 p-3" : ""}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Swords size={14} className={local.warMode ? "text-critical" : "text-muted-foreground"} />
                <div className="font-mono text-[10px] tracking-widest uppercase">
                  War Mode
                </div>
              </div>
              <Switch
                checked={local.warMode}
                onCheckedChange={(v) => apply({ ...local, warMode: v })}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Boosts sentiment weight ×1.5, flags defense / energy / commodity tickers, and
              tightens stop-loss risk parameters in backtests.
            </p>
          </section>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-arc/10">
            <Button onClick={save} disabled={saving} size="sm" className="flex-1">
              {saving ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
              Save
            </Button>
            <Button onClick={reset} variant="outline" size="sm">
              <RotateCcw size={12} className="mr-1" /> Reset
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
