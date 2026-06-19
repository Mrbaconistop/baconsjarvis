export function JarvisOrb({ size = 200, active = true }: { size?: number; active?: boolean }) {
  return (
    <div
      className="relative"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{ background: "var(--gradient-arc)", filter: "blur(4px)" }}
      />
      <div className="absolute inset-[18%] rounded-full bg-arc/15 border border-arc/40 animate-spin-slow" />
      <div className="absolute inset-[28%] rounded-full border border-arc/30" />
      <div
        className="absolute inset-[38%] rounded-full border border-arc/60 animate-spin-slow"
        style={{ animationDirection: "reverse", animationDuration: "10s" }}
      />
      <div className="absolute inset-[46%] rounded-full bg-arc shadow-arc" style={{ opacity: active ? 1 : 0.3 }} />
      {/* tick marks */}
      <svg className="absolute inset-0 animate-spin-slow" style={{ animationDuration: "30s" }} viewBox="0 0 100 100">
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = (i / 24) * Math.PI * 2;
          const x1 = 50 + Math.cos(angle) * 48;
          const y1 = 50 + Math.sin(angle) * 48;
          const x2 = 50 + Math.cos(angle) * (i % 3 === 0 ? 44 : 46);
          const y2 = 50 + Math.sin(angle) * (i % 3 === 0 ? 44 : 46);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--arc)" strokeWidth={i % 3 === 0 ? 0.6 : 0.3} opacity={i % 3 === 0 ? 0.8 : 0.4} />;
        })}
      </svg>
    </div>
  );
}
