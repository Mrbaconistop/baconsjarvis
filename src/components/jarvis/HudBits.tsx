import { ReactNode } from "react";

export function PageHeader({
  tag,
  title,
  subtitle,
  right,
}: {
  tag: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-4 px-8 pt-8 pb-4 border-b border-arc/10">
      <div>
        <div className="font-mono text-[10px] tracking-[0.35em] text-arc">[ {tag} ]</div>
        <h1 className="font-display text-3xl mt-1 text-glow">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function PriorityChip({ level }: { level: "critical" | "high" | "normal" | "low" }) {
  const map = {
    critical: "bg-critical/15 text-critical border-critical/40",
    high: "bg-warning/15 text-warning border-warning/40",
    normal: "bg-arc/10 text-arc border-arc/30",
    low: "bg-muted text-muted-foreground border-border",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${map[level]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${level === "critical" ? "bg-critical animate-critical-pulse" : level === "high" ? "bg-warning" : level === "normal" ? "bg-arc" : "bg-muted-foreground"}`} />
      {level}
    </span>
  );
}

export function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span className="text-[10px] font-mono uppercase tracking-wider text-hud-dim">
      {platform}
    </span>
  );
}
