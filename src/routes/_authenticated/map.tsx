import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mapBus, type MapAction } from "@/lib/mapBus";
import { Crosshair, Layers, X, Search, MapPin, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { geocodeAddress } from "@/lib/maps.functions";

declare global {
  interface Window {
    google?: any;
    initJarvisMap?: () => void;
    __jarvisMapLoaded?: boolean;
  }
}

export const Route = createFileRoute("/_authenticated/map")({
  ssr: false,
  head: () => ({ meta: [{ title: "Map — JARVIS" }] }),
  component: MapPage,
});

const BROWSER_KEY = (import.meta as any).env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
const TRACKING_ID = (import.meta as any).env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;

function loadMapsJS(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.Map) {
      resolve();
      return;
    }

    if (window.__jarvisMapLoaded) {
      const checkInterval = setInterval(() => {
        if (window.google?.maps?.Map) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
      return;
    }

    window.__jarvisMapLoaded = true;

    window.initJarvisMap = () => {
      if (window.google?.maps?.Map) {
        resolve();
      } else {
        const checkInterval = setInterval(() => {
          if (window.google?.maps?.Map) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
      }
    };

    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${BROWSER_KEY}&loading=async&libraries=places&callback=initJarvisMap${TRACKING_ID ? `&channel=${TRACKING_ID}` : ""}`;
    s.async = true;
    s.onerror = (err) => {
      window.__jarvisMapLoaded = false;
      reject(err);
    };
    document.head.appendChild(s);
  });
}

function MapPage() {
  const qc = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const routeRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [satellite, setSatellite] = useState(false);

  const { data: places = [] } = useQuery({
    queryKey: ["map_places"],
    queryFn: async () => {
      const { data, error } = await supabase.from("map_places").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Init map
  useEffect(() => {
    let cancelled = false;
    let mounted = true;

    if (!BROWSER_KEY) return;

    const initMap = async () => {
      try {
        await loadMapsJS();
        if (cancelled || !mounted || !containerRef.current) return;

        const g = window.google;
        mapRef.current = new g.maps.Map(containerRef.current, {
          center: { lat: 40.7128, lng: -74.006 },
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          styles: JARVIS_MAP_STYLE,
        });
        setReady(true);
      } catch (e) {
        if (mounted) {
          toast.error(`Map failed to load: ${(e as any)?.message ?? e}`);
        }
      }
    };

    initMap();

    return () => {
      cancelled = true;
      mounted = false;
    };
  }, []);

  // Drop saved places as markers
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const g = window.google;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    places.forEach((p: any) => {
      const m = new g.maps.Marker({
        position: { lat: Number(p.lat), lng: Number(p.lng) },
        map: mapRef.current,
        title: p.label,
        label: { text: "◆", color: "#67e8f9", fontSize: "14px" },
      });
      const iw = new g.maps.InfoWindow({
        content: `<div style="color:#0a0a0a;font-family:ui-sans-serif"><strong>${escapeHtml(p.label)}</strong>${p.address ? `<br><span style="font-size:11px;opacity:.7">${escapeHtml(p.address)}</span>` : ""}${p.notes ? `<br><span style="font-size:11px">${escapeHtml(p.notes)}</span>` : ""}</div>`,
      });
      m.addListener("click", () => iw.open({ map: mapRef.current, anchor: m }));
      markersRef.current.push(m);
    });
  }, [places, ready]);

  // Register with the chat bus
  useEffect(() => {
    if (!ready) return;
    const unregister = mapBus.register((a: MapAction) => {
      const g = window.google;
      if (a.type === "flyTo") {
        mapRef.current.panTo({ lat: a.lat, lng: a.lng });
        if (a.zoom) mapRef.current.setZoom(a.zoom);
      } else if (a.type === "addMarker") {
        const m = new g.maps.Marker({
          position: { lat: a.lat, lng: a.lng },
          map: mapRef.current,
          title: a.label,
        });
        markersRef.current.push(m);
        mapRef.current.panTo({ lat: a.lat, lng: a.lng });
      } else if (a.type === "clearMarkers") {
        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];
      } else if (a.type === "drawRoute") {
        if (routeRef.current) routeRef.current.setMap(null);
        const path = decodePolyline(a.polyline);
        routeRef.current = new g.maps.Polyline({
          path,
          map: mapRef.current,
          strokeColor: "#67e8f9",
          strokeOpacity: 0.9,
          strokeWeight: 4,
        });
        const bounds = new g.maps.LatLngBounds();
        path.forEach((p: any) => bounds.extend(p));
        mapRef.current.fitBounds(bounds, 60);
      }
    });
    return unregister;
  }, [ready]);

  // Map type toggle
  useEffect(() => {
    if (!ready) return;
    mapRef.current?.setMapTypeId(satellite ? "hybrid" : "roadmap");
  }, [satellite, ready]);

  async function flyToPlace(p: any) {
    if (!mapRef.current) return;
    mapRef.current.panTo({ lat: Number(p.lat), lng: Number(p.lng) });
    mapRef.current.setZoom(15);
  }

  async function deletePlace(id: string) {
    const { error } = await supabase.from("map_places").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["map_places"] });
  }

  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim() || !mapRef.current) return;

    try {
      const result = await geocodeAddress({ data: { address: search } });
      if (!result.ok) {
        toast.error(result.error || "No results");
        return;
      }

      const g = window.google;
      const loc = new g.maps.LatLng(result.lat, result.lng);
      mapRef.current.panTo(loc);
      mapRef.current.setZoom(14);

      const m = new g.maps.Marker({
        position: loc,
        map: mapRef.current,
        title: result.formatted || search,
      });
      markersRef.current.push(m);
    } catch (err: any) {
      toast.error(err?.message ?? "Search failed");
    }
  }

  async function savePin() {
    if (!mapRef.current) return;
    const c = mapRef.current.getCenter();
    const label = window.prompt("Label for this place?");
    if (!label) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("map_places").insert({
      user_id: u.user.id,
      label,
      lat: c.lat(),
      lng: c.lng(),
    });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["map_places"] });
    toast.success(`Saved ${label}`);
  }

  function recenter() {
    if (!navigator.geolocation || !mapRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapRef.current.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        mapRef.current.setZoom(14);
      },
      (e) => toast.error(e.message),
    );
  }

  if (!BROWSER_KEY) {
    return (
      <div className="p-8 text-hud-dim">
        Google Maps connector is not configured. Reconnect it from Project Settings.
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full">
      <div ref={containerRef} className="absolute inset-0" />
      {/* Top search bar */}
      <form
        onSubmit={doSearch}
        className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-2 rounded-md bg-background/80 backdrop-blur-xl border border-arc/30 shadow-arc w-[min(560px,90vw)]"
      >
        <Search size={14} className="text-arc" />
        <input
          id="map-search"
          name="map-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search place or address…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-hud-dim"
          autoComplete="off"
        />
        {search && (
          <button type="button" onClick={() => setSearch("")} className="text-hud-dim hover:text-foreground">
            <X size={14} />
          </button>
        )}
      </form>

      {/* Left saved places panel */}
      <div className="absolute top-20 left-4 z-10 w-72 max-h-[70vh] flex flex-col rounded-md bg-background/75 backdrop-blur-xl border border-arc/20 shadow-arc">
        <div className="px-3 py-2 border-b border-arc/15 flex items-center justify-between">
          <div className="font-mono text-[10px] tracking-[0.25em] text-arc">SAVED · {places.length}</div>
          <button onClick={savePin} className="text-arc hover:text-foreground" title="Save current center">
            <Save size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {places.length === 0 && (
            <div className="text-xs text-hud-dim p-2">No saved places yet. Ask JARVIS or hit the save icon.</div>
          )}
          {places.map((p: any) => (
            <div key={p.id} className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-arc/10">
              <MapPin size={12} className="text-arc shrink-0" />
              <button onClick={() => flyToPlace(p)} className="flex-1 min-w-0 text-left">
                <div className="text-xs font-medium truncate">{p.label}</div>
                {p.address && <div className="text-[10px] text-hud-dim truncate">{p.address}</div>}
              </button>
              <button
                onClick={() => deletePlace(p.id)}
                className="opacity-0 group-hover:opacity-100 text-hud-dim hover:text-critical transition"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom-right controls */}
      <div className="absolute bottom-6 right-6 z-10 flex flex-col gap-2">
        <button
          onClick={recenter}
          className="p-3 rounded-md bg-background/80 backdrop-blur-xl border border-arc/30 hover:bg-arc/10 text-arc"
          title="My location"
        >
          <Crosshair size={16} />
        </button>
        <button
          onClick={() => setSatellite((s) => !s)}
          className={`p-3 rounded-md bg-background/80 backdrop-blur-xl border border-arc/30 hover:bg-arc/10 ${satellite ? "text-arc" : "text-hud-dim"}`}
          title="Toggle satellite"
        >
          <Layers size={16} />
        </button>
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function decodePolyline(encoded: string) {
  const points: { lat: number; lng: number }[] = [];
  let index = 0,
    lat = 0,
    lng = 0;
  while (index < encoded.length) {
    let b,
      shift = 0,
      result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    points.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
  }
  return points;
}

const JARVIS_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0a0e14" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#67e8f9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a0e14" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#1e3a5f" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#16202a" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0f3460" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#1e3a5f" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#050a12" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3b6e8f" }] },
];
