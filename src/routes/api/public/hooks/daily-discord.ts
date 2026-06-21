import { createFileRoute } from "@tanstack/react-router";

const GMAIL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const GCAL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";

async function gw(url: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.LOVABLE_API_KEY!}`,
      "X-Connection-Api-Key": url.startsWith(GMAIL)
        ? process.env.GOOGLE_MAIL_API_KEY!
        : process.env.GOOGLE_CALENDAR_API_KEY!,
    },
  });
  if (!res.ok) throw new Error(`${url} ${res.status}: ${await res.text()}`);
  return res.json();
}

function decodeB64Url(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return atob(s); } catch { return ""; }
}

async function fetchEmailDigest(): Promise<string[]> {
  try {
    const list = await gw(`${GMAIL}/users/me/messages?maxResults=8&q=${encodeURIComponent("newer_than:1d in:inbox -category:promotions -category:social")}`);
    const ids: string[] = (list.messages ?? []).slice(0, 8).map((m: any) => m.id);
    const rows: string[] = [];
    for (const id of ids) {
      const msg = await gw(`${GMAIL}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      const h = msg.payload?.headers ?? [];
      const from = h.find((x: any) => x.name === "From")?.value ?? "?";
      const subj = h.find((x: any) => x.name === "Subject")?.value ?? "(no subject)";
      const cleanFrom = from.replace(/<.*?>/, "").replace(/"/g, "").trim().slice(0, 40);
      rows.push(`• **${cleanFrom}** — ${subj.slice(0, 80)}`);
    }
    return rows.length ? rows : ["• No new mail in the last 24h."];
  } catch (e) {
    return [`• Email fetch failed: ${String(e).slice(0, 100)}`];
  }
}

async function fetchCalendarAgenda(): Promise<string[]> {
  try {
    const now = new Date();
    const end = new Date(now.getTime() + 24 * 3600 * 1000);
    const url = `${GCAL}/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=10`;
    const data = await gw(url);
    const items: any[] = data.items ?? [];
    if (!items.length) return ["• Nothing on the calendar."];
    return items.map((ev) => {
      const start = ev.start?.dateTime ?? ev.start?.date ?? "";
      const t = start.includes("T")
        ? new Date(start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "All day";
      return `• \`${t}\` ${ev.summary ?? "(untitled)"}`;
    });
  } catch (e) {
    return [`• Calendar fetch failed: ${String(e).slice(0, 100)}`];
  }
}

async function postWebhook(url: string, embeds: any[]) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "JARVIS", embeds }),
  });
  if (!res.ok) throw new Error(`discord ${res.status}: ${await res.text()}`);
}

async function sendForUser(userId: string, hook: any) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const today = new Date().toISOString().slice(0, 10);

  const sections: { name: string; value: string }[] = [];

  if (hook.include_email) {
    const lines = await fetchEmailDigest();
    sections.push({ name: "📬 Inbox (last 24h)", value: lines.slice(0, 8).join("\n").slice(0, 1024) });
  }
  if (hook.include_calendar) {
    const lines = await fetchCalendarAgenda();
    sections.push({ name: "📅 Today's agenda", value: lines.slice(0, 10).join("\n").slice(0, 1024) });
  }
  if (hook.include_reminders) {
    const { data: rem } = await supabaseAdmin
      .from("reminders")
      .select("title, datetime, priority")
      .eq("user_id", userId)
      .eq("is_completed", false)
      .gte("datetime", today + "T00:00:00Z")
      .lt("datetime", today + "T23:59:59Z")
      .order("datetime", { ascending: true })
      .limit(10);
    const lines = (rem ?? []).map((r: any) => {
      const t = new Date(r.datetime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `• \`${t}\` ${r.title}${r.priority === "high" ? " ⚠️" : ""}`;
    });
    sections.push({ name: "⏰ Reminders due today", value: lines.length ? lines.join("\n").slice(0, 1024) : "• Nothing due." });
  }
  if (hook.include_spending) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: tx } = await supabaseAdmin
      .from("transactions")
      .select("amount_cents")
      .eq("user_id", userId)
      .gte("occurred_at", since);
    const totalCents = (tx ?? []).reduce((s: number, r: any) => s + (r.amount_cents > 0 ? r.amount_cents : 0), 0);
    sections.push({ name: "💸 Spent in last 24h", value: `$${(totalCents / 100).toFixed(2)} across ${tx?.length ?? 0} txns` });
  }
  if (hook.include_checkin) {
    const { data: ci } = await supabaseAdmin
      .from("daily_checkins")
      .select("weight_lbs, mood, energy, sleep_hours")
      .eq("user_id", userId)
      .eq("day", today)
      .maybeSingle();
    const val = ci
      ? `Weight: ${ci.weight_lbs ?? "—"} lbs · Mood: ${ci.mood ?? "—"} · Energy: ${ci.energy ?? "—"}/10 · Sleep: ${ci.sleep_hours ?? "—"}h`
      : "⚠️ No check-in logged yet today. Open JARVIS → Settings to record weight, mood, and sleep.";
    sections.push({ name: "🧬 Daily check-in", value: val });
  }

  const embed = {
    title: `Daily Briefing — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`,
    color: 0x00d4ff,
    fields: sections,
    footer: { text: "JARVIS · at your service, Sir" },
    timestamp: new Date().toISOString(),
  };

  await postWebhook(hook.url, [embed]);
  await supabaseAdmin.from("discord_webhooks").update({ last_sent_at: new Date().toISOString() }).eq("id", hook.id);
}

export const Route = createFileRoute("/api/public/hooks/daily-discord")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const url = new URL(request.url);
        const targetUserId = url.searchParams.get("user_id"); // optional manual trigger
        const isCron = apikey === process.env.SUPABASE_PUBLISHABLE_KEY;

        // For ad-hoc testing, allow bearer-authed user to fire their own
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
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: hooks } = await supabaseAdmin
            .from("discord_webhooks").select("*").eq("user_id", u.user.id).eq("enabled", true);
          let sent = 0;
          for (const h of hooks ?? []) {
            try { await sendForUser(u.user.id, h); sent++; } catch (e) { console.error("hook fail", e); }
          }
          return Response.json({ ok: true, sent });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let q = supabaseAdmin.from("discord_webhooks").select("*").eq("enabled", true);
        if (targetUserId) q = q.eq("user_id", targetUserId);
        const { data: hooks } = await q;
        let sent = 0;
        for (const h of hooks ?? []) {
          try { await sendForUser(h.user_id, h); sent++; } catch (e) { console.error("hook fail", h.id, e); }
        }
        return Response.json({ ok: true, sent, total: hooks?.length ?? 0 });
      },
    },
  },
});
