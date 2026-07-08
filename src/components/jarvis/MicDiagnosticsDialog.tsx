import { useEffect, useState } from "react";
import { X, RefreshCw, CheckCircle2, XCircle, AlertCircle, Mic } from "lucide-react";
import { toast } from "sonner";

interface Result {
  mediaDevicesSupported: boolean;
  mediaRecorderSupported: boolean;
  isSecureContext: boolean;
  protocol: string;
  permissionState: string;
  permissionsApiSupported: boolean;
  supportedMimeTypes: string[];
  audioInputs: { deviceId: string; label: string }[];
  probe: { ok: boolean; error?: string; trackLabel?: string; sampleRate?: number };
}

async function runDiagnostics(): Promise<Result> {
  const mediaDevicesSupported = !!navigator.mediaDevices?.getUserMedia;
  const mediaRecorderSupported = typeof (window as any).MediaRecorder !== "undefined";
  const isSecureContext = window.isSecureContext;
  const protocol = window.location.protocol;

  let permissionState = "unknown";
  const permissionsApiSupported = !!navigator.permissions?.query;
  if (permissionsApiSupported) {
    try {
      const p = await navigator.permissions.query({ name: "microphone" as PermissionName });
      permissionState = p.state;
    } catch { permissionState = "query-failed"; }
  }

  const supportedMimeTypes: string[] = [];
  if (mediaRecorderSupported) {
    for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg", "audio/wav"]) {
      if (MediaRecorder.isTypeSupported(t)) supportedMimeTypes.push(t);
    }
  }

  let audioInputs: { deviceId: string; label: string }[] = [];
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const devs = await navigator.mediaDevices.enumerateDevices();
      audioInputs = devs.filter((d) => d.kind === "audioinput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "(unnamed — grant permission to reveal)" }));
    }
  } catch (e: any) { /* noop */ }

  const probe: Result["probe"] = { ok: false };
  if (mediaDevicesSupported) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      probe.ok = true;
      probe.trackLabel = track?.label;
      probe.sampleRate = (track?.getSettings?.() as any)?.sampleRate;
      stream.getTracks().forEach((t) => t.stop());
    } catch (e: any) {
      probe.error = `${e?.name ?? "Error"}: ${e?.message ?? e}`;
    }
  } else {
    probe.error = "mediaDevices.getUserMedia not available";
  }

  return {
    mediaDevicesSupported, mediaRecorderSupported, isSecureContext, protocol,
    permissionState, permissionsApiSupported, supportedMimeTypes, audioInputs, probe,
  };
}

function Row({ ok, label, detail }: { ok: boolean | "warn"; label: string; detail?: string }) {
  const Icon = ok === true ? CheckCircle2 : ok === "warn" ? AlertCircle : XCircle;
  const color = ok === true ? "text-success" : ok === "warn" ? "text-amber-400" : "text-destructive";
  return (
    <div className="flex items-start gap-2 py-1.5 text-sm border-b border-arc/5">
      <Icon size={14} className={`${color} mt-0.5 shrink-0`} />
      <div className="flex-1">
        <div className="font-mono text-xs">{label}</div>
        {detail && <div className="text-hud-dim text-[11px] font-mono break-all">{detail}</div>}
      </div>
    </div>
  );
}

export function MicDiagnosticsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try { setResult(await runDiagnostics()); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (open) run(); }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={onClose}>
      <div className="glass-strong hud-corners rounded-xl p-5 max-w-lg w-full max-h-[80vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-arc">
            <Mic size={14} /> MIC DIAGNOSTICS
          </div>
          <div className="flex gap-2">
            <button onClick={run} disabled={loading}
                    className="text-xs px-2 py-1 rounded border border-arc/30 hover:bg-arc/10 flex items-center gap-1 disabled:opacity-50">
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Re-test
            </button>
            <button onClick={onClose} className="text-hud-dim hover:text-foreground"><X size={16} /></button>
          </div>
        </div>

        {!result ? (
          <div className="text-hud-dim text-sm">Running diagnostics…</div>
        ) : (
          <div className="space-y-1">
            <Row ok={result.isSecureContext} label="Secure context (HTTPS)"
                 detail={`protocol=${result.protocol}, secureContext=${result.isSecureContext}`} />
            <Row ok={result.mediaDevicesSupported} label="navigator.mediaDevices.getUserMedia" />
            <Row ok={result.mediaRecorderSupported} label="MediaRecorder API" />
            <Row ok={result.permissionsApiSupported ? true : "warn"} label="Permissions API"
                 detail={`supported=${result.permissionsApiSupported}`} />
            <Row
              ok={result.permissionState === "granted" ? true : result.permissionState === "denied" ? false : "warn"}
              label="Microphone permission"
              detail={`state=${result.permissionState}`}
            />
            <Row ok={result.supportedMimeTypes.length > 0} label="Supported audio MIME types"
                 detail={result.supportedMimeTypes.join(", ") || "none"} />
            <Row ok={result.audioInputs.length > 0} label={`Audio input devices (${result.audioInputs.length})`}
                 detail={result.audioInputs.map((d) => d.label).join(" | ") || "no devices enumerated"} />
            <Row ok={result.probe.ok} label="Live getUserMedia probe"
                 detail={result.probe.ok
                   ? `track="${result.probe.trackLabel ?? "?"}" sampleRate=${result.probe.sampleRate ?? "?"}`
                   : result.probe.error} />

            {!result.probe.ok && (
              <div className="mt-4 p-3 rounded bg-background/40 border border-arc/10 text-xs text-hud-dim space-y-1">
                <div className="font-mono text-arc">FIX STEPS</div>
                {result.permissionState === "denied" && (
                  <ol className="list-decimal ml-4 space-y-1">
                    <li>Click the 🔒 lock icon in the address bar</li>
                    <li>Set <span className="font-mono">Microphone → Allow</span></li>
                    <li>Reload the page</li>
                    <li>On macOS also: System Settings → Privacy &amp; Security → Microphone → enable your browser</li>
                  </ol>
                )}
                {!result.isSecureContext && (
                  <div>⚠ Site is not HTTPS — browsers block mic on insecure origins.</div>
                )}
                {result.audioInputs.length === 0 && result.permissionState !== "denied" && (
                  <div>⚠ No audio input devices found. Plug in / enable a mic in your OS.</div>
                )}
                {result.probe.error?.includes("NotReadableError") && (
                  <div>⚠ Another app is using the mic. Close Zoom/Discord/Teams and re-test.</div>
                )}
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(result, null, 2));
                  toast.success("Diagnostics copied to clipboard");
                }}
                className="text-xs px-3 py-1.5 rounded border border-arc/30 hover:bg-arc/10">
                Copy report
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
