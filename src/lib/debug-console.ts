// Client-side error formatter that prints a single copy-pasteable block to the
// console for every uncaught error / rejection. Format is optimized for pasting
// into an external LLM (DeepSeek, ChatGPT, etc.) with zero extra context needed.

let installed = false;

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    for (const k of Object.keys(err) as Array<keyof Error>) {
      if (!(k in out)) out[k as string] = (err as any)[k];
    }
    return out;
  }
  if (typeof err === "object" && err !== null) return err as Record<string, unknown>;
  return { value: String(err) };
}

function printBlock(kind: string, err: unknown, extra?: Record<string, unknown>) {
  const payload = {
    kind,
    route: typeof window !== "undefined" ? window.location.pathname + window.location.search : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    time: new Date().toISOString(),
    error: serializeError(err),
    ...(extra ?? {}),
  };
  const json = JSON.stringify(payload, null, 2);
  // Single console.error call = one selectable block. Banner makes it easy to
  // triple-click / drag-select in devtools.
  // eslint-disable-next-line no-console
  console.error(
    `\n===== 🪲 COPY BELOW FOR AI DEBUG (${kind}) =====\n${json}\n===== END =====\n`,
  );
}

export function installDebugConsole() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    printBlock("window.error", event.error ?? event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    printBlock("unhandledrejection", event.reason);
  });

  // Expose a manual helper: JARVIS_DEBUG(err) prints the same block on demand.
  (window as any).JARVIS_DEBUG = (err: unknown, extra?: Record<string, unknown>) =>
    printBlock("manual", err, extra);
}
