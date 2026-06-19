import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { Send, Square, Bell, Vault, ListChecks, CheckCircle2, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQueryClient } from "@tanstack/react-query";

const TOOL_META: Record<string, { icon: any; label: string }> = {
  "tool-create_reminder": { icon: Bell, label: "Setting reminder" },
  "tool-list_reminders": { icon: ListChecks, label: "Checking reminders" },
  "tool-complete_reminder": { icon: CheckCircle2, label: "Completing reminder" },
  "tool-save_vault_item": { icon: Vault, label: "Saving to vault" },
  "tool-list_vault": { icon: Vault, label: "Reading vault" },
};

export function ChatWindow({ threadId, initial }: { threadId: string; initial: UIMessage[] }) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: async ({ messages, body }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      return { body: { messages, threadId, ...(body ?? {}) }, headers };
    },
  }), [threadId]);

  const { messages, sendMessage, status, stop, error } = useChat({
    id: threadId,
    messages: initial,
    transport,
    onFinish: () => {
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["vault"] });
    },
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => { taRef.current?.focus(); }, [threadId, busy]);
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
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.length === 0 && (
          <div className="text-center text-hud-dim text-sm mt-12">
            <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-2">JARVIS ONLINE</div>
            <div>At your service, Sir. Ask for a reminder, save a credential, or simply talk.</div>
          </div>
        )}
        {messages.map((m: UIMessage) => <MessageBubble key={m.id} msg={m} />)}
        {status === "submitted" && (
          <div className="flex items-center gap-2 text-arc font-mono text-xs">
            <span className="inline-block size-1.5 rounded-full bg-arc animate-pulse" />
            <span className="inline-block size-1.5 rounded-full bg-arc animate-pulse [animation-delay:0.15s]" />
            <span className="inline-block size-1.5 rounded-full bg-arc animate-pulse [animation-delay:0.3s]" />
            <span className="opacity-60 ml-1">JARVIS thinking…</span>
          </div>
        )}
        {error && (
          <div className="text-xs text-critical font-mono">Error: {error.message}</div>
        )}
      </div>

      <div className="border-t border-arc/15 bg-background/40 backdrop-blur px-4 py-3">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder='Speak freely, Sir. e.g. "Remind me to drink water every weekday at 10am"'
            className="flex-1 resize-none bg-background/60 border border-arc/25 rounded-lg px-4 py-3 font-mono text-sm focus:border-arc focus:outline-none max-h-40"
          />
          {busy ? (
            <button onClick={stop} className="p-3 rounded-lg bg-critical/20 border border-critical/40 text-critical hover:bg-critical/30 transition" aria-label="Stop">
              <Square size={16} />
            </button>
          ) : (
            <button onClick={submit} disabled={!input.trim()} className="p-3 rounded-lg bg-arc text-arc-foreground shadow-arc hover:opacity-90 disabled:opacity-40 transition" aria-label="Send">
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: UIMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 max-w-4xl mx-auto ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="size-7 rounded-full bg-arc/15 border border-arc/30 flex items-center justify-center text-arc font-mono text-[9px] shrink-0 mt-1">J</div>
      )}
      <div className={`min-w-0 ${isUser ? "max-w-[80%]" : "max-w-[85%]"}`}>
        {msg.parts.map((part: any, i) => {
          if (part.type === "text") {
            return isUser ? (
              <div key={i} className="bg-arc text-arc-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
                {part.text}
              </div>
            ) : (
              <div key={i} className="prose prose-invert prose-sm max-w-none text-foreground prose-p:my-2 prose-headings:text-arc prose-strong:text-foreground prose-code:text-arc prose-code:bg-arc/10 prose-code:px-1 prose-code:rounded">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
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
                  {part.input && (<div><div className="opacity-60 mb-1">input</div><pre className="whitespace-pre-wrap">{JSON.stringify(part.input, null, 2)}</pre></div>)}
                  {part.output != null && (<div><div className="opacity-60 mb-1">result</div><pre className="whitespace-pre-wrap">{JSON.stringify(part.output, null, 2)}</pre></div>)}
                  {part.errorText && <div className="text-critical">{part.errorText}</div>}
                </div>
              </details>
            );
          }
          return null;
        })}
      </div>
      {isUser && (
        <div className="size-7 rounded-full bg-background border border-arc/30 flex items-center justify-center text-hud-dim font-mono text-[9px] shrink-0 mt-1">SIR</div>
      )}
    </div>
  );
}
