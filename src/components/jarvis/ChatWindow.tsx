import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { Send, Square, Bell, Vault, ListChecks, CheckCircle2, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQueryClient } from "@tanstack/react-query";

// Add Shadcn Select components
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ... keep TOOL_META ...

export function ChatWindow({ threadId, initial }: { threadId: string; initial: UIMessage[] }) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState("groq"); // State for active provider
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
          // Pass the selected provider along with the messages
          return { body: { messages, threadId, provider, ...(body ?? {}) }, headers };
        },
      }),
    [threadId, provider],
  ); // Re-initialize transport if provider changes

  // ... keep existing useChat, busy, useEffect, submit code ...

  return (
    <div className="flex flex-col h-full">
      {/* ... keep existing messages list ... */}

      <div className="border-t border-arc/15 bg-background/40 backdrop-blur px-4 py-3">
        <div className="max-w-4xl mx-auto flex flex-col gap-2">
          {/* Provider Selector */}
          <div className="flex justify-end">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-[180px] h-7 text-xs bg-background/60 border-arc/20 text-hud-dim focus:ring-0">
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
              // ... keep existing textarea props ...
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

// ... keep MessageBubble component ...
