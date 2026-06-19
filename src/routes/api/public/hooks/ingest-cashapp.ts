import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

async function gmail(path: string, init?: RequestInit) {
  const lovableKey = process.env.LOVABLE_API_KEY!;
  const connKey = process.env.GOOGLE_MAIL_API_KEY!;
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`gmail ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

function decodeB64Url(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return atob(s); } catch { return ""; }
}

function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeB64Url(payload.body.data);
  for (const p of payload.parts ?? []) {
    if (p.mimeType === "text/plain" && p.body?.data) return decodeB64Url(p.body.data);
  }
  for (const p of payload.parts ?? []) {
    const inner = extractBody(p);
    if (inner) return inner;
  }
  return "";
}

function parseCashApp(subject: string, body: string) {
  const text = `${subject}\n${body}`.replace(/\s+/g, " ");
  // Amount: $12.34 or $1,234.56
  const amtMatch = text.match(/\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+\.[0-9]{2})/);
  if (!amtMatch) return null;
  const amount = parseFloat(amtMatch[1].replace(/,/g, ""));
  if (!isFinite(amount) || amount <= 0) return null;

  let merchant: string | null = null;
  const toMatch = text.match(/(?:payment to|paid|sent to|to)\s+([A-Z][\w'’\-\. ]{1,40}?)(?:\s+for|\s*\$|\s*\.|\s*,|$)/i);
  if (toMatch) merchant = toMatch[1].trim();

  const isIncome = /received|paid you|sent you/i.test(subject);
  return {
    amount: isIncome ? -amount : amount,
    merchant,
    category: isIncome ? "income" : "transfer",
  };
}

export const Route = createFileRoute("/api/public/hooks/ingest-cashapp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? request.headers.get("x-apikey");
        if (apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          // Allow user-triggered call with bearer token (any signed-in user syncs their own)
          const auth = request.headers.get("authorization") ?? "";
          if (!auth.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
          return await syncForUser(auth.replace(/^Bearer\s+/i, ""));
        }
        // Cron path: sync every user that has any transactions or a profile
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: users } = await supabaseAdmin.from("profiles").select("id");
        let total = 0;
        for (const u of users ?? []) {
          try { total += await syncForUserId(u.id); } catch (e) { console.error("sync fail", u.id, e); }
        }
        return Response.json({ ok: true, inserted: total, users: users?.length ?? 0 });
      },
    },
  },
});

async function syncForUser(token: string) {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const inserted = await ingestForUser(userId, supabase);
  return Response.json({ ok: true, inserted });
}

async function syncForUserId(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return ingestForUser(userId, supabaseAdmin);
}

async function ingestForUser(userId: string, db: any): Promise<number> {
  const q = encodeURIComponent("from:(cash@square.com OR cash@cashapp.com) newer_than:30d");
  let list: any;
  try {
    list = await gmail(`/users/me/messages?maxResults=25&q=${q}`);
  } catch (e) {
    console.error("gmail list fail", e);
    return 0;
  }
  const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
  if (!ids.length) return 0;

  // Pre-filter existing
  const { data: existing } = await db.from("transactions")
    .select("external_id").eq("user_id", userId).eq("source", "gmail").in("external_id", ids);
  const seen = new Set((existing ?? []).map((r: any) => r.external_id));

  let inserted = 0;
  for (const id of ids) {
    if (seen.has(id)) continue;
    try {
      const msg = await gmail(`/users/me/messages/${id}?format=full`);
      const headers = msg.payload?.headers ?? [];
      const subject = headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value ?? "";
      const dateHdr = headers.find((h: any) => h.name?.toLowerCase() === "date")?.value;
      const body = extractBody(msg.payload);
      const parsed = parseCashApp(subject, body);
      if (!parsed) continue;
      const occurred_at = dateHdr ? new Date(dateHdr).toISOString() : new Date(Number(msg.internalDate)).toISOString();
      const { error } = await db.from("transactions").insert({
        user_id: userId,
        amount_cents: Math.round(parsed.amount * 100),
        merchant: parsed.merchant,
        category: parsed.category,
        note: subject.slice(0, 200),
        source: "gmail",
        external_id: id,
        occurred_at,
      });
      if (!error) inserted++;
    } catch (e) {
      console.error("ingest msg fail", id, e);
    }
  }
  return inserted;
}
