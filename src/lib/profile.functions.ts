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
    const provider = config.provider || "system";
    // Per-provider saved keys survive when switching providers
    const apiKeys: Record<string, string> = {};
    Object.keys(config).forEach((k) => {
      if (k.startsWith("api_key:")) apiKeys[k.slice(8)] = config[k];
    });
    // Legacy single-key fallback: attribute it to the current provider
    if (config.api_key && provider !== "system" && !apiKeys[provider]) {
      apiKeys[provider] = config.api_key;
    }
    return {
      provider,
      apiKey: apiKeys[provider] || "",
      apiKeys,
      mode: config.mode || "basic",
      coding_submode: config.coding_submode || "full",
    };
  });

export const updateLLMConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        provider: z.enum([
          "groq",
          "deepseek",
          "system",
          "lmstudio",
          "gemini",
          "openrouter",
          "mistral",
          "claude",
          "perplexity",
        ]),
        apiKey: z.string().optional(),
        mode: z.enum(["thinking", "coding", "basic"]).optional(),
        coding_submode: z.enum(["full", "language_only", "direct"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    // Update the selection + mode fields (delete then insert those specific keys only)
    const keysToReplace = ["provider", "mode", "coding_submode", "api_key"];
    await supabase
      .from("user_facts")
      .delete()
      .eq("user_id", userId)
      .eq("category", "llm")
      .in("key", keysToReplace);

    const facts: Array<{ user_id: string; category: string; key: string; value: string }> = [];
    facts.push({ user_id: userId, category: "llm", key: "provider", value: data.provider });
    if (data.mode) facts.push({ user_id: userId, category: "llm", key: "mode", value: data.mode });
    if (data.mode === "coding" && data.coding_submode) {
      facts.push({ user_id: userId, category: "llm", key: "coding_submode", value: data.coding_submode });
    }

    // Persist per-provider API key so switching providers preserves earlier keys
    if (data.provider !== "system" && typeof data.apiKey === "string" && data.apiKey.length > 0) {
      const perKey = `api_key:${data.provider}`;
      await supabase
        .from("user_facts")
        .delete()
        .eq("user_id", userId)
        .eq("category", "llm")
        .eq("key", perKey);
      facts.push({ user_id: userId, category: "llm", key: perKey, value: data.apiKey });
    }

    if (facts.length > 0) {
      const { error } = await supabase.from("user_facts").insert(facts);
      if (error) throw error;
    }

    return { ok: true };
  });


export const storeGoogleConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const platforms = ["gmail", "calendar"];
    for (const platform of platforms) {
      const { error } = await supabase.from("connected_accounts").upsert(
        {
          user_id: userId,
          platform: platform,
          status: "connected",
          handle: null,
        },
        { onConflict: "user_id,platform" },
      );
      if (error) console.error(`Failed to store ${platform}:`, error);
    }
    return { ok: true };
  });

export const updateCodingSubmode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        submode: z.enum(["full", "language_only", "direct"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    await supabase.from("user_facts").delete().eq("user_id", userId).eq("category", "llm").eq("key", "coding_submode");

    const { error } = await supabase.from("user_facts").insert({
      user_id: userId,
      category: "llm",
      key: "coding_submode",
      value: data.submode,
    });
    if (error) throw error;
    return { ok: true };
  });
