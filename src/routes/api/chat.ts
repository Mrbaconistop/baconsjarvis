import { createFileRoute } from "@tanstack/react-router";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";

type Body = { messages?: UIMessage[]; threadId?: string; tabSlug?: string | null };

function serializeChatError(error: unknown, stage: string, extra: Record<string, unknown> = {}) {
  const e = error as any;
  const cause = e?.cause as any;
  return {
    tag: "JARVIS_CHAT_DEBUG",
    stage,
    name: e?.name ?? e?.constructor?.name ?? "UnknownError",
    message: e?.message ?? String(error),
    code: e?.code,
    statusCode: e?.statusCode ?? e?.status ?? cause?.statusCode ?? cause?.status,
    provider: e?.provider,
    modelId: e?.modelId,
    version: e?.version,
    causeName: cause?.name,
    causeMessage: cause?.message,
    ...extra,
  };
}

function debugChatError(error: unknown, stage: string, extra: Record<string, unknown> = {}) {
  const payload = serializeChatError(error, stage, extra);
  console.error(`[JARVIS_CHAT_DEBUG]\n${JSON.stringify(payload, null, 2)}`, error);
  return payload;
}

function chatErrorResponse(payload: ReturnType<typeof serializeChatError>, originalMessages: UIMessage[]) {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `chat-error-${Date.now()}`;
  const debugText = JSON.stringify(payload, null, 2);
  const message = `Signal interrupted, Sir. Copy this debug block into another AI if you want to troubleshoot it:\n\n\`\`\`json\n${debugText}\n\`\`\``;
  const stream = createUIMessageStream<UIMessage>({
    originalMessages,
    execute: ({ writer }) => {
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: message });
      writer.write({ type: "text-end", id });
    },
    onError: (streamError) => {
      const streamPayload = serializeChatError(streamError, "fallback-stream");
      console.error(`[JARVIS_CHAT_DEBUG]\n${JSON.stringify(streamPayload, null, 2)}`, streamError);
      return streamPayload.message;
    },
  });
  return createUIMessageStreamResponse({ status: 200, stream });
}

// Chat/embedding/memory/cache helpers removed — AI is disabled to avoid Lovable credit usage.

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });

        const { messages, threadId, tabSlug } = (await request.json()) as Body;
        if (!Array.isArray(messages) || !threadId) return new Response("Bad request", { status: 400 });

        // ---- AI DISABLED (no Lovable credit usage) ----
        // Chat model calls are turned off so this site consumes zero Lovable credits.
        // Re-enable by removing this block.
        {
          const id = typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `ai-disabled-${Date.now()}`;
          const message =
            "AI responses are disabled on this site to avoid using Lovable credits. " +
            "Voice input still works locally in your browser. " +
            "To re-enable JARVIS chat, remove the AI-disabled block in src/routes/api/chat.ts.";
          const stream = createUIMessageStream<UIMessage>({
            originalMessages: messages,
            execute: ({ writer }) => {
              writer.write({ type: "text-start", id });
              writer.write({ type: "text-delta", id, delta: message });
              writer.write({ type: "text-end", id });
            },
          });
          return createUIMessageStreamResponse({ status: 200, stream });
        }

        // (chat handler body removed — AI disabled to avoid Lovable credit usage)
      },
    },
  },
});

function buildBrowserTabHTML(opts: {
  homeUrl: string;
  showAddressBar: boolean;
  showNavButtons: boolean;
  showReloadButton: boolean;
  showHomeButton: boolean;
  showGoButton: boolean;
}): string {
  const { homeUrl, showAddressBar, showNavButtons, showReloadButton, showHomeButton, showGoButton } = opts;
  const configJS = JSON.stringify({ showAddressBar, showNavButtons, showReloadButton, showHomeButton, showGoButton });
  return `<!-- Built‑in Browser Tab with Configurable UI -->
<div id="browser-container" style="display:flex;flex-direction:column;height:100vh;background:#0f1115;color:#e0e6ed;font-family:system-ui,sans-serif;">
  <div id="browser-toolbar" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(26,29,35,0.8);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;flex-wrap:wrap;">
    <div id="nav-group" style="display:flex;gap:4px;align-items:center;">
      <button id="browser-back" style="background:transparent;border:none;color:#9ca3af;font-size:20px;cursor:pointer;padding:0 4px;">◀</button>
      <button id="browser-forward" style="background:transparent;border:none;color:#9ca3af;font-size:20px;cursor:pointer;padding:0 4px;">▶</button>
      <button id="browser-reload" style="background:transparent;border:none;color:#9ca3af;font-size:18px;cursor:pointer;padding:0 4px;">⟳</button>
    </div>
    <div id="address-group" style="display:flex;flex:1;gap:4px;align-items:center;min-width:150px;">
      <input id="browser-url" type="url" style="flex:1;background:rgba(15,17,21,0.6);color:#d1d5db;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 12px;font-size:14px;outline:none;min-width:100px;" placeholder="Enter URL..." value="${homeUrl}">
      <button id="browser-go" style="background:#7c3aed;border:none;color:white;border-radius:6px;padding:6px 14px;cursor:pointer;font-weight:500;white-space:nowrap;">Go</button>
    </div>
    <div id="home-group" style="display:flex;gap:4px;align-items:center;">
      <button id="browser-home" style="background:transparent;border:none;color:#9ca3af;font-size:18px;cursor:pointer;">🏠</button>
      <button id="browser-settings" style="background:transparent;border:none;color:#9ca3af;font-size:16px;cursor:pointer;" title="Browser UI Settings">⚙️</button>
    </div>
  </div>
  <iframe id="browser-iframe" src="${homeUrl}" style="flex:1;border:none;width:100%;height:100%;background:white;"></iframe>
</div>

<div id="browser-settings-panel" style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(26,29,35,0.95);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:24px;max-width:360px;width:90%;z-index:1000;box-shadow:0 8px 40px rgba(0,0,0,0.8);">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
    <h3 style="font-size:16px;font-weight:600;color:#e0e6ed;margin:0;">Browser UI Settings</h3>
    <button id="settings-close" style="background:transparent;border:none;color:#9ca3af;font-size:20px;cursor:pointer;">✕</button>
  </div>
  <div style="display:flex;flex-direction:column;gap:12px;">
    <label style="display:flex;align-items:center;gap:10px;color:#e0e6ed;font-size:14px;">
      <input type="checkbox" class="browser-ui-toggle" data-key="showAddressBar" ${showAddressBar ? "checked" : ""}> Address Bar
    </label>
    <label style="display:flex;align-items:center;gap:10px;color:#e0e6ed;font-size:14px;">
      <input type="checkbox" class="browser-ui-toggle" data-key="showNavButtons" ${showNavButtons ? "checked" : ""}> Navigation Buttons
    </label>
    <label style="display:flex;align-items:center;gap:10px;color:#e0e6ed;font-size:14px;">
      <input type="checkbox" class="browser-ui-toggle" data-key="showReloadButton" ${showReloadButton ? "checked" : ""}> Reload Button
    </label>
    <label style="display:flex;align-items:center;gap:10px;color:#e0e6ed;font-size:14px;">
      <input type="checkbox" class="browser-ui-toggle" data-key="showHomeButton" ${showHomeButton ? "checked" : ""}> Home Button
    </label>
    <label style="display:flex;align-items:center;gap:10px;color:#e0e6ed;font-size:14px;">
      <input type="checkbox" class="browser-ui-toggle" data-key="showGoButton" ${showGoButton ? "checked" : ""}> Go Button
    </label>
  </div>
  <button id="settings-save" style="margin-top:16px;width:100%;background:#7c3aed;color:white;border:none;border-radius:6px;padding:8px;font-weight:500;cursor:pointer;">Save Settings</button>
</div>

<script>
(function() {
  const DEFAULT_CONFIG = ${configJS};
  const CONFIG_KEY = 'browser-ui-config';
  let uiConfig = JSON.parse(localStorage.getItem(CONFIG_KEY)) || DEFAULT_CONFIG;

  const toolbar = document.getElementById('browser-toolbar');
  const navGroup = document.getElementById('nav-group');
  const addressGroup = document.getElementById('address-group');
  const homeGroup = document.getElementById('home-group');
  const backBtn = document.getElementById('browser-back');
  const forwardBtn = document.getElementById('browser-forward');
  const reloadBtn = document.getElementById('browser-reload');
  const homeBtn = document.getElementById('browser-home');
  const goBtn = document.getElementById('browser-go');
  const urlInput = document.getElementById('browser-url');
  const iframe = document.getElementById('browser-iframe');
  const settingsBtn = document.getElementById('browser-settings');
  const settingsPanel = document.getElementById('browser-settings-panel');
  const settingsClose = document.getElementById('settings-close');
  const settingsSave = document.getElementById('settings-save');
  const toggles = document.querySelectorAll('.browser-ui-toggle');

  function applyUI() {
    navGroup.style.display = uiConfig.showNavButtons ? 'flex' : 'none';
    addressGroup.style.display = uiConfig.showAddressBar ? 'flex' : 'none';
    homeGroup.style.display = (uiConfig.showHomeButton || uiConfig.showReloadButton) ? 'flex' : 'none';
    reloadBtn.style.display = uiConfig.showReloadButton ? 'inline-block' : 'none';
    homeBtn.style.display = uiConfig.showHomeButton ? 'inline-block' : 'none';
    goBtn.style.display = uiConfig.showGoButton ? 'inline-block' : 'none';
  }

  let history = [];
  let currentIndex = -1;

  function navigateTo(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    iframe.src = url;
    urlInput.value = url;
    history = history.slice(0, currentIndex + 1);
    history.push(url);
    currentIndex++;
  }

  goBtn.addEventListener('click', () => navigateTo(urlInput.value));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigateTo(urlInput.value);
  });
  backBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
      currentIndex--;
      const url = history[currentIndex];
      iframe.src = url;
      urlInput.value = url;
    }
  });
  forwardBtn.addEventListener('click', () => {
    if (currentIndex < history.length - 1) {
      currentIndex++;
      const url = history[currentIndex];
      iframe.src = url;
      urlInput.value = url;
    }
  });
  reloadBtn.addEventListener('click', () => { iframe.src = iframe.src; });
  homeBtn.addEventListener('click', () => navigateTo('${homeUrl}'));

  iframe.addEventListener('load', () => {
    try {
      const url = iframe.contentWindow?.location?.href;
      if (url && url !== 'about:blank') {
        urlInput.value = url;
        if (history[history.length - 1] !== url) {
          history = history.slice(0, currentIndex + 1);
          history.push(url);
          currentIndex++;
        }
      }
    } catch (e) {}
  });

  settingsBtn.addEventListener('click', () => {
    settingsPanel.style.display = 'block';
    toggles.forEach(cb => {
      cb.checked = uiConfig[cb.dataset.key] !== undefined ? uiConfig[cb.dataset.key] : true;
    });
  });
  settingsClose.addEventListener('click', () => settingsPanel.style.display = 'none');
  settingsPanel.addEventListener('click', (e) => {
    if (e.target === settingsPanel) settingsPanel.style.display = 'none';
  });
  settingsSave.addEventListener('click', () => {
    toggles.forEach(cb => {
      uiConfig[cb.dataset.key] = cb.checked;
    });
    localStorage.setItem(CONFIG_KEY, JSON.stringify(uiConfig));
    applyUI();
    settingsPanel.style.display = 'none';
  });

  applyUI();
})();
<\/script>`;
}
