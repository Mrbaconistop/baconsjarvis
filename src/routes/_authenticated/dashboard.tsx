import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { QuickActionBar } from "@/components/jarvis/QuickActionBar";
import { PriorityHub } from "@/components/jarvis/PriorityHub";
import { PageHeader } from "@/components/jarvis/HudBits";
import { useRealtimeRefresh } from "@/components/jarvis/useRealtimeRefresh";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { morningBriefing } from "@/lib/jarvis.functions";
import { listFeeds } from "@/lib/social.functions";
import {
  getWeather,
  getWeatherForecast,
  getWeatherNarrative,
  getWeatherLocation,
  setWeatherLocation,
} from "@/lib/jarvis.functions";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Cloud, Droplets, Wind, RefreshCw, MapPin, Calendar, Sun, CloudRain, Snowflake } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { formatRelative } from "@/lib/time-utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Command Center — JARVIS" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useRouteContext({ from: "/_authenticated" });
  useRealtimeRefresh(user.id);
  const qc = useQueryClient();

  const list = useServerFn(listFeeds);
  const brief = useServerFn(morningBriefing);
  const getWeatherFn = useServerFn(getWeather);
  const getForecastFn = useServerFn(getWeatherForecast);
  const getNarrativeFn = useServerFn(getWeatherNarrative);
  const getLocationFn = useServerFn(getWeatherLocation);
  const setLocationFn = useServerFn(setWeatherLocation);

  const weatherQuery = useQuery({
    queryKey: ["weather"],
    queryFn: () => getWeatherFn(),
    staleTime: 10 * 60 * 1000,
  });
  const forecastQuery = useQuery({
    queryKey: ["weather-forecast"],
    queryFn: () => getForecastFn(),
    staleTime: 10 * 60 * 1000,
  });
  const narrativeQuery = useQuery({
    queryKey: ["weather-narrative"],
    queryFn: () => getNarrativeFn(),
    staleTime: 10 * 60 * 1000,
  });
  const locationQuery = useQuery({
    queryKey: ["weather-location"],
    queryFn: () => getLocationFn(),
    staleTime: Infinity,
  });

  const { data: places = [] } = useQuery({
    queryKey: ["map_places"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("map_places")
        .select("id, label, address, lat, lng")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: feeds } = useQuery({ queryKey: ["feeds"], queryFn: () => list() });
  const [busy, setBusy] = useState(false);

  async function generateBriefing() {
    setBusy(true);
    try {
      await brief();
      toast.success("Briefing ready, Sir.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate briefing");
    } finally {
      setBusy(false);
    }
  }

  async function handleLocationChange(placeId: string) {
    try {
      await setLocationFn({ data: { placeId } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["weather-location"] }),
        qc.invalidateQueries({ queryKey: ["weather"] }),
        qc.invalidateQueries({ queryKey: ["weather-forecast"] }),
        qc.invalidateQueries({ queryKey: ["weather-narrative"] }),
      ]);
      toast.success("Weather location updated.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update location");
    }
  }

  const currentLocation = locationQuery.data;
  const selectedPlaceId = currentLocation?.id || "";

  const getWeatherIcon = (iconCode: string) => {
    const iconMap: Record<string, any> = {
      "01d": Sun,
      "01n": Sun,
      "02d": Cloud,
      "02n": Cloud,
      "03d": Cloud,
      "03n": Cloud,
      "04d": Cloud,
      "04n": Cloud,
      "09d": CloudRain,
      "09n": CloudRain,
      "10d": CloudRain,
      "10n": CloudRain,
      "11d": CloudRain,
      "11n": CloudRain,
      "13d": Snowflake,
      "13n": Snowflake,
    };
    return iconMap[iconCode] || Cloud;
  };

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag="00 · COMMAND"
        title="Welcome back, Sir."
        subtitle="Triaged signals, ranked by what deserves your attention."
        right={
          <div className="flex gap-2">
            <button
              onClick={generateBriefing}
              disabled={busy}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md bg-arc text-arc-foreground shadow-arc hover:opacity-90 transition disabled:opacity-50"
            >
              <Sparkles size={12} /> Generate briefing
            </button>
          </div>
        }
      />

      <LiveTicker feeds={feeds ?? []} />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        <QuickActionBar />

        {/* Weather Widget */}
        <div className="glass-strong hud-corners rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-[10px] tracking-[0.3em] text-arc flex items-center gap-2">
              <Cloud size={14} /> WEATHER
            </div>
            <div className="flex items-center gap-2">
              {places.length > 0 && (
                <div className="relative">
                  <select
                    value={selectedPlaceId}
                    onChange={(e) => handleLocationChange(e.target.value)}
                    className="bg-background/60 border border-arc/20 rounded-md px-2 py-1 text-xs font-mono focus:border-arc focus:outline-none"
                  >
                    <option value="">Select location</option>
                    {places.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                onClick={() => {
                  weatherQuery.refetch();
                  forecastQuery.refetch();
                  narrativeQuery.refetch();
                }}
                disabled={weatherQuery.isFetching || forecastQuery.isFetching || narrativeQuery.isFetching}
                className="text-hud-dim hover:text-arc transition disabled:opacity-50"
              >
                <RefreshCw
                  size={14}
                  className={
                    weatherQuery.isFetching || forecastQuery.isFetching || narrativeQuery.isFetching
                      ? "animate-spin"
                      : ""
                  }
                />
              </button>
            </div>
          </div>

          {weatherQuery.isLoading && <div className="text-sm text-muted-foreground">Fetching weather…</div>}
          {weatherQuery.error && <div className="text-sm text-critical">Could not load weather.</div>}
          {weatherQuery.data && (
            <div className="flex items-center gap-6">
              <div className="text-center">
                <img
                  src={`https://openweathermap.org/img/wn/${weatherQuery.data.icon}@2x.png`}
                  alt={weatherQuery.data.description}
                  className="w-16 h-16"
                />
                <div className="font-display text-3xl text-glow">{Math.round(weatherQuery.data.temperature)}°C</div>
                <div className="text-sm capitalize text-muted-foreground">{weatherQuery.data.description}</div>
              </div>
              <div className="flex-1 grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Droplets size={14} className="text-arc" />
                  <span>Humidity: {weatherQuery.data.humidity}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <Wind size={14} className="text-arc" />
                  <span>Wind: {Math.round(weatherQuery.data.windSpeed * 3.6)} km/h</span>
                </div>
                <div className="col-span-2 flex items-center gap-2 text-muted-foreground">
                  <MapPin size={14} />
                  <span>
                    {weatherQuery.data.city}, {weatherQuery.data.country}
                    {currentLocation && ` (${currentLocation.label})`}
                  </span>
                </div>
              </div>
            </div>
          )}

          {narrativeQuery.isLoading && <div className="text-sm text-muted-foreground mt-3">Generating narrative…</div>}
          {narrativeQuery.data && (
            <div className="mt-3 p-3 rounded-md bg-arc/5 border border-arc/20">
              <div className="font-mono text-[10px] text-arc mb-1">JARVIS SAYS</div>
              <p className="text-sm">{narrativeQuery.data.narrative}</p>
            </div>
          )}

          {forecastQuery.isLoading && <div className="text-sm text-muted-foreground mt-3">Loading forecast…</div>}
          {forecastQuery.data && (
            <div className="mt-4">
              <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-2 flex items-center gap-2">
                <Calendar size={12} /> 5‑DAY FORECAST
              </div>
              <div className="grid grid-cols-5 gap-2">
                {forecastQuery.data.forecasts.map((day: any) => {
                  const Icon = getWeatherIcon(day.icon);
                  return (
                    <div key={day.date} className="text-center p-2 rounded-md bg-background/40 border border-arc/10">
                      <div className="font-mono text-xs">{day.day}</div>
                      <Icon size={20} className="mx-auto my-1 text-arc" />
                      <div className="font-display text-sm">{day.temp}°C</div>
                      <div className="text-[10px] text-hud-dim capitalize">{day.description}</div>
                      {day.pop > 0 && <div className="text-[10px] text-hud-dim">🌧️ {day.pop}%</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {places.length === 0 && (
            <div className="text-xs text-hud-dim mt-2">Save a place on the Map page to set your weather location.</div>
          )}
        </div>

        <PriorityHub />
      </div>
    </div>
  );
}

function LiveTicker({ feeds }: { feeds: any[] }) {
  if (!feeds.length) return null;
  const items = feeds.slice(0, 12);
  return (
    <div className="border-y border-arc/10 bg-background/30 overflow-hidden">
      <div className="flex whitespace-nowrap animate-ticker py-2">
        {[...items, ...items].map((f, i) => (
          <span key={i} className="font-mono text-xs text-hud-dim mx-6 inline-flex items-center gap-2">
            <span className="text-arc">[{f.platform.toUpperCase()}]</span>
            <span
              className={
                f.sentiment_label === "negative"
                  ? "text-critical"
                  : f.sentiment_label === "positive"
                    ? "text-success"
                    : ""
              }
            >
              {f.author_name}
            </span>
            <span className="opacity-70">
              — {f.content.slice(0, 80)}
              {f.content.length > 80 ? "…" : ""}
            </span>
            <span className="text-hud-dim/60">· {formatRelative(f.received_at)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
