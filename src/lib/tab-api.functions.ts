import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fhQuote, fhProfile, fhFinancials, fhNews, fhSearch, fetchHistorical } from "./finnhub.server";

// Whitelisted API actions callable from custom tab iframes.
// Secrets never leave the server; iframes only see JSON results.
const Input = z.object({
  action: z.string().min(1).max(60),
  params: z.record(z.string(), z.any()).optional(),
});

async function openWeather(path: "weather" | "forecast", params: Record<string, any>) {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) throw new Error("OPENWEATHER_API_KEY not configured");
  const url = new URL(`https://api.openweathermap.org/data/2.5/${path}`);
  url.searchParams.set("appid", key);
  url.searchParams.set("units", String(params.units || "metric"));
  for (const [k, v] of Object.entries(params)) {
    if (k === "units") continue;
    if (v != null) url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`OpenWeather ${r.status}`);
  return r.json();
}

async function openMeteo(params: Record<string, any>) {
  const lat = params.lat ?? params.latitude;
  const lon = params.lon ?? params.lng ?? params.longitude;
  if (lat == null || lon == null) throw new Error("lat/lon required");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "current",
    String(params.current || "temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m"),
  );
  if (params.daily) url.searchParams.set("daily", String(params.daily));
  if (params.hourly) url.searchParams.set("hourly", String(params.hourly));
  url.searchParams.set("temperature_unit", String(params.temperature_unit || "fahrenheit"));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  return r.json();
}

export const callTabApi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }) => {
    const p = data.params || {};
    try {
      switch (data.action) {
        // ---- Finnhub / stocks ----
        case "stock.quote": return { ok: true, data: await fhQuote(String(p.symbol).toUpperCase()) };
        case "stock.profile": return { ok: true, data: await fhProfile(String(p.symbol).toUpperCase()) };
        case "stock.financials": return { ok: true, data: await fhFinancials(String(p.symbol).toUpperCase()) };
        case "stock.news": return { ok: true, data: await fhNews(String(p.symbol).toUpperCase()) };
        case "stock.search": return { ok: true, data: await fhSearch(String(p.q)) };
        case "stock.candles": {
          const range = (p.range || "1y") as "1y" | "2y" | "5y";
          const interval = (p.interval || "1d") as "1d" | "1wk";
          return { ok: true, data: await fetchHistorical(String(p.symbol).toUpperCase(), range, interval) };
        }

        // ---- Weather ----
        case "weather.current": return { ok: true, data: await openWeather("weather", p) };
        case "weather.forecast": return { ok: true, data: await openWeather("forecast", p) };
        case "weather.meteo": return { ok: true, data: await openMeteo(p) };

        // ---- Generic (only allow-listed public read APIs, no key required) ----
        case "http.get": {
          const url = String(p.url);
          const allow = [
            /^https:\/\/api\.open-meteo\.com\//,
            /^https:\/\/api\.coingecko\.com\//,
            /^https:\/\/api\.github\.com\//,
            /^https:\/\/query1\.finance\.yahoo\.com\//,
            /^https:\/\/hn\.algolia\.com\//,
            /^https:\/\/en\.wikipedia\.org\/api\//,
          ];
          if (!allow.some((rx) => rx.test(url))) throw new Error("URL not in allowlist");
          const r = await fetch(url, { headers: { "User-Agent": "JarvisTab/1.0" } });
          const ct = r.headers.get("content-type") || "";
          const body = ct.includes("json") ? await r.json() : await r.text();
          return { ok: true, data: body, status: r.status };
        }

        // ---- Discovery ----
        case "list": return {
          ok: true,
          data: [
            "stock.quote", "stock.profile", "stock.financials", "stock.news",
            "stock.search", "stock.candles",
            "weather.current", "weather.forecast", "weather.meteo",
            "http.get",
          ],
        };

        default:
          return { ok: false, error: `Unknown action: ${data.action}` };
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || "call failed" };
    }
  });
