import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  ChevronRight,
  ChevronLeft,
  Wand2,
  Dice5,
  Plus,
  Minus,
  MessageSquare,
  Newspaper,
  Cpu,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { PredictorMode } from "@/lib/patterns";
import type { OverlayLine } from "@/components/jarvis/ChartOverlayLines";
import { saveOverlays } from "@/components/jarvis/ChartOverlayLines";

type NewsFilter = "all" | "pos" | "neg" | "neu";

interface Props {
  symbol: string;
  currentPrice: number;
  mode: PredictorMode;
  onSetMode: (m: PredictorMode) => void;
  holdBars: number;
  onSetHold: (h: number) => void;
  onLoadSymbol: (s: string) => void;
  watchlist: string[];
  overlays: OverlayLine[];
  onSetOverlays: (l: OverlayLine[]) => void;
  onRunMC: () => void;
  mcRunning: boolean;
  onRunTune: () => void;
  tuning: boolean;
  newsFilter: NewsFilter;
  onSetNewsFilter: (f: NewsFilter) => void;
}

export function JarvisAnalyzerDock(props: Props) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");

  const addLine = (kind: "support" | "resistance") => {
    const offset = kind === "support" ? -0.03 : 0.03;
    const price = +(props.currentPrice * (1 + offset)).toFixed(2);
    const line: OverlayLine = {
      id: `${kind}-${Date.now()}`,
      price,
      label: kind === "support" ? "Support" : "Resistance",
      color: kind === "support" ? "hsl(var(--bullish))" : "hsl(var(--bearish))",
    };
    const next = [...props.overlays, line];
    saveOverlays(props.symbol, next);
    props.onSetOverlays(next);
  };

  const removeLast = () => {
    const next = props.overlays.slice(0, -1);
    saveOverlays(props.symbol, next);
    props.onSetOverlays(next);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-2 top-1/2 -translate-y-1/2 z-30 rounded-l-lg border border-arc/30 bg-background/90 backdrop-blur px-2 py-4 hover:bg-arc/10"
        title="Open JARVIS Dock"
      >
        <div className="flex flex-col items-center gap-1">
          <Bot size={16} className="text-arc" />
          <ChevronLeft size={12} />
        </div>
      </button>
    );
  }

  return (
    <aside className="fixed right-2 top-20 bottom-4 z-30 w-72 rounded-lg border border-arc/25 bg-background/95 backdrop-blur shadow-2xl flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-3 py-2 border-b border-arc/15">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-arc uppercase">
          <Bot size={14} /> JARVIS · Analyzer
        </div>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-arc">
          <ChevronRight size={14} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
        {/* Ticker */}
        <section>
          <div className="font-mono text-[9px] tracking-widest text-arc/70 uppercase mb-1">Ticker</div>
          <div className="flex gap-1">
            <Input
              placeholder="SYMBOL"
              className="h-7 text-xs font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = (e.target as HTMLInputElement).value.trim().toUpperCase();
                  if (v) props.onLoadSymbol(v);
                }
              }}
            />
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {["NVDA", "AAPL", "TSLA", "MSFT", "SPY", "QQQ", ...props.watchlist]
              .filter((s, i, a) => a.indexOf(s) === i)
              .slice(0, 10)
              .map((s) => (
                <button
                  key={s}
                  onClick={() => props.onLoadSymbol(s)}
                  className={cn(
                    "px-1.5 py-0.5 rounded border font-mono text-[10px]",
                    s === props.symbol
                      ? "border-arc bg-arc/20 text-arc"
                      : "border-arc/20 text-muted-foreground hover:bg-arc/10",
                  )}
                >
                  {s}
                </button>
              ))}
          </div>
        </section>

        {/* Predictor mode */}
        <section>
          <div className="font-mono text-[9px] tracking-widest text-arc/70 uppercase mb-1">Predictor</div>
          <div className="grid grid-cols-4 gap-1">
            {(["candlestick", "indicator", "pattern", "ml"] as PredictorMode[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={props.mode === m ? "default" : "outline"}
                onClick={() => props.onSetMode(m)}
                className="h-6 text-[10px] px-1 capitalize"
              >
                {m}
              </Button>
            ))}
          </div>
          <div className="mt-2">
            <div className="text-[10px] text-muted-foreground mb-1">Hold · {props.holdBars}d</div>
            <Slider
              value={[props.holdBars]}
              min={1}
              max={20}
              step={1}
              onValueChange={(v) => props.onSetHold(v[0])}
            />
          </div>
        </section>

        {/* Support / Resistance lines */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <div className="font-mono text-[9px] tracking-widest text-arc/70 uppercase">Overlays</div>
            <span className="text-[10px] text-muted-foreground">{props.overlays.length} line(s)</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => addLine("support")}>
              <Plus size={10} className="mr-1" /> Support
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => addLine("resistance")}>
              <Plus size={10} className="mr-1" /> Resistance
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] w-full mt-1"
            onClick={removeLast}
            disabled={!props.overlays.length}
          >
            <Minus size={10} className="mr-1" /> Remove last
          </Button>
        </section>

        {/* Simulations */}
        <section>
          <div className="font-mono text-[9px] tracking-widest text-arc/70 uppercase mb-1">Simulations</div>
          <div className="grid grid-cols-2 gap-1">
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={props.onRunMC} disabled={props.mcRunning}>
              {props.mcRunning ? <Loader2 size={10} className="mr-1 animate-spin" /> : <Dice5 size={10} className="mr-1" />}
              Monte Carlo
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={props.onRunTune} disabled={props.tuning}>
              {props.tuning ? <Loader2 size={10} className="mr-1 animate-spin" /> : <Wand2 size={10} className="mr-1" />}
              Autotune
            </Button>
          </div>
        </section>

        {/* News filter */}
        <section>
          <div className="font-mono text-[9px] tracking-widest text-arc/70 uppercase mb-1 flex items-center gap-1">
            <Newspaper size={10} /> News Filter
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(["all", "pos", "neu", "neg"] as NewsFilter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={props.newsFilter === f ? "default" : "outline"}
                onClick={() => props.onSetNewsFilter(f)}
                className={cn(
                  "h-6 text-[10px] px-1 uppercase",
                  f === "pos" && props.newsFilter === f && "bg-bullish/30",
                  f === "neg" && props.newsFilter === f && "bg-bearish/30",
                )}
              >
                {f}
              </Button>
            ))}
          </div>
        </section>

        {/* Ask Jarvis */}
        <section className="pt-2 border-t border-arc/10">
          <div className="font-mono text-[9px] tracking-widest text-arc/70 uppercase mb-1 flex items-center gap-1">
            <Cpu size={10} /> Ask Jarvis about {props.symbol}
          </div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Should I hold NVDA through earnings?"
            className="h-7 text-xs"
          />
          <Link to="/chat" className="mt-1 inline-flex w-full">
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => {
                if (typeof window !== "undefined") {
                  const seed = q
                    ? `[Analyzer:${props.symbol}] ${q}`
                    : `Analyze ${props.symbol}: current pattern, key levels, and near-term risk.`;
                  try { sessionStorage.setItem("jarvis:prefill", seed); } catch { /* ignore */ }
                }
              }}
            >
              <MessageSquare size={10} className="mr-1" /> Open in Chat
            </Button>
          </Link>
        </section>
      </div>
    </aside>
  );
}
