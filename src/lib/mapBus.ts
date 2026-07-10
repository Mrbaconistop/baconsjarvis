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
  | { type: "apply_theme_tokens"; tokens: Record<string, string>; merge?: boolean }
  | { type: "reset_theme" }
  | { type: "scroll_to"; selector: string }
  | { type: "focus_chat" }
  | { type: "copy_to_clipboard"; text: string; label?: string }
  | { type: "invalidate_queries"; keys?: string[] }
  | { type: "start_timer"; seconds: number; label?: string; sound?: boolean }
  | { type: "speak"; text: string; voice?: string }
  | { type: "click"; selector: string }
  | { type: "set_input_value"; selector: string; value: string }
  | { type: "set_local_storage"; key: string; value: string }
  | { type: "remove_local_storage"; key: string }
  | { type: "set_document_title"; title: string }
  | { type: "add_class"; selector: string; className: string }
  | { type: "remove_class"; selector: string; className: string }
  | { type: "open_page_customizer"; route_key?: string }
  | {
      type: "set_page_customization";
      route_key?: string;
      css?: string;
      js?: string;
      html?: string;
      position?: "top" | "bottom" | "floating" | "replace";
      enabled?: boolean;
    }
  | { type: "clear_page_customization"; route_key?: string };

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
