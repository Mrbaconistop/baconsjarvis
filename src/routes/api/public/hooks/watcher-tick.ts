import { createFileRoute } from "@tanstack/react-router";

/**
 * Proactive watcher — hit every 5 min by pg_cron.
 * Runs cheap checks per user and writes to `notifications` when a threshold trips.
 * Also logs each watcher run into `watcher_runs` for the diagnostics panel.
 */
export const Route = createFileRoute("/api/public/hooks/watcher-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = request.headers.get("x-cron-secret");
        if (!secret || secret !== process.env.CRON_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runStockWatcher } = await import("@/lib/watchers/stocks.server");
        const { runWeatherWatcher } = await import("@/lib/watchers/weather.server");

        const results: Record<string, any> = {};

        async function runAndLog(name: string, fn: () => Promise<any>) {
          const t0 = Date.now();
          try {
            const meta = await fn();
            const dur = Date.now() - t0;
            results[name] = meta;
            await supabaseAdmin.from("watcher_runs").insert({
              watcher: name, ok: true, meta: meta ?? {}, duration_ms: dur,
            });
          } catch (e: any) {
            const dur = Date.now() - t0;
            const err = e?.message ?? String(e);
            console.error(`[watcher] ${name} failed`, e);
            results[name] = { error: err };
            await supabaseAdmin.from("watcher_runs").insert({
              watcher: name, ok: false, error: err, duration_ms: dur,
            });
          }
        }

        await runAndLog("stocks", () => runStockWatcher(supabaseAdmin));
        await runAndLog("weather", () => runWeatherWatcher(supabaseAdmin));

        return Response.json({ ok: true, ts: new Date().toISOString(), ...results });
      },
    },
  },
});
