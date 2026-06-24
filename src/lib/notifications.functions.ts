import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { sendDiscordNotification } from "./discord.server";

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw error;
    return data ?? [];
  });

export const markRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await supabase.from("notifications").update({ read_status: true }).eq("id", data.id).eq("user_id", userId);
    return { ok: true };
  });

export const dismissNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await supabase.from("notifications").delete().eq("id", data.id).eq("user_id", userId);
    return { ok: true };
  });

// ============================================================
// NEW: Create a notification and send Discord push if critical
// ============================================================
export const createNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        type: z.enum(["alert", "update", "warning", "briefing"]),
        priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
        title: z.string().min(1).max(200),
        message: z.string().min(1).max(2000),
        action_payload: z
          .array(
            z.object({
              type: z.string(),
              label: z.string(),
              minutes: z.number().optional(),
              feedId: z.string().optional(),
            }),
          )
          .default([]),
        source_table: z.string().nullable().optional(),
        source_id: z.string().nullable().optional(),
        send_push: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    // Insert the notification
    const { data: notif, error } = await supabase
      .from("notifications")
      .insert({
        user_id: userId,
        type: data.type,
        priority: data.priority,
        title: data.title,
        message: data.message,
        action_payload: data.action_payload,
        source_table: data.source_table || null,
        source_id: data.source_id || null,
      })
      .select("*")
      .single();
    if (error) throw error;

    // Send Discord push if priority is critical or high (and send_push is true)
    if (data.send_push && (data.priority === "critical" || data.priority === "high")) {
      const color = data.priority === "critical" ? 0xe74c3c : 0xf39c12; // red or orange
      const fields = [
        { name: "Priority", value: data.priority.toUpperCase(), inline: true },
        { name: "Type", value: data.type, inline: true },
        { name: "Message", value: data.message.slice(0, 200) },
      ];
      await sendDiscordNotification(userId, data.title, data.message, color, fields);
    }

    return notif;
  });
