import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/daily-discord")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const url = new URL(request.url);
        const targetUserId = url.searchParams.get("user_id");
        const isCron = apikey === process.env.SUPABASE_PUBLISHABLE_KEY;

        const { sendForUserHooks } = await import("@/lib/discord.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (!isCron) {
          const auth = request.headers.get("authorization") ?? "";
          if (!auth.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
          const { createClient } = await import("@supabase/supabase-js");
          const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
            global: { headers: { Authorization: auth } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: u } = await sb.auth.getUser();
          if (!u?.user) return new Response("Unauthorized", { status: 401 });
          const { data: hooks } = await supabaseAdmin
            .from("discord_webhooks").select("*").eq("user_id", u.user.id).eq("enabled", true);
          let sent = 0;
          for (const h of hooks ?? []) {
            try { await sendForUserHooks(u.user.id, h); sent++; } catch (e) { console.error("hook fail", e); }
          }
          return Response.json({ ok: true, sent });
        }

        let q = supabaseAdmin.from("discord_webhooks").select("*").eq("enabled", true);
        if (targetUserId) q = q.eq("user_id", targetUserId);
        const { data: hooks } = await q;
        let sent = 0;
        for (const h of hooks ?? []) {
          try { await sendForUserHooks(h.user_id, h); sent++; } catch (e) { console.error("hook fail", h.id, e); }
        }
        return Response.json({ ok: true, sent, total: hooks?.length ?? 0 });
      },
    },
  },
});
