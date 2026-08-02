// Bundle Monaco locally instead of loading it from a CDN (which can be blocked).
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

let configured = false;

export function setupMonaco() {
  if (configured || typeof window === "undefined") return;
  configured = true;
  (self as any).MonacoEnvironment = {
    getWorker() {
      return new editorWorker();
    },
  };
  loader.config({ monaco });
}
