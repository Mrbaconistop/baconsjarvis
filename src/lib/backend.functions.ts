import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const USER_TABLES = [
  "profiles",
  "chat_messages",
  "chat_threads",
  "reminders",
  "notifications",
  "social_feeds",
  "vault_items",
  "user_facts",
  "user_roles",
  "connected_accounts",
  "discord_webhooks",
  "map_places",
  "cash_balances",
  "stock_holdings",
  "transactions",
  "engagement_stats",
  "daily_checkins",
] as const;

// Known env / secret names this app uses. We only report whether each is present —
// never the value. Connector-managed secrets are flagged.
const KNOWN_SECRETS: { name: string; description: string; managed?: string }[] = [
  { name: "LOVABLE_API_KEY", description: "Lovable AI Gateway access" },
  { name: "GROQ_API_KEY", description: "Groq fast inference" },
  { name: "SUPABASE_URL", description: "Backend URL" },
  { name: "SUPABASE_PUBLISHABLE_KEY", description: "Backend publishable key (safe to expose)" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", description: "Backend service role (server-only)" },
  { name: "SUPABASE_DB_URL", description: "Postgres connection string" },
  { name: "GOOGLE_MAPS_API_KEY", description: "Google Maps server", managed: "google_maps connector" },
  { name: "GOOGLE_MAPS_BROWSER_KEY", description: "Google Maps browser", managed: "google_maps connector" },
  { name: "GOOGLE_MAPS_TRACKING_ID", description: "Maps tracking ID", managed: "google_maps connector" },
  { name: "GOOGLE_CALENDAR_API_KEY", description: "Google Calendar", managed: "google_calendar connector" },
  { name: "GOOGLE_MAIL_API_KEY", description: "Gmail", managed: "google_mail connector" },
];

export const getBackendOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;

    const counts = await Promise.all(
      USER_TABLES.map(async (t) => {
        const { count, error } = await supabase
          .from(t)
          .select("*", { count: "exact", head: true })
          .limit(1);
        return { table: t, rows: error ? null : count ?? 0, error: error?.message ?? null };
      }),
    );

    const secrets = KNOWN_SECRETS.map((s) => ({
      ...s,
      present: typeof process.env[s.name] === "string" && process.env[s.name]!.length > 0,
    }));

    const connection = {
      project_url: process.env.SUPABASE_URL ?? null,
      publishable_key_present: !!process.env.SUPABASE_PUBLISHABLE_KEY,
      service_role_present: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      user_id: userId,
    };

    return { tables: counts, secrets, connection };
  });

export const previewTable = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ table: z.enum(USER_TABLES as unknown as [string, ...string[]]), limit: z.number().int().min(1).max(50).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: rows, error } = await supabase
      .from(data.table)
      .select("*")
      .limit(data.limit ?? 10);
    if (error) throw error;
    return rows ?? [];
  });
