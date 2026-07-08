/**
 * Weather watcher — notifies on state changes for each user with a saved home place.
 * Uses Open-Meteo (free, no API key). Compares against last state stored in user_facts.
 */

interface Snapshot {
  code: number;
  temp: number;
  ts: string;
}

const WEATHER_LABEL: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow",
  80: "Showers", 81: "Showers", 82: "Violent showers",
  95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Severe thunderstorm",
};

function isPrecip(code: number): boolean {
  return code >= 51;
}

export async function runWeatherWatcher(supabaseAdmin: any) {
  // Pull one saved place per user (the first one). Small scale for now.
  const { data: places, error } = await supabaseAdmin
    .from("map_places")
    .select("user_id, label, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .limit(200);
  if (error) throw error;
  if (!places?.length) return { checked: 0, alerts: 0 };

  // De-dupe to one place per user
  const seen = new Set<string>();
  const targets = places.filter((p: any) => {
    if (seen.has(p.user_id)) return false;
    seen.add(p.user_id);
    return true;
  });

  let checked = 0;
  let alerts = 0;

  for (const place of targets as any[]) {
    checked++;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lng}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`);
      if (!r.ok) continue;
      const j = await r.json();
      const code = Number(j?.current?.weather_code);
      const temp = Number(j?.current?.temperature_2m);
      if (!isFinite(code) || !isFinite(temp)) continue;

      // Load previous snapshot from user_facts
      const { data: prevRow } = await supabaseAdmin
        .from("user_facts")
        .select("value")
        .eq("user_id", place.user_id)
        .eq("category", "watcher")
        .eq("key", "weather_last")
        .maybeSingle();

      let prev: Snapshot | null = null;
      if (prevRow?.value) { try { prev = JSON.parse(prevRow.value); } catch {} }

      const snap: Snapshot = { code, temp, ts: new Date().toISOString() };

      let notify: { title: string; msg: string } | null = null;
      if (prev) {
        const startedRain = !isPrecip(prev.code) && isPrecip(code);
        const stoppedRain = isPrecip(prev.code) && !isPrecip(code);
        const bigSwing = Math.abs(temp - prev.temp) >= 15;
        const severe = code >= 95 && prev.code < 95;

        if (severe) notify = { title: "Severe weather", msg: `${WEATHER_LABEL[code] ?? "Severe conditions"} at ${place.label ?? "your location"}, Sir.` };
        else if (startedRain) notify = { title: "Rain starting", msg: `${WEATHER_LABEL[code] ?? "Precipitation"} beginning at ${place.label ?? "your location"}.` };
        else if (stoppedRain) notify = { title: "Rain clearing", msg: `Precipitation is stopping at ${place.label ?? "your location"}. Now ${WEATHER_LABEL[code] ?? "clearing"}.` };
        else if (bigSwing) notify = { title: `Temperature shift ${temp > prev.temp ? "↑" : "↓"}`, msg: `Now ${temp.toFixed(0)}°F at ${place.label ?? "your location"} (was ${prev.temp.toFixed(0)}°F).` };
      }

      if (notify) {
        await supabaseAdmin.from("notifications").insert({
          user_id: place.user_id,
          type: "system",
          priority: "normal",
          title: notify.title,
          message: notify.msg,
          source_table: "watcher",
          action_payload: snap,
        });
        alerts++;
      }

      await supabaseAdmin.from("user_facts").upsert(
        { user_id: place.user_id, category: "watcher", key: "weather_last", value: JSON.stringify(snap) },
        { onConflict: "user_id,category,key" },
      );
    } catch (e) {
      console.warn("[weather] failed for user", place.user_id, e);
    }
  }

  return { checked, alerts };
}
