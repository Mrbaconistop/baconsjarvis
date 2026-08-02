// Bundle Monaco locally instead of loading it from a CDN (which can be blocked).
// Everything is dynamically imported so SSR never evaluates browser-only modules.
let promise: Promise<void> | null = null;

export function setupMonaco(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!promise) {
    promise = (async () => {
      const [{ loader }, monaco, { default: EditorWorker }] = await Promise.all([
        import("@monaco-editor/react"),
        import("monaco-editor"),
        import("monaco-editor/esm/vs/editor/editor.worker?worker"),
      ]);
      (self as any).MonacoEnvironment = {
        getWorker: () => new EditorWorker(),
      };
      loader.config({ monaco });
    })();
  }
  return promise;
}
