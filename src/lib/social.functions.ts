import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listFeeds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("social_feeds")
      .select("*")
      .eq("user_id", userId)
      .order("received_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  });

export const markFeedHandled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), handled: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("social_feeds")
      .update({ is_handled: data.handled ?? true })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const refreshFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ platform: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async () => {
    // Placeholder: real platform pulls require per-user OAuth. No-op for now.
    return { ok: true, refreshed: 0 };
  });

export const importCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .array(
        z.object({
          platform: z.enum(["twitter", "linkedin", "instagram", "facebook", "gmail", "calendar"]),
          username: z.string().min(1),
          password: z.string().min(1),
        }),
      )
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const inserted: any[] = [];
    for (const cred of data) {
      const { data: row, error } = await supabase
        .from("vault_items")
        .insert({
          user_id: userId,
          kind: "credential",
          label: `Social: ${cred.platform}/${cred.username}`,
          tags: [cred.platform, "social"],
          data: {
            platform: cred.platform,
            username: cred.username,
            password: cred.password,
            note: `Imported credential for ${cred.platform}.`,
          },
        })
        .select("*")
        .single();
      if (error) throw error;
      inserted.push(row);
    }
    return inserted;
  });
