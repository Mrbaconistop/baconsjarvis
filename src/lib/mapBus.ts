// Lightweight pub/sub bus to let chat tools drive the live Map page.
export type MapAction =
  | { type: "flyTo"; lat: number; lng: number; zoom?: number; label?: string }
  | { type: "addMarker"; lat: number; lng: number; label?: string; color?: string }
  | { type: "clearMarkers" }
  | { type: "drawRoute"; polyline: string; label?: string };

type Handler = (a: MapAction) => void;

class MapBus {
  private handler: Handler | null = null;
  register(h: Handler) {
    this.handler = h;
    return () => {
      if (this.handler === h) this.handler = null;
    };
  }
  dispatch(a: MapAction) {
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

export const mapBus = new MapBus();

// Apply a client_action payload returned by a server tool.
export function applyClientAction(action: any) {
  if (!action || typeof action !== "object" || !action.type) return;
  mapBus.dispatch(action as MapAction);
}
