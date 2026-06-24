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
    z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional().nullable(),
        datetime: z.string(),
        priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
        recurrence: z.enum(["daily", "weekdays", "weekly", "monthly"]).nullable().optional(),
      })
      .parse(input),
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
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), completed: z.boolean() }).parse(input))
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

export const getTasksByStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("reminders")
      .select("*")
      .eq("user_id", userId)
      .order("order", { ascending: true });
    if (error) throw error;
    const grouped = { todo: [], doing: [], done: [] };
    (data ?? []).forEach((task: any) => {
      const status = task.status || "todo";
      if (grouped[status as keyof typeof grouped]) {
        grouped[status as keyof typeof grouped].push(task);
      } else {
        grouped.todo.push(task);
      }
    });
    return grouped;
  });

export const updateTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["todo", "doing", "done"]),
        order: z.number().int().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const updateData: any = { status: data.status };
    if (data.order !== undefined) updateData.order = data.order;
    const { error } = await supabase.from("reminders").update(updateData).eq("id", data.id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional().nullable(),
        datetime: z.string().optional(),
        priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
        recurrence: z.enum(["daily", "weekdays", "weekly", "monthly"]).nullable().optional(),
        status: z.enum(["todo", "doing", "done"]).default("todo"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: existing } = await supabase
      .from("reminders")
      .select("order")
      .eq("user_id", userId)
      .eq("status", data.status)
      .order("order", { ascending: false })
      .limit(1);
    const nextOrder = existing && existing.length > 0 ? (existing[0].order || 0) + 1 : 0;

    const insertData = {
      user_id: userId,
      title: data.title,
      description: data.description || null,
      datetime: data.datetime ? new Date(data.datetime).toISOString() : new Date().toISOString(),
      priority: data.priority,
      recurrence: data.recurrence || null,
      status: data.status,
      order: nextOrder,
      source_type: "kanban",
    };
    const { data: row, error } = await supabase.from("reminders").insert(insertData).select("*").single();
    if (error) throw error;
    return row;
  });
