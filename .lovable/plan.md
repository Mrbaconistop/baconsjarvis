## Goal
Build a full interactive Map page at `/map` using Google Maps, and give the Jarvis chat AI tools so it can interact with the map (pan/zoom, drop markers, search places, draw routes, save locations).

## Steps

### 1. Connect Google Maps Platform
Use `standard_connectors--connect` with `google_maps`. This exposes:
- `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` — browser key for Maps JS API
- `GOOGLE_MAPS_API_KEY` — server gateway key (used via Lovable connector gateway for Places / Geocoding / Routes)

### 2. Database: `map_places` table
Stores user-saved locations so the AI can persist + recall pins.

Columns: `id`, `user_id`, `label`, `address`, `lat`, `lng`, `notes`, `place_id`, `category`, `color`, `created_at`.
Includes GRANTs to `authenticated` + `service_role`, RLS policies scoped to `auth.uid()`.

### 3. Map page — `src/routes/_authenticated/map.tsx`
- Loads Maps JS asynchronously (`loading=async&callback=initMap`) with the browser key.
- Full-bleed map filling the AppShell main area, JARVIS HUD styling (arc-blue controls, glass overlay panels).
- Left overlay panel: list of saved places (live via TanStack Query on `map_places`), with click-to-fly-to + delete.
- Top overlay: search box using Places API (New) `AutocompleteSuggestion` for place autocomplete; selecting a result drops a marker and centers.
- Bottom-right controls: recenter on user geolocation, toggle satellite/roadmap, clear temporary markers.
- Uses `google.maps.Marker` only (no AdvancedMarkerElement, no `mapId`).

### 4. Client ↔ AI bridge
A lightweight singleton (`src/lib/mapBus.ts`) exposes imperative methods (`flyTo`, `addMarker`, `clearMarkers`, `getViewport`, `getMarkers`) the Map page registers on mount. The chat tool executors call this bus when the user is on `/map`; otherwise tools fall back to DB-only changes so the AI still works from any page.

### 5. New AI tools in `src/routes/api/chat.ts`
Added alongside existing `tools` object (no other tools touched):
- `search_places(query, near?)` — Places API (New) `places:searchText` via gateway; returns top 5 with names, addresses, coords.
- `geocode_address(address)` — Geocoding via gateway; returns lat/lng + formatted address.
- `save_place({ label, address|lat/lng, notes?, category? })` — geocodes if needed, inserts into `map_places`, then asks the bus to drop a pin if the map is open.
- `list_saved_places()` — reads `map_places` for the user.
- `delete_saved_place(id)` — removes a place.
- `show_on_map({ lat, lng, zoom? })` — pans/zooms the live map via the bus (no-op with friendly message if map page not open).
- `get_directions(origin, destination, mode?)` — Routes API `computeRoutes` via gateway; returns distance, duration, and an encoded polyline; if map is open, draws the route.

All server-side calls go through `https://connector-gateway.lovable.dev/google_maps/...` with `Authorization: Bearer ${LOVABLE_API_KEY}` and `X-Connection-Api-Key: ${GOOGLE_MAPS_API_KEY}` per connector rules.

### 6. Navigation
Add `{ to: "/map", label: "Map", icon: MapPin, tag: "09" }` to the `NAV` array in `src/components/jarvis/AppShell.tsx`.

## Technical notes
- No `@react-google-maps/api` package — load the script tag directly per Google Maps connector guidance.
- Browser key is only used for Maps JS + Places autocomplete; geocoding/routes/text-search go through the server gateway from new server functions in `src/lib/maps.functions.ts` so the chat tools can reuse them.
- Map bus is browser-only state (window-scoped); chat tools running on the server return a hint payload like `{ ok: true, pending_client_action: "flyTo", ... }` that the chat UI dispatches to the bus on receipt (small handler in the existing chat message renderer).

## Files
- new: `supabase/migrations/<ts>_map_places.sql`
- new: `src/routes/_authenticated/map.tsx`
- new: `src/lib/mapBus.ts`
- new: `src/lib/maps.functions.ts` (server fns for geocode/search/routes used by both the page and chat tools)
- edit: `src/components/jarvis/AppShell.tsx` (add nav item)
- edit: `src/routes/api/chat.ts` (append map tools to `tools` object)
- edit: chat message renderer to forward `pending_client_action` tool results to the map bus
