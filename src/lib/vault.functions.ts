import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const KindSchema = z.enum(["credential", "note", "contact"]);

export const listVault = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("vault_items")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const upsertVault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      kind: KindSchema,
      label: z.string().min(1).max(120),
      data: z.record(z.string(), z.any()).default({}),
      tags: z.array(z.string()).default([]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    if (data.id) {
      const { data: row, error } = await supabase
        .from("vault_items")
        .update({ kind: data.kind, label: data.label, data: data.data, tags: data.tags })
        .eq("id", data.id).eq("user_id", userId).select("*").single();
      if (error) throw error;
      return row;
    }
    const { data: row, error } = await supabase
      .from("vault_items")
      .insert({ user_id: userId, kind: data.kind, label: data.label, data: data.data, tags: data.tags })
      .select("*").single();
    if (error) throw error;
    return row;
  });

export const deleteVault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase.from("vault_items").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });
