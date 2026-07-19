import { useEffect, useState, useCallback } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface OverlayLine {
  id: string;
  price: number;
  label?: string;
  color?: string;
}

const KEY_PREFIX = "analyzer_overlays:";

export function loadOverlays(symbol: string): OverlayLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY_PREFIX + symbol);
    return raw ? (JSON.parse(raw) as OverlayLine[]) : [];
  } catch {
    return [];
  }
}

export function saveOverlays(symbol: string, lines: OverlayLine[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY_PREFIX + symbol, JSON.stringify(lines));
  } catch { /* ignore */ }
}

interface Props {
  symbol: string;
  currentPrice: number;
  priceMin: number;
  priceMax: number;
  onChange: (lines: OverlayLine[]) => void;
}

// Editor UI — chart itself renders the lines via <ReferenceLine>.
export function OverlayLineEditor({ symbol, currentPrice, priceMin, priceMax, onChange }: Props) {
  const [lines, setLines] = useState<OverlayLine[]>([]);

  useEffect(() => {
    const l = loadOverlays(symbol);
    setLines(l);
    onChange(l);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const persist = useCallback((next: OverlayLine[]) => {
    setLines(next);
    saveOverlays(symbol, next);
    onChange(next);
  }, [symbol, onChange]);

  const add = () => {
    const price = Number(currentPrice.toFixed(2));
    const next = [
      ...lines,
      { id: `ol-${Date.now()}`, price, label: `Line ${lines.length + 1}`, color: "hsl(var(--arc))" },
    ];
    persist(next);
  };

  const update = (id: string, patch: Partial<OverlayLine>) => {
    persist(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const remove = (id: string) => persist(lines.filter((l) => l.id !== id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] tracking-widest text-arc/70 uppercase">Support / Resistance</div>
        <Button size="sm" variant="outline" onClick={add} className="h-7 text-xs">
          <Plus size={12} className="mr-1" /> Add line
        </Button>
      </div>
      {lines.length === 0 && (
        <p className="text-[10px] text-muted-foreground">No overlay lines. Add one to mark support / resistance.</p>
      )}
      {lines.map((l) => (
        <div key={l.id} className="flex items-center gap-2 text-xs">
          <input
            className="w-24 bg-background/40 border border-arc/20 rounded px-2 py-1 font-mono"
            value={l.label ?? ""}
            onChange={(e) => update(l.id, { label: e.target.value })}
            placeholder="Label"
          />
          <input
            type="number"
            step={0.01}
            className="w-24 bg-background/40 border border-arc/20 rounded px-2 py-1 font-mono"
            value={l.price}
            onChange={(e) => update(l.id, { price: Number(e.target.value) || 0 })}
          />
          <input
            type="range"
            min={priceMin}
            max={priceMax}
            step={(priceMax - priceMin) / 500 || 0.01}
            value={l.price}
            onChange={(e) => update(l.id, { price: Number(e.target.value) })}
            className="flex-1 accent-arc"
          />
          <button
            onClick={() => remove(l.id)}
            className="text-bearish hover:text-critical"
            title="Remove"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
