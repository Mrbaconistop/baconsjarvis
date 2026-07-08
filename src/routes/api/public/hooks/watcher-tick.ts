import { createFileRoute } from "@tanstack/react-router";

/**
 * Proactive watcher — hit every 5 min by pg_cron.
 * Runs cheap checks per user and writes to `notifications` when a threshold trips.
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

        try {
          results.stocks = await runStockWatcher(supabaseAdmin);
        } catch (e: any) {
          console.error("[watcher] stocks failed", e);
          results.stocks = { error: e?.message ?? String(e) };
        }

        try {
          results.weather = await runWeatherWatcher(supabaseAdmin);
        } catch (e: any) {
          console.error("[watcher] weather failed", e);
          results.weather = { error: e?.message ?? String(e) };
        }

        return Response.json({ ok: true, ts: new Date().toISOString(), ...results });
      },
    },
  },
});
