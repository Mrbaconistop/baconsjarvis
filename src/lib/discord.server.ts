// Server-only: shared sender used by both the public cron route and the manual "fire now" server fn.
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
  if (!res.ok) throw new Error(`${url.split("?")[0]} ${res.status}`);
  return res.json();
}

async function emailLines(): Promise<string[]> {
  try {
    const list = await gw(`${GMAIL}/users/me/messages?maxResults=8&q=${encodeURIComponent("newer_than:1d in:inbox -category:promotions -category:social")}`);
    const ids: string[] = (list.messages ?? []).slice(0, 8).map((m: any) => m.id);
    const rows: string[] = [];
    for (const id of ids) {
      const msg = await gw(`${GMAIL}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      const h = msg.payload?.headers ?? [];
      const from = (h.find((x: any) => x.name === "From")?.value ?? "?").replace(/<.*?>/, "").replace(/"/g, "").trim().slice(0, 40);
      const subj = (h.find((x: any) => x.name === "Subject")?.value ?? "(no subject)").slice(0, 80);
      rows.push(`• **${from}** — ${subj}`);
    }
    return rows.length ? rows : ["• No new mail in the last 24h."];
  } catch (e) { return [`• Email unavailable.`]; }
}

async function calendarLines(): Promise<string[]> {
  try {
    const now = new Date();
    const end = new Date(now.getTime() + 24 * 3600 * 1000);
    const data = await gw(`${GCAL}/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=10`);
    const items: any[] = data.items ?? [];
    if (!items.length) return ["• Nothing on the calendar."];
    return items.map((ev) => {
      const start = ev.start?.dateTime ?? ev.start?.date ?? "";
      const t = start.includes("T")
        ? new Date(start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "All day";
      return `• \`${t}\` ${ev.summary ?? "(untitled)"}`;
    });
  } catch { return ["• Calendar unavailable."]; }
}

export async function sendForUserHooks(userId: string, hook: any) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const today = new Date().toISOString().slice(0, 10);
  const fields: { name: string; value: string }[] = [];

  if (hook.include_email) {
    const lines = await emailLines();
    fields.push({ name: "📬 Inbox (last 24h)", value: lines.join("\n").slice(0, 1024) });
  }
  if (hook.include_calendar) {
    const lines = await calendarLines();
    fields.push({ name: "📅 Today's agenda", value: lines.join("\n").slice(0, 1024) });
  }
  if (hook.include_reminders) {
    const { data: rem } = await supabaseAdmin
      .from("reminders").select("title, datetime, priority")
      .eq("user_id", userId).eq("is_completed", false)
      .gte("datetime", today + "T00:00:00Z").lt("datetime", today + "T23:59:59Z")
      .order("datetime", { ascending: true }).limit(10);
    const lines = (rem ?? []).map((r: any) => {
      const t = new Date(r.datetime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `• \`${t}\` ${r.title}${r.priority === "high" ? " ⚠️" : ""}`;
    });
    fields.push({ name: "⏰ Reminders due today", value: lines.length ? lines.join("\n").slice(0, 1024) : "• Nothing due." });
  }
  if (hook.include_spending) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: tx } = await supabaseAdmin
      .from("transactions").select("amount_cents").eq("user_id", userId).gte("occurred_at", since);
    const total = (tx ?? []).reduce((s: number, r: any) => s + (r.amount_cents > 0 ? r.amount_cents : 0), 0);
    fields.push({ name: "💸 Spent in last 24h", value: `$${(total / 100).toFixed(2)} across ${tx?.length ?? 0} txns` });
  }
  if (hook.include_checkin) {
    const { data: ci } = await supabaseAdmin
      .from("daily_checkins").select("*").eq("user_id", userId).eq("day", today).maybeSingle();
    fields.push({
      name: "🧬 Daily check-in",
      value: ci
        ? `Weight: ${ci.weight_lbs ?? "—"} lbs · Mood: ${ci.mood ?? "—"} · Energy: ${ci.energy ?? "—"}/10 · Sleep: ${ci.sleep_hours ?? "—"}h`
        : "⚠️ No check-in logged yet today.",
    });
  }

  const embed = {
    title: `Daily Briefing — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`,
    color: 0x00d4ff,
    fields,
    footer: { text: "JARVIS · at your service, Sir" },
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(hook.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "JARVIS", embeds: [embed] }),
  });
  if (!res.ok) throw new Error(`discord ${res.status}`);
  await supabaseAdmin.from("discord_webhooks").update({ last_sent_at: new Date().toISOString() }).eq("id", hook.id);
}
