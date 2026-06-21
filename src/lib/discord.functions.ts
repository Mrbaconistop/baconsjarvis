import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listWebhooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("discord_webhooks").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  url: z.string().url().refine((u) => u.includes("discord.com/api/webhooks/"), "Must be a Discord webhook URL"),
  enabled: z.boolean(),
  include_email: z.boolean(),
  include_calendar: z.boolean(),
  include_reminders: z.boolean(),
  include_checkin: z.boolean(),
  include_spending: z.boolean(),
});

export const saveWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = { ...data, user_id: context.userId };
    const { error } = data.id
      ? await context.supabase.from("discord_webhooks").update(row).eq("id", data.id)
      : await context.supabase.from("discord_webhooks").insert(row);
    if (error) throw error;
    return { ok: true };
  });

export const deleteWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("discord_webhooks").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const testWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: hook } = await context.supabase
      .from("discord_webhooks").select("url, name").eq("id", data.id).single();
    if (!hook) throw new Error("Webhook not found");
    const res = await fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "JARVIS",
        embeds: [{
          title: "Test transmission",
          description: `Webhook **${hook.name}** is online. Daily briefings will arrive at 12:00 UTC.`,
          color: 0x00d4ff,
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (!res.ok) throw new Error(`Discord responded ${res.status}`);
    return { ok: true };
  });

export const fireDailyNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Call our own public endpoint with the user's bearer; safer than duplicating logic.
    // Instead, just enqueue inline by calling sendForUser via dynamic import.
    const { data: hooks } = await context.supabase
      .from("discord_webhooks").select("*").eq("enabled", true);
    const { sendForUserHooks } = await import("./discord.server");
    let sent = 0;
    for (const h of hooks ?? []) {
      try { await sendForUserHooks(context.userId, h); sent++; } catch (e) { console.error(e); }
    }
    return { sent };
  });

// Check-ins
export const getTodayCheckin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await context.supabase
      .from("daily_checkins").select("*").eq("day", today).maybeSingle();
    return data;
  });

const checkinSchema = z.object({
  weight_lbs: z.number().nullable().optional(),
  height_in: z.number().nullable().optional(),
  mood: z.string().max(40).nullable().optional(),
  energy: z.number().int().min(1).max(10).nullable().optional(),
  sleep_hours: z.number().min(0).max(24).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const saveCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => checkinSchema.parse(d))
  .handler(async ({ data, context }) => {
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await context.supabase.from("daily_checkins").upsert(
      { user_id: context.userId, day: today, ...data },
      { onConflict: "user_id,day" },
    );
    if (error) throw error;
    return { ok: true };
  });
