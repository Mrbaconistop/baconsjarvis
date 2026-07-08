import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * System health snapshot: DB reachable, key secrets present (server-side only),
 * cron job state, and a few table counts. Zero external calls.
 */
export const getSystemHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const t0 = Date.now();

    // DB ping
    let dbOk = true;
    let dbErr: string | null = null;
    try {
      const { error } = await supabase.from("profiles").select("id", { head: true, count: "exact" }).limit(1);
      if (error) { dbOk = false; dbErr = error.message; }
    } catch (e: any) {
      dbOk = false; dbErr = e?.message ?? String(e);
    }
    const dbPingMs = Date.now() - t0;

    // Secret presence (booleans — never expose values)
    const secrets = {
      DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,
      GROQ_API_KEY: !!process.env.GROQ_API_KEY,
      LOVABLE_API_KEY: !!process.env.LOVABLE_API_KEY,
      FINNHUB_API_KEY: !!process.env.FINNHUB_API_KEY,
      CRON_SECRET: !!process.env.CRON_SECRET,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      GOOGLE_MAPS_API_KEY: !!process.env.GOOGLE_MAPS_API_KEY,
      GOOGLE_CALENDAR_API_KEY: !!process.env.GOOGLE_CALENDAR_API_KEY,
      GOOGLE_MAIL_API_KEY: !!process.env.GOOGLE_MAIL_API_KEY,
    };

    // Counts (own user only, via RLS)
    async function count(table: string) {
      const { count, error } = await (supabase as any).from(table).select("id", { head: true, count: "exact" });
      return error ? null : (count ?? 0);
    }
    const [messagesCount, threadsCount, notificationsCount, factsCount] = await Promise.all([
      count("chat_messages"),
      count("chat_threads"),
      count("notifications"),
      count("user_facts"),
    ]);

    // Last watcher run (global)
    const { data: lastWatcher } = await supabase
      .from("watcher_runs").select("watcher, ok, ran_at, duration_ms, error")
      .order("ran_at", { ascending: false }).limit(1);

    return {
      ts: new Date().toISOString(),
      db: { ok: dbOk, pingMs: dbPingMs, error: dbErr },
      secrets,
      counts: { messagesCount, threadsCount, notificationsCount, factsCount },
      lastWatcher: lastWatcher?.[0] ?? null,
    };
  });

/**
 * Return the current user's recent router traces.
 */
export const getRouterTraces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { limit?: number } = {}) => ({ limit: Math.min(Math.max(data.limit ?? 25, 1), 100) }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("router_traces")
      .select("id, created_at, intent, provider, model_id, has_image, user_text_snippet, prefs, recalled_count, thread_id")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Return recent watcher runs (global).
 */
export const getWatcherRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { limit?: number } = {}) => ({ limit: Math.min(Math.max(data.limit ?? 25, 1), 100) }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("watcher_runs")
      .select("id, ran_at, watcher, ok, meta, error, duration_ms")
      .order("ran_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Run the memory recall RPC for a given query — inspector for the FTS memory layer.
 */
export const runMemoryRecall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(20).optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const t0 = Date.now();
    const { data: rows, error } = await supabase.rpc("recall_chat_memory", {
      _user_id: userId,
      _query: data.query,
      _limit: data.limit ?? 5,
    });
    if (error) throw new Error(error.message);
    return { ms: Date.now() - t0, rows: rows ?? [] };
  });
