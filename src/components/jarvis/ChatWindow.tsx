import { useEffect, useMemo, useRef, useState, memo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import {
  Send,
  Square,
  Bell,
  Vault,
  ListChecks,
  CheckCircle2,
  Wrench,
  MapPin,
  Mic,
  MicOff,
  Upload,
  Paperclip,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useQueryClient } from "@tanstack/react-query";
import { applyClientAction } from "@/lib/mapBus";
import { toast } from "sonner";

const TOOL_META: Record<string, { icon: any; label: string }> = {
  "tool-create_reminder": { icon: Bell, label: "Setting reminder" },
  "tool-list_reminders": { icon: ListChecks, label: "Checking reminders" },
  "tool-complete_reminder": { icon: CheckCircle2, label: "Completing reminder" },
  "tool-save_vault_item": { icon: Vault, label: "Saving to vault" },
  "tool-list_vault": { icon: Vault, label: "Reading vault" },
  "tool-search_places": { icon: MapPin, label: "Searching places" },
  "tool-geocode_address": { icon: MapPin, label: "Geocoding" },
  "tool-save_place": { icon: MapPin, label: "Saving place" },
  "tool-list_saved_places": { icon: MapPin, label: "Reading saved places" },
  "tool-delete_saved_place": { icon: MapPin, label: "Deleting place" },
  "tool-show_on_map": { icon: MapPin, label: "Showing on map" },
  "tool-get_directions": { icon: MapPin, label: "Getting directions" },
};

export function ChatWindow({
  threadId,
  initial,
  tabSlug,
  compact,
}: {
  threadId: string;
  initial: UIMessage[];
  tabSlug?: string | null;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pickMimeType(): string | null {
    const candidates = ["audio/webm", "audio/mp4", "audio/ogg"];
    for (const t of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
    }
    return null;
  }

  async function startRecording() {
    if (isRecording || isTranscribing) return;
    try {
      const mimeType = pickMimeType();
      if (!mimeType) {
        toast.error("This browser can't record a supported audio format.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (blob.size < 1024) {
          toast.error("That recording was empty — please try again.");
          return;
        }
        await transcribe(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
      toast.info("Listening, Sir…");
    } catch (err: any) {
      console.error("[mic] start error", err);
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        toast.error("Microphone permission denied.");
      } else if (err?.name === "NotFoundError") {
        toast.error("No microphone found.");
      } else {
        toast.error(`Mic error: ${err?.message ?? err}`);
      }
    }
  }

  function stopRecording() {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch (e) {
        console.warn("[mic] stop error", e);
      }
    }
    setIsRecording(false);
  }

  async function transcribe(blob: Blob) {
    setIsTranscribing(true);
    try {
      const fd = new FormData();
      const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
      fd.append("file", blob, `recording.${ext}`);
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? json?.error ?? `HTTP ${res.status}`);
      }
      const text: string = json?.text ?? "";
      if (!text.trim()) {
        toast.error("Didn't catch that, Sir.");
        return;
      }
      setInput((prev) => (prev ? prev + " " + text : text));
      taRef.current?.focus();
    } catch (err: any) {
      console.error("[transcribe] error", err);
      toast.error(`Transcription failed: ${err?.message ?? err}`);
    } finally {
      setIsTranscribing(false);
    }
  }

  function toggleMic() {
    if (isRecording) stopRecording();
    else startRecording();
  }

  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      } catch {}
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ---- File upload handler ----
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    processFiles(files);
    event.target.value = ""; // reset input
  };

  const processFiles = (files: FileList) => {
    let fileContent = "";
    let fileNames: string[] = [];
    const allowedExtensions = [
      "txt",
      "lua",
      "py",
      "js",
      "ts",
      "html",
      "css",
      "json",
      "xml",
      "yaml",
      "yml",
      "md",
      "csv",
      "log",
    ];

    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!allowedExtensions.includes(ext)) {
        toast.warning(`Skipped "${file.name}" – unsupported file type (.${ext})`);
        continue;
      }
      if (file.size > 1024 * 1024 * 5) {
        toast.warning(`Skipped "${file.name}" – file too large (max 5MB)`);
        continue;
      }
      try {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result as string;
          const lang = ext === "lua" ? "lua" : ext === "txt" ? "text" : ext;
          const snippet = `\n\n--- ${file.name} (${lang}) ---\n${text}\n--- End ${file.name} ---\n`;
          setInput((prev) => prev + snippet);
          fileNames.push(file.name);
        };
        reader.readAsText(file);
      } catch (err) {
        toast.error(`Failed to read "${file.name}"`);
      }
    }
    if (fileNames.length > 0) {
      toast.success(`Loaded ${fileNames.length} file(s)`);
      taRef.current?.focus();
    }
  };

  // ---- Drag and Drop File Upload (kept as additional feature) ----
  useEffect(() => {
    const element = dropRef.current;
    if (!element) return;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = element.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        setIsDragging(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      processFiles(files);
    };

    element.addEventListener("dragenter", handleDragEnter);
    element.addEventListener("dragover", handleDragOver);
    element.addEventListener("dragleave", handleDragLeave);
    element.addEventListener("drop", handleDrop);

    return () => {
      element.removeEventListener("dragenter", handleDragEnter);
      element.removeEventListener("dragover", handleDragOver);
      element.removeEventListener("dragleave", handleDragLeave);
      element.removeEventListener("drop", handleDrop);
    };
  }, []);

  // ---- Transport ----
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: async ({ messages, body }) => {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const headers: Record<string, string> = {};
          if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
          return { body: { messages, threadId, tabSlug: tabSlug ?? null, ...(body ?? {}) }, headers };
        },
      }),
    [threadId, tabSlug],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    id: threadId,
    messages: initial,
    transport,
    onFinish: () => {
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["vault"] });
      qc.invalidateQueries({ queryKey: ["map_places"] });
    },
  });

  const busy = status === "submitted" || status === "streaming";

  const dispatchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      for (let i = 0; i < m.parts.length; i++) {
        const p: any = m.parts[i];
        if (typeof p?.type === "string" && p.type.startsWith("tool-") && p.output?.client_action) {
          const key = `${m.id}:${i}`;
          if (!dispatchedRef.current.has(key)) {
            dispatchedRef.current.add(key);
            applyClientAction(p.output.client_action);
          }
        }
      }
    }
  }, [messages]);

  useEffect(() => {
    taRef.current?.focus();
  }, [threadId, busy]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <div ref={dropRef} className="flex flex-col h-full relative">
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-4 border-dashed border-arc rounded-lg">
          <div className="text-center">
            <Upload size={48} className="mx-auto text-arc mb-4" />
            <div className="font-display text-xl text-arc">Drop your files here</div>
            <div className="text-sm text-hud-dim mt-2">
              Accepts: .txt, .lua, .py, .js, .html, .css, .json, .md, .xml, .yml, .csv, .log
            </div>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.length === 0 && (
          <div className="text-center text-hud-dim text-sm mt-12">
            <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-2">JARVIS ONLINE</div>
            <div>At your service, Sir. Ask for a reminder, save a credential, or simply talk.</div>
            <div className="mt-4 text-xs text-hud-dim/60">📎 Click the paperclip to upload .txt or .lua files</div>
          </div>
        )}
        {messages.map((m: UIMessage) => (
          <MessageBubble key={m.id} msg={m} />
        ))}
        {status === "submitted" && (
          <div className="flex items-center gap-2 text-arc font-mono text-xs">
            <span className="inline-block size-1.5 rounded-full bg-arc animate-pulse" />
            <span className="inline-block size-1.5 rounded-full bg-arc animate-pulse [animation-delay:0.15s]" />
            <span className="inline-block size-1.5 rounded-full bg-arc animate-pulse [animation-delay:0.3s]" />
            <span className="opacity-60 ml-1">JARVIS thinking…</span>
          </div>
        )}
        {error && <div className="text-xs text-critical font-mono">Error: {error.message}</div>}
      </div>

      <div className="border-t border-arc/15 bg-background/40 backdrop-blur px-4 py-3">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <button
            onClick={toggleMic}
            disabled={isTranscribing}
            className={`p-3 rounded-lg border transition ${
              isRecording
                ? "bg-critical/20 border-critical/40 text-critical animate-critical-pulse"
                : isTranscribing
                  ? "bg-muted/50 border-muted text-muted-foreground opacity-60"
                  : "border-arc/30 hover:bg-arc/10 text-hud-dim"
            }`}
            aria-label="Voice input"
            title={isRecording ? "Stop recording" : isTranscribing ? "Transcribing…" : "Speak your message"}
          >
            {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
          </button>

          {/* File upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-3 rounded-lg border border-arc/30 hover:bg-arc/10 text-hud-dim transition"
            aria-label="Upload file"
            title="Upload .txt or .lua file"
          >
            <Paperclip size={16} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.lua,.py,.js,.ts,.html,.css,.json,.xml,.yml,.yaml,.md,.csv,.log"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />

          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              isRecording
                ? "Listening… tap mic to stop"
                : isTranscribing
                  ? "Transcribing…"
                  : "Speak or type, Sir. Use 📎 to upload .txt/.lua files"
            }
            className="flex-1 resize-none bg-background/60 border border-arc/25 rounded-lg px-4 py-3 font-mono text-sm focus:border-arc focus:outline-none max-h-40"
          />

          {busy ? (
            <button
              onClick={stop}
              className="p-3 rounded-lg bg-critical/20 border border-critical/40 text-critical hover:bg-critical/30 transition"
              aria-label="Stop"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              className="p-3 rounded-lg bg-arc text-arc-foreground shadow-arc hover:opacity-90 disabled:opacity-40 transition"
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          )}
        </div>
        <div className="flex items-center justify-center mt-1.5 text-[10px] text-hud-dim/50 gap-3">
          <span>📎 Click paperclip to upload .txt or .lua</span>
          <span>•</span>
          <span>🎤 Click mic to speak</span>
        </div>
      </div>
    </div>
  );
}

// Memoized MessageBubble (unchanged)
const MessageBubble = memo(function MessageBubble({ msg }: { msg: UIMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 max-w-4xl mx-auto ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="size-7 rounded-full bg-arc/15 border border-arc/30 flex items-center justify-center text-arc font-mono text-[9px] shrink-0 mt-1">
          J
        </div>
      )}
      <div className={`min-w-0 ${isUser ? "max-w-[80%]" : "max-w-[85%]"}`}>
        {msg.parts.map((part: any, i) => {
          if (part.type === "text") {
            return isUser ? (
              <div
                key={i}
                className="bg-arc text-arc-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap break-words"
              >
                {part.text}
              </div>
            ) : (
              <div
                key={i}
                className="prose prose-invert prose-sm max-w-none text-foreground prose-p:my-2 prose-headings:text-arc prose-strong:text-foreground prose-code:text-arc prose-code:bg-arc/10 prose-code:px-1 prose-code:rounded"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {part.text}
                </ReactMarkdown>
              </div>
            );
          }
          if (typeof part.type === "string" && part.type.startsWith("tool-")) {
            const meta = TOOL_META[part.type] ?? { icon: Wrench, label: part.type.replace("tool-", "") };
            const Icon = meta.icon;
            const state = part.state as string | undefined;
            return (
              <details key={i} className="my-2 rounded-md border border-arc/20 bg-arc/5 text-xs">
                <summary className="cursor-pointer px-3 py-2 flex items-center gap-2 font-mono text-arc">
                  <Icon size={12} />
                  <span>{meta.label}</span>
                  <span className="opacity-50">· {state ?? "…"}</span>
                </summary>
                <div className="px-3 pb-3 space-y-2 font-mono text-[11px] text-hud-dim">
                  {part.input && (
                    <div>
                      <div className="opacity-60 mb-1">input</div>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(part.input, null, 2)}</pre>
                    </div>
                  )}
                  {part.output != null && (
                    <div>
                      <div className="opacity-60 mb-1">result</div>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(part.output, null, 2)}</pre>
                    </div>
                  )}
                  {part.errorText && <div className="text-critical">{part.errorText}</div>}
                </div>
              </details>
            );
          }
          return null;
        })}
      </div>
      {isUser && (
        <div className="size-7 rounded-full bg-background border border-arc/30 flex items-center justify-center text-hud-dim font-mono text-[9px] shrink-0 mt-1">
          SIR
        </div>
      )}
    </div>
  );
});
