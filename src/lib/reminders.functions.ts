import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("reminders")
      .select("*")
      .eq("user_id", userId)
      .order("datetime", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const createReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(1000).optional().nullable(),
      datetime: z.string(),
      priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
      recurrence: z.enum(["daily", "weekdays", "weekly", "monthly"]).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: row, error } = await supabase
      .from("reminders")
      .insert({ ...data, user_id: userId, source_type: "manual" })
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const toggleReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), completed: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("reminders")
      .update({ is_completed: data.completed })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase.from("reminders").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });
