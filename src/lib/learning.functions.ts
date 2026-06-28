import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listLearningSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("learning_sessions")
      .select("id, title, updated_at, created_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getLearningSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: row, error } = await supabase
      .from("learning_sessions")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return row;
  });

export const createLearningSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ title: z.string().min(1).max(200).default("Untitled Session"), content: z.string().default("") }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: row, error } = await supabase
      .from("learning_sessions")
      .insert({ user_id: userId, title: data.title, content: data.content })
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const updateLearningSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        content: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.content !== undefined) patch.content = data.content;
    const { data: row, error } = await supabase
      .from("learning_sessions")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const deleteLearningSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("learning_sessions")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

// ---------------- AI helpers ----------------

async function callJarvis(system: string, prompt: string): Promise<string> {
  const { getModelForUser } = await import("./ai-gateway.server");
  const { generateText } = await import("ai");
  // Use lovable gateway directly (no per-user fetch needed for one-off lab calls)
  const { resolveChatModel } = await import("./ai-gateway.server");
  // Prefer user preference if available, otherwise system default
  void getModelForUser;
  const { model } = resolveChatModel({});
  const { text } = await generateText({
    model,
    system,
    prompt,
    temperature: 0.7,
  });
  return text;
}

export const generateProblems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        topic: z.string().min(1).max(200),
        count: z.number().int().min(1).max(10).default(5),
        difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const system = `You are JARVIS, Sir's elite tutor. Produce concise practice problems in Markdown.
Format STRICTLY as a numbered list. Each item begins with "### Problem N: <short title>" on its own line, followed by 1-3 lines stating the problem only — no solution, no hints.`;
    const prompt = `Generate ${data.count} ${data.difficulty} practice problems on the topic: "${data.topic}".`;
    const markdown = await callJarvis(system, prompt);
    return { markdown };
  });

export const explainSolution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ problem: z.string().min(1).max(4000), context: z.string().max(8000).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const system = `You are JARVIS, Sir's elite tutor. Explain solutions step-by-step in clean Markdown.
Use ## headings ("Approach", "Solution", "Answer"), bullet points, and fenced code blocks where useful. Be precise and pedagogical.`;
    const prompt = `Problem:\n${data.problem}\n\n${data.context ? `Additional notes:\n${data.context}\n\n` : ""}Walk through the full solution.`;
    const markdown = await callJarvis(system, prompt);
    return { markdown };
  });
