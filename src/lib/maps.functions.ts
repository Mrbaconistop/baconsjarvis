// src/lib/maps.functions.ts

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// -------------------------------------------------------------------
// 1. CONSTANTS & HELPERS
// -------------------------------------------------------------------

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

/**
 * Builds the required headers for Lovable's Google Maps connector gateway.
 *
 * IMPORTANT:
 * - LOVABLE_API_KEY must be set in your Lovable project environment variables.
 * - GOOGLE_MAPS_API_KEY must be set and have the Geocoding, Places, and Routes
 *   APIs enabled in your Google Cloud Console.
 */
function gwHeaders() {
  const lovable = process.env.LOVABLE_API_KEY;
  const key = process.env.GOOGLE_MAPS_API_KEY;

  if (!lovable || !key) {
    throw new Error(
      "❌ Google Maps connector not configured. Missing LOVABLE_API_KEY or GOOGLE_MAPS_API_KEY in environment.",
    );
  }

  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": key,
    "Content-Type": "application/json",
  } as Record<string, string>;
}

// -------------------------------------------------------------------
// 2. FUNCTION 1: GEOCODE AN ADDRESS
// -------------------------------------------------------------------

export const geocodeAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { address: string }) => d)
  .handler(async ({ data }) => {
    const url = `${GATEWAY}/maps/api/geocode/json?address=${encodeURIComponent(data.address)}`;

    // --- DEBUG LOGGING (remove these 3 lines after it works) ---
    console.log("🌍 [geocode] URL:", url);
    // ------------------------------------------------------------

    const r = await fetch(url, { headers: gwHeaders() });

    // --- DEBUG LOGGING (remove these 3 lines after it works) ---
    console.log("🔢 [geocode] HTTP Status:", r.status);
    // ------------------------------------------------------------

    // Read the raw response as text FIRST so we can debug if it's HTML/JSON
    const rawText = await r.text();

    // --- DEBUG LOGGING (remove these 3 lines after it works) ---
    console.log("📄 [geocode] Raw Response (first 200 chars):", rawText.substring(0, 200));
    // ------------------------------------------------------------

    // Try to parse the raw text as JSON
    try {
      const json = JSON.parse(rawText);

      // Check for API-level errors (e.g., OVER_QUERY_LIMIT, REQUEST_DENIED)
      if (json.status && json.status !== "OK") {
        return {
          ok: false as const,
          error: `Google API Error: ${json.status} - ${json.error_message || ""}`,
        };
      }

      const top = json.results?.[0];
      if (!top) {
        return {
          ok: false as const,
          error: `No results found for "${data.address}"`,
        };
      }

      return {
        ok: true as const,
        lat: top.geometry.location.lat as number,
        lng: top.geometry.location.lng as number,
        formatted: top.formatted_address as string,
        place_id: top.place_id as string,
      };
    } catch (parseError) {
      // If it's not JSON, the gateway probably returned an HTML error page
      return {
        ok: false as const,
        error: `Gateway returned invalid response (not JSON). Check LOVABLE_API_KEY. Raw: ${rawText.substring(0, 100)}`,
      };
    }
  });

// -------------------------------------------------------------------
// 3. FUNCTION 2: SEARCH PLACES (TEXT SEARCH)
// -------------------------------------------------------------------

export const searchPlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }) => {
    const r = await fetch(`${GATEWAY}/places/v1/places:searchText`, {
      method: "POST",
      headers: {
        ...gwHeaders(),
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types",
      },
      body: JSON.stringify({ textQuery: data.query, maxResultCount: 5 }),
    });

    // Debug: log status
    console.log("🔢 [searchPlaces] HTTP Status:", r.status);

    const rawText = await r.text();
    console.log("📄 [searchPlaces] Raw (first 200):", rawText.substring(0, 200));

    try {
      const json = JSON.parse(rawText);

      if (json.error) {
        return {
          ok: false as const,
          error: json.error.message || "Places API error",
          places: [],
        };
      }

      const places = (json.places ?? []).map((p: any) => ({
        id: p.id,
        name: p.displayName?.text || "Unnamed",
        address: p.formattedAddress || "",
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        types: p.types || [],
      }));

      return { ok: true as const, places };
    } catch (e) {
      return {
        ok: false as const,
        error: `Invalid response from Places API: ${rawText.substring(0, 100)}`,
        places: [],
      };
    }
  });

// -------------------------------------------------------------------
// 4. FUNCTION 3: GET DIRECTIONS / ROUTE
// -------------------------------------------------------------------

export const getDirections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { origin: string; destination: string; mode?: string }) => d)
  .handler(async ({ data }) => {
    // Normalize travel mode: DRIVE, WALK, BICYCLE, TRANSIT
    const travelMode = (data.mode ?? "DRIVE").toUpperCase();

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
        travelMode: travelMode,
      }),
    });

    console.log("🔢 [getDirections] HTTP Status:", r.status);

    const rawText = await r.text();
    console.log("📄 [getDirections] Raw (first 200):", rawText.substring(0, 200));

    try {
      const json = JSON.parse(rawText);

      if (json.error) {
        return {
          ok: false as const,
          error: json.error.message || "Routes API error",
        };
      }

      const route = json.routes?.[0];
      if (!route) {
        return {
          ok: false as const,
          error: "No route found between these locations",
        };
      }

      return {
        ok: true as const,
        distanceMeters: route.distanceMeters as number,
        duration: route.duration as string, // Format: "1234s"
        polyline: route.polyline?.encodedPolyline as string,
        startLocation: route.legs?.[0]?.startLocation,
        endLocation: route.legs?.[0]?.endLocation,
      };
    } catch (e) {
      return {
        ok: false as const,
        error: `Invalid response from Routes API: ${rawText.substring(0, 100)}`,
      };
    }
  });
