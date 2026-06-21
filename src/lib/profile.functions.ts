// Add to src/lib/profile.functions.ts

export const updateAiProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ provider: z.enum(["groq", "deepseek", "gemini"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    try {
      const { error } = await supabase.from("profiles").update({ ai_provider: data.provider }).eq("id", userId);
      if (error) {
        // Column missing – ignore
        if (error.message?.includes("column") && error.message?.includes("does not exist")) {
          console.warn("ai_provider column missing – update skipped");
          return { ok: true, provider: data.provider };
        }
        throw error;
      }
      return { ok: true, provider: data.provider };
    } catch (error: any) {
      console.error("Update AI provider error:", error);
      return { ok: true, provider: data.provider };
    }
  });

export const getAiProvider = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    try {
      const { data, error } = await supabase.from("profiles").select("ai_provider").eq("id", userId).maybeSingle();
      if (error) {
        if (error.message?.includes("column") && error.message?.includes("does not exist")) {
          return { provider: "groq" };
        }
        throw error;
      }
      return { provider: data?.ai_provider || "groq" };
    } catch (error: any) {
      console.error("Get AI provider error:", error);
      return { provider: "groq" };
    }
  });
