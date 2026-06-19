import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { runCommand } from "@/lib/jarvis.functions";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function QuickActionBar() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const recogRef = useRef<any>(null);
  const run = useServerFn(runCommand);
  const qc = useQueryClient();

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = false; r.interimResults = false; r.lang = "en-US";
    r.onresult = (e: any) => setText(e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
  }, []);

  function toggleMic() {
    const r = recogRef.current;
    if (!r) return toast.error("Voice not supported in this browser, Sir.");
    if (listening) { r.stop(); return; }
    try { r.start(); setListening(true); } catch { /* already started */ }
  }

  async function submit() {
    if (!text.trim()) return;
    setBusy(true); setReply(null);
    try {
      const res = await run({ data: { text } });
      setReply(res.reply);
      setText("");
      if (res.created) {
        toast.success("Reminder set, Sir.");
        qc.invalidateQueries({ queryKey: ["reminders"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Command failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-strong hud-corners rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} className="text-arc" />
        <div className="font-mono text-[10px] tracking-[0.3em] text-arc">QUICK ACTION</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={toggleMic}
          className={`p-3 rounded-md border transition ${listening ? "bg-critical text-white border-critical animate-critical-pulse" : "border-arc/30 hover:bg-arc/10"}`}
          aria-label="Voice input"
        >
          {listening ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder='e.g. "Remind me to call David at 3 PM" or "Summarise Twitter mentions"'
          className="flex-1 bg-background/40 border border-arc/20 rounded-md px-4 py-3 font-mono text-sm focus:border-arc focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="bg-arc text-arc-foreground p-3 rounded-md shadow-arc hover:opacity-90 transition disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
      {reply && (
        <div className="mt-3 p-3 rounded-md bg-arc/5 border border-arc/20">
          <div className="font-mono text-[10px] text-arc mb-1">JARVIS</div>
          <p className="text-sm">{reply}</p>
        </div>
      )}
    </div>
  );
}
