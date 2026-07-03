// Lightweight pub/sub buses for AI-driven client-side actions.
// - mapBus: legacy map-specific actions (fly to, markers, routes)
// - appBus: generic app-wide actions (navigate, toast, reload, theme…)

export type MapAction =
  | { type: "flyTo"; lat: number; lng: number; zoom?: number; label?: string }
  | { type: "addMarker"; lat: number; lng: number; label?: string; color?: string }
  | { type: "clearMarkers" }
  | { type: "drawRoute"; polyline: string; label?: string };

export type AppAction =
  | { type: "navigate"; to: string; replace?: boolean }
  | { type: "reload" }
  | { type: "open_url"; url: string; new_tab?: boolean }
  | { type: "toast"; message: string; kind?: "info" | "success" | "error" | "warning" }
  | { type: "set_theme"; theme: "light" | "dark" | "system" }
  | { type: "scroll_to"; selector: string }
  | { type: "focus_chat" }
  | { type: "copy_to_clipboard"; text: string; label?: string }
  | { type: "invalidate_queries"; keys?: string[] }
  | { type: "start_timer"; seconds: number; label?: string; sound?: boolean }
  | { type: "speak"; text: string; voice?: string };

type Handler<T> = (a: T) => void;

class Bus<T extends { type: string }> {
  private handler: Handler<T> | null = null;
  register(h: Handler<T>) {
    this.handler = h;
    return () => {
      if (this.handler === h) this.handler = null;
    };
  }
  dispatch(a: T) {
    if (this.handler) {
      this.handler(a);
      return true;
    }
    return false;
  }
  isLive() {
    return this.handler !== null;
  }
}

export const mapBus = new Bus<MapAction>();
export const appBus = new Bus<AppAction>();

const MAP_ACTIONS = new Set(["flyTo", "addMarker", "clearMarkers", "drawRoute"]);

// Apply a client_action payload returned by a server tool.
export function applyClientAction(action: any) {
  if (!action || typeof action !== "object" || !action.type) return;
  if (MAP_ACTIONS.has(action.type)) {
    mapBus.dispatch(action as MapAction);
    return;
  }
  appBus.dispatch(action as AppAction);
}
