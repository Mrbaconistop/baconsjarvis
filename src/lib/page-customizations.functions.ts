import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RouteKey = z.string().min(1).max(120);
const Position = z.enum(["top", "bottom", "floating", "replace"]);

export const listPageCustomizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("page_customizations")
      .select("route_key, enabled, position, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getPageCustomization = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ route_key: RouteKey }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: row, error } = await supabase
      .from("page_customizations")
      .select("*")
      .eq("user_id", userId)
      .eq("route_key", data.route_key)
      .maybeSingle();
    if (error) throw error;
    return row;
  });

export const upsertPageCustomization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        route_key: RouteKey,
        enabled: z.boolean().optional(),
        position: Position.optional(),
        css: z.string().max(200_000).optional(),
        js: z.string().max(200_000).optional(),
        html: z.string().max(200_000).optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const payload: any = {
      user_id: userId,
      route_key: data.route_key,
      updated_at: new Date().toISOString(),
    };
    if (data.enabled !== undefined) payload.enabled = data.enabled;
    if (data.position !== undefined) payload.position = data.position;
    if (data.css !== undefined) payload.css = data.css;
    if (data.js !== undefined) payload.js = data.js;
    if (data.html !== undefined) payload.html = data.html;
    if (data.notes !== undefined) payload.notes = data.notes;
    const { data: row, error } = await supabase
      .from("page_customizations")
      .upsert(payload, { onConflict: "user_id,route_key" })
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const deletePageCustomization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ route_key: RouteKey }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("page_customizations")
      .delete()
      .eq("user_id", userId)
      .eq("route_key", data.route_key);
    if (error) throw error;
    return { ok: true };
  });
