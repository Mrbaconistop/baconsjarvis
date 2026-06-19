import { useMemo } from "react";

export function ParticleField({ count = 36 }: { count?: number }) {
  const particles = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        size: 1 + Math.random() * 2.5,
        left: Math.random() * 100,
        top: Math.random() * 100,
        delay: Math.random() * 18,
        duration: 14 + Math.random() * 16,
        opacity: 0.2 + Math.random() * 0.5,
      })),
    [count],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute rounded-full bg-arc animate-drift"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.left}%`,
            top: `${p.top}%`,
            opacity: p.opacity,
            boxShadow: `0 0 ${p.size * 4}px var(--arc)`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
