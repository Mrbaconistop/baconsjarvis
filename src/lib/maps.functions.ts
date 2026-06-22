import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

function gwHeaders() {
  const lovable = process.env.LOVABLE_API_KEY;
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!lovable || !key) throw new Error("Google Maps connector not configured");
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": key,
    "Content-Type": "application/json",
  } as Record<string, string>;
}

export const geocodeAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { address: string }) => d)
  .handler(async ({ data }) => {
    const url = `${GATEWAY}/maps/api/geocode/json?address=${encodeURIComponent(data.address)}`;
    const r = await fetch(url, { headers: gwHeaders() });
    const json = (await r.json()) as any;
    const top = json.results?.[0];
    if (!top) return { ok: false as const, error: json.status || "No results" };
    return {
      ok: true as const,
      lat: top.geometry.location.lat as number,
      lng: top.geometry.location.lng as number,
      formatted: top.formatted_address as string,
      place_id: top.place_id as string,
    };
  });

export const searchPlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }) => {
    const r = await fetch(`${GATEWAY}/places/v1/places:searchText`, {
      method: "POST",
      headers: {
        ...gwHeaders(),
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.types",
      },
      body: JSON.stringify({ textQuery: data.query, maxResultCount: 5 }),
    });
    const json = (await r.json()) as any;
    const places = (json.places ?? []).map((p: any) => ({
      id: p.id,
      name: p.displayName?.text,
      address: p.formattedAddress,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      types: p.types,
    }));
    return { ok: true as const, places };
  });

export const getDirections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { origin: string; destination: string; mode?: string }) => d)
  .handler(async ({ data }) => {
    const r = await fetch(`${GATEWAY}/routes/directions/v2:computeRoutes`, {
      method: "POST",
      headers: {
        ...gwHeaders(),
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation",
      },
      body: JSON.stringify({
        origin: { address: data.origin },
        destination: { address: data.destination },
        travelMode: (data.mode ?? "DRIVE").toUpperCase(),
      }),
    });
    const json = (await r.json()) as any;
    const route = json.routes?.[0];
    if (!route) return { ok: false as const, error: json?.error?.message || "No route" };
    return {
      ok: true as const,
      distanceMeters: route.distanceMeters as number,
      duration: route.duration as string,
      polyline: route.polyline?.encodedPolyline as string,
    };
  });
