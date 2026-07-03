import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "tab"
  );
}

// Schema for the config object stored in JSONB
const configSchema = z
  .object({
    layout: z.enum(["default", "browser", "chat", "minimal"]).default("default"),
    theme: z.enum(["dark", "light", "auto"]).default("dark"),
    containerPadding: z.number().int().min(0).max(80).default(16),
  })
  .passthrough(); // allow extra fields for future expansion

export const listCustomTabs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("custom_tabs")
      .select("id, slug, label, icon, description, sort_order, updated_at, config")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const getCustomTab = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ slug: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: row, error } = await supabase
      .from("custom_tabs")
      .select("*")
      .eq("user_id", userId)
      .eq("slug", data.slug)
      .maybeSingle();
    if (error) throw error;
    return row;
  });

export const createCustomTab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        label: z.string().min(1).max(40),
        icon: z.string().max(40).optional(),
        description: z.string().max(300).optional().nullable(),
        content_html: z.string().max(200_000).optional(),
        slug: z.string().max(40).optional(),
        config: configSchema.optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const baseSlug = slugify(data.slug || data.label);
    let slug = baseSlug;
    let n = 2;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: existing } = await supabase
        .from("custom_tabs")
        .select("id")
        .eq("user_id", userId)
        .eq("slug", slug)
        .maybeSingle();
      if (!existing) break;
      slug = `${baseSlug}-${n++}`;
    }
    const { data: row, error } = await supabase
      .from("custom_tabs")
      .insert({
        user_id: userId,
        slug,
        label: data.label,
        icon: data.icon || "Sparkles",
        description: data.description ?? null,
        content_html: data.content_html ?? "",
        config: data.config ?? {},
      })
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const updateCustomTab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        label: z.string().min(1).max(40).optional(),
        icon: z.string().max(40).optional(),
        description: z.string().max(300).nullable().optional(),
        content_html: z.string().max(200_000).optional(),
        sort_order: z.number().int().optional(),
        config: configSchema.optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { id, ...rest } = data;
    const patch: any = { ...rest, updated_at: new Date().toISOString() };
    const { data: row, error } = await supabase
      .from("custom_tabs")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const deleteCustomTab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase.from("custom_tabs").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });
