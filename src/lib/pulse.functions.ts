import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listEngagement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const [{ data: stats }, { data: reminders }] = await Promise.all([
      supabase.from("engagement_stats").select("*").eq("user_id", userId).gte("stat_date", since),
      supabase.from("reminders").select("datetime").eq("user_id", userId).gte("datetime", since),
    ]);
    return { stats: stats ?? [], reminders: reminders ?? [] };
  });
