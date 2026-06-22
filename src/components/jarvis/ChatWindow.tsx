import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { Send, Square, Bell, Vault, ListChecks, CheckCircle2, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQueryClient } from "@tanstack/react-query";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TOOL_META: Record<string, { icon: any; label: string; color: string }> = {
  createReminder: { icon: Bell, label: "Set Reminder", color: "text-arc" },
  listReminders: { icon: ListChecks, label: "Check Reminders", color: "text-arc" },
  upsertVault: { icon: Vault, label: "Update Vault", color: "text-warning" },
  listVault: { icon: Vault, label: "Check Vault", color: "text-warning" },
};

export function ChatWindow({ threadId, initial }: { threadId: string; initial: UIMessage[] }) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState("groq");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
          return { body: { messages, threadId, provider, ...(body ?? {}) }, headers };
        },
      }),
    [threadId, provider],
  );

  const { messages, append, stop, status } = useChat({
    id: threadId,
    initialMessages: initial,
    transport,
    onFinish: () => {
      // Invalidate queries so the UI updates if tools modified database state
      qc.invalidateQueries({ queryKey: ["reminders"] });
      qc.invalidateQueries({ queryKey: ["vault"] });
    },
  });

  const busy = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  function submit() {
    if (!input.trim() || busy) return;
    append({ role: "user", content: input.trim() });
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {messages.length === 0 && (
            <div className="text-center text-hud-dim mt-20 font-mono text-sm">
              JARVIS System Initialized. <br /> Awaiting input...
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-arc/15 bg-background/40 backdrop-blur px-4 py-3">
        <div className="max-w-4xl mx-auto flex flex-col gap-3">
          <div className="flex justify-end">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-[180px] h-8 text-xs bg-background/60 border-arc/20 text-hud-dim focus:ring-0">
                <SelectValue placeholder="Select Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="groq">Groq (Llama 3)</SelectItem>
                <SelectItem value="groq_alt">Groq (Alt Key)</SelectItem>
                <SelectItem value="gemini">Google Gemini 1.5</SelectItem>
                <SelectItem value="deepseek">DeepSeek</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end gap-2">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
              onKeyDown={handleKeyDown}
              placeholder="Message JARVIS..."
              className="flex-1 bg-background/60 border border-arc/20 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-arc resize-none"
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
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl p-4 ${isUser ? "bg-secondary text-secondary-foreground" : "glass-strong border border-arc/20"}`}
      >
        {message.content && (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}

        {message.toolInvocations && message.toolInvocations.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.toolInvocations.map((toolCall) => {
              const meta = TOOL_META[toolCall.toolName] ?? {
                icon: Wrench,
                label: toolCall.toolName,
                color: "text-hud-dim",
              };
              const Icon = meta.icon;

              return (
                <div
                  key={toolCall.toolCallId}
                  className="flex items-center gap-2 text-xs font-mono bg-background/50 border border-border/50 rounded px-2 py-1.5 w-fit"
                >
                  <Icon size={12} className={meta.color} />
                  <span className="text-muted-foreground">{meta.label}</span>
                  {toolCall.state === "result" ? (
                    <CheckCircle2 size={12} className="text-success ml-2" />
                  ) : (
                    <span className="animate-pulse text-arc ml-2">...</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
