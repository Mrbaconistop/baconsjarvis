import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        tabSlug: z.string().nullable().optional(),
        scope: z.enum(["all", "general", "tab"]).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    let q = supabase.from("chat_threads").select("*").eq("user_id", userId);
    if (data.tabSlug) q = q.eq("tab_slug", data.tabSlug);
    else if (data.scope === "general") q = q.is("tab_slug", null);
    q = q.order("updated_at", { ascending: false });
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const createThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ title: z.string().max(120).optional(), tabSlug: z.string().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: row, error } = await supabase
      .from("chat_threads")
      .insert({ user_id: userId, title: data.title ?? "New conversation", tab_slug: data.tabSlug ?? null })
      .select("*").single();
    if (error) throw error;
    return row;
  });


export const renameThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), title: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase.from("chat_threads").update({ title: data.title })
      .eq("id", data.id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error: messagesError } = await supabase
      .from("chat_messages")
      .delete()
      .eq("thread_id", data.id)
      .eq("user_id", userId);
    if (messagesError) throw messagesError;

    const { error } = await supabase.from("chat_threads").delete()
      .eq("id", data.id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const getMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ threadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: rows, error } = await supabase
      .from("chat_messages").select("id, role, parts, created_at")
      .eq("thread_id", data.threadId).eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      role: r.role,
      parts: Array.isArray(r.parts) ? r.parts : [],
    }));
  });
