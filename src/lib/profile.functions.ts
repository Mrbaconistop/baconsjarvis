import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw error;
    return data;
  });

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("connected_accounts")
      .select("*")
      .eq("user_id", userId)
      .order("platform", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const getLLMConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data } = await supabase.from("user_facts").select("key, value").eq("user_id", userId).eq("category", "llm");
    const config: Record<string, string> = {};
    (data ?? []).forEach((f: any) => {
      config[f.key] = f.value;
    });
    return {
      provider: config.provider || "system",
      apiKey: config.api_key || "",
      mode: config.mode || "basic",
    };
  });

export const updateLLMConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        provider: z.enum(["groq", "deepseek", "lovable", "system", "lmstudio"]),
        apiKey: z.string().optional(),
        mode: z.enum(["thinking", "coding", "basic"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    // Delete existing llm facts
    await supabase.from("user_facts").delete().eq("user_id", userId).eq("category", "llm");

    const facts: Array<{ user_id: string; category: string; key: string; value: string }> = [];

    if (data.provider !== "system") {
      facts.push({ user_id: userId, category: "llm", key: "provider", value: data.provider });
      if (data.apiKey) {
        facts.push({ user_id: userId, category: "llm", key: "api_key", value: data.apiKey });
      }
    }

    if (data.mode) {
      facts.push({ user_id: userId, category: "llm", key: "mode", value: data.mode });
    }

    if (facts.length > 0) {
      const { error } = await supabase.from("user_facts").insert(facts);
      if (error) throw error;
    }

    return { ok: true };
  });
