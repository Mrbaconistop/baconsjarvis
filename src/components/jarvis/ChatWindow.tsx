import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
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
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Paperclip,
  FileText,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useQueryClient } from "@tanstack/react-query";
import { applyClientAction } from "@/lib/mapBus";
import { toast } from "sonner";
import { MicDiagnosticsDialog } from "./MicDiagnosticsDialog";
import { HelpCircle } from "lucide-react";
import { buildLibraryPromptPayload } from "@/lib/libraries";

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
  const [attachments, setAttachments] = useState<{ id: string; name: string; size: number; content: string; kind: "text" | "binary" }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [micPermission, setMicPermission] = useState<PermissionState | "unknown" | "unsupported">("unknown");
  const [micDiagOpen, setMicDiagOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ---- TTS state (client‑only) ----
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Load preference on client only
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("jarvis-tts-enabled");
    if (saved !== null) setTtsEnabled(saved === "true");
  }, []);

  const speakWithElevenLabs = useCallback(
    async (text: string) => {
      if (typeof window === "undefined") return;
      if (!ttsEnabled || !text?.trim() || isRecording || isTranscribing) return;
      try {
        setIsSpeaking(true);
        // Use Lovable's ElevenLabs proxy (assumes you have the connector linked)
        const response = await fetch("/api/elevenlabs/text-to-speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: text,
            voice_id: "pNInz6obpgDQGcFmaJgB", // Adam – change if you prefer
            model_id: "eleven_monolingual_v1",
            voice_settings: { stability: 0.5, similarity_boost: 0.5 },
          }),
        });
        if (!response.ok) throw new Error("ElevenLabs API error");
        const audioBlob = await response.blob();
        const url = URL.createObjectURL(audioBlob);
        if (audioRef.current) {
          audioRef.current.src = url;
          await audioRef.current.play();
          audioRef.current.onended = () => {
            setIsSpeaking(false);
            URL.revokeObjectURL(url);
          };
        }
      } catch (err) {
        console.error("[ElevenLabs TTS] error", err);
        setIsSpeaking(false);
      }
    },
    [ttsEnabled, isRecording, isTranscribing],
  );

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem("jarvis-tts-enabled", String(next));
        if (!next && audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = "";
        }
      }
      return next;
    });
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

  // ---- Auto‑speak assistant messages ----
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") {
      const text = (last.parts || [])
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join(" ")
        .trim();
      if (text) {
        const timer = setTimeout(() => speakWithElevenLabs(text), 400);
        return () => clearTimeout(timer);
      }
    }
  }, [messages, speakWithElevenLabs]);

  // ---- Handle explicit speak_text tool calls ----
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") {
      for (const part of last.parts || []) {
        const p: any = part;
        if (p.type === "tool-response" && p.result?.client_action?.type === "speak") {
          speakWithElevenLabs(p.result.client_action.text);
        }
      }
    }
  }, [messages, speakWithElevenLabs]);

  // ---- Voice input via browser Web Speech API (no server, no credits) ----
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR: any =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMicPermission("unsupported");
      return;
    }
    if (!navigator.permissions?.query) {
      setMicPermission("unknown");
      return;
    }
    let mounted = true;
    let status: PermissionStatus | null = null;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        if (!mounted) return;
        status = result;
        setMicPermission(result.state);
        result.onchange = () => setMicPermission(result.state);
      })
      .catch(() => setMicPermission("unknown"));
    return () => {
      mounted = false;
      if (status) status.onchange = null;
    };
  }, []);

  function startRecording() {
    if (isRecording || isTranscribing || isSpeaking) return;
    const SR: any =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice input isn't supported in this browser.", {
        description: "Chrome, Edge, or Safari support the Web Speech API.",
      });
      return;
    }
    if (micPermission === "denied") {
      toast.error("Microphone is blocked for this site.", {
        description: "Unblock it in site settings, then reload. Tap the ? button for diagnostics.",
        action: { label: "Diagnose", onClick: () => setMicDiagOpen(true) },
      });
      return;
    }

    try {
      const recognition = new SR();
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;

      let finalText = "";
      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) finalText += r[0].transcript;
        }
      };
      recognition.onerror = (event: any) => {
        console.error("[speech] error", event);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setMicPermission("denied");
          toast.error("Microphone permission denied.");
        } else if (event.error === "no-speech") {
          toast.error("Didn't catch that, Sir.");
        } else if (event.error === "audio-capture") {
          toast.error("No microphone found.");
        } else {
          toast.error(`Voice error: ${event.error}`);
        }
        setIsRecording(false);
      };
      recognition.onend = async () => {
        setIsRecording(false);
        const text = finalText.trim();
        if (!text) return;
        try {
          await sendMessage({ text });
          setInput("");
        } catch (err: any) {
          console.error("[speech] send error", err);
          toast.error(`Send failed: ${err?.message ?? err}`);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
      toast.info("Listening, Sir…");
    } catch (err: any) {
      console.error("[speech] start error", err);
      toast.error(`Mic error: ${err?.message ?? err}`);
      setIsRecording(false);
    }
  }

  function stopRecording() {
    const r = recognitionRef.current;
    if (r) {
      try {
        r.stop();
      } catch (e) {
        console.warn("[speech] stop error", e);
      }
    }
    setIsRecording(false);
  }

  function toggleMic() {
    if (isRecording) stopRecording();
    else startRecording();
  }



  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      try {
        recognitionRef.current?.stop?.();
      } catch {}
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  // ---- Chat UI ----
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

  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll if user is already near the bottom (within 120px).
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (!nearBottom) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight; // instant, no smooth jank during streaming
    });
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [messages, status]);

  async function submit() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy) return;
    // Smuggle full file contents into the prompt as fenced blocks — the UI
    // still renders them as compact chips, but the model receives everything.
    const filePayload = attachments.length
      ? attachments
          .map((a) =>
            a.kind === "text"
              ? `\n\n<file name="${a.name}" bytes="${a.size}">\n\`\`\`\n${a.content}\n\`\`\`\n</file>`
              : `\n\n<file name="${a.name}" bytes="${a.size}" encoding="base64">\n${a.content}\n</file>`,
          )
          .join("")
      : "";
    const libraryPayload = buildLibraryPromptPayload();
    const fullText = (text || `Attached ${attachments.length} file(s).`) + filePayload + libraryPayload;
    setInput("");
    setAttachments([]);
    await sendMessage({ text: fullText });
  }

  const TEXT_EXT = /\.(txt|md|markdown|lua|js|jsx|ts|tsx|py|rb|go|rs|java|c|h|cpp|hpp|cs|php|sh|bash|zsh|yml|yaml|toml|ini|conf|json|xml|html|htm|css|scss|sass|sql|env|log|csv|tsv|swift|kt|dart|vue|svelte|astro|graphql|proto|dockerfile|makefile)$/i;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const MAX_BYTES = 500_000;
    const MAX_FILES = 6;
    const additions: typeof attachments = [];
    for (const file of Array.from(files).slice(0, MAX_FILES - attachments.length)) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name}: too large (${(file.size / 1024).toFixed(0)}kb, max 500kb)`);
        continue;
      }
      const isText = TEXT_EXT.test(file.name) || file.type.startsWith("text/") || file.type === "application/json";
      try {
        const content = isText
          ? await file.text()
          : await new Promise<string>((res, rej) => {
              const r = new FileReader();
              r.onload = () => res((r.result as string).split(",")[1] ?? "");
              r.onerror = () => rej(r.error);
              r.readAsDataURL(file);
            });
        additions.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          size: file.size,
          content,
          kind: isText ? "text" : "binary",
        });
      } catch (err: any) {
        toast.error(`Failed to read ${file.name}: ${err?.message ?? err}`);
      }
    }
    if (additions.length) setAttachments((prev) => [...prev, ...additions]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.length === 0 && (
          <div className="text-center text-hud-dim text-sm mt-12">
            <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-2">JARVIS ONLINE</div>
            <div>At your service, Sir. Ask for a reminder, save a credential, or simply talk.</div>
          </div>
        )}
        {messages.map((m: UIMessage) => {
          // Include a content-derived version in the key so in-place
          // mutations by useChat still force a re-render as tokens stream.
          const version = (m.parts as any[]).reduce(
            (acc, p: any) => acc + (typeof p?.text === "string" ? p.text.length : 0) + (p?.state ? 1 : 0),
            m.parts.length,
          );
          return <MessageBubble key={m.id} msg={m} version={version} />;
        })}
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
        {attachments.length > 0 && (
          <div className="max-w-4xl mx-auto mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div key={a.id} className="group flex items-center gap-2 pl-2 pr-1 py-1 rounded-md bg-arc/10 border border-arc/25 text-xs">
                <FileText size={12} className="text-arc" />
                <span className="font-mono truncate max-w-[180px]" title={a.name}>{a.name}</span>
                <span className="text-hud-dim text-[10px]">{(a.size / 1024).toFixed(1)}kb</span>
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="p-0.5 rounded hover:bg-critical/20 text-hud-dim hover:text-critical"
                  aria-label={`Remove ${a.name}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          {/* Attach files */}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy || attachments.length >= 6}
            className="p-3 rounded-lg border border-arc/30 hover:bg-arc/10 text-hud-dim disabled:opacity-40 transition"
            aria-label="Attach files"
            title="Attach files (text files sent as code, others as base64)"
          >
            <Paperclip size={16} />
          </button>

          {/* TTS Toggle */}
          <button
            onClick={toggleTts}
            className={`p-3 rounded-lg border transition ${
              ttsEnabled ? "border-arc/30 bg-arc/10 text-arc" : "border-muted/30 bg-muted/20 text-muted-foreground"
            }`}
            aria-label="Toggle TTS"
            title={ttsEnabled ? "Disable voice output" : "Enable voice output"}
          >
            {ttsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          {/* Mic Button */}
          <button
            onClick={toggleMic}
            disabled={isTranscribing || isSpeaking}
            className={`p-3 rounded-lg border transition ${
              isRecording
                ? "bg-critical/20 border-critical/40 text-critical animate-critical-pulse"
                : isTranscribing || isSpeaking
                  ? "bg-muted/50 border-muted text-muted-foreground opacity-60"
                  : "border-arc/30 hover:bg-arc/10 text-hud-dim"
            }`}
            aria-label="Voice input"
            title={
              isRecording
                ? "Stop recording"
                : isTranscribing
                  ? "Transcribing…"
                  : isSpeaking
                    ? "JARVIS is speaking"
                    : micPermission === "denied"
                      ? "Microphone blocked in site settings"
                    : "Speak your message"
            }
          >
            {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
          </button>

          {/* Mic diagnostics */}
          <button
            onClick={() => setMicDiagOpen(true)}
            className="p-2 rounded-lg border border-arc/20 text-hud-dim hover:bg-arc/10 hover:text-arc transition"
            aria-label="Microphone diagnostics"
            title="Microphone diagnostics"
          >
            <HelpCircle size={14} />
          </button>
          <MicDiagnosticsDialog open={micDiagOpen} onClose={() => setMicDiagOpen(false)} />

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
                ? "Listening…"
                : isTranscribing
                  ? "Transcribing…"
                  : isSpeaking
                    ? "JARVIS is speaking…"
                    : 'Speak or type, Sir. e.g. "Remind me to drink water every weekday at 10am"'
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
              disabled={!input.trim() && attachments.length === 0}
              className="p-3 rounded-lg bg-arc text-arc-foreground shadow-arc hover:opacity-90 disabled:opacity-40 transition"
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Hidden audio element for ElevenLabs */}
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}

// Memoized markdown block — avoids re-parsing prior assistant messages
// on every streamed token of the current one.
const MD_REMARK = [remarkGfm, remarkMath];
const MD_REHYPE = [rehypeKatex];
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={MD_REMARK} rehypePlugins={MD_REHYPE}>
      {text}
    </ReactMarkdown>
  );
});

// Compare msg by id + parts length + last-part text length so we skip
// re-rendering settled messages while streaming a new one.
const MessageBubble = memo(
  function MessageBubble({ msg }: { msg: UIMessage; version: number }) {
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
                  className="bg-arc text-arc-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap"
                >
                  {part.text}
                </div>
              ) : (
                <div
                  key={i}
                  className="prose prose-invert prose-sm max-w-none text-foreground prose-p:my-2 prose-headings:text-arc prose-strong:text-foreground prose-code:text-arc prose-code:bg-arc/10 prose-code:px-1 prose-code:rounded"
                >
                  <MarkdownBlock text={part.text} />
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
  },
  (prev, next) => prev.msg.id === next.msg.id && prev.version === next.version,
);
