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

export const assessGradeLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sample: z.string().min(20).max(12000),
        subjectHint: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const system = `You are JARVIS, Sir's academic evaluator, calibrated specifically against the **Oklahoma Academic Standards (OAS)** published by the Oklahoma State Department of Education (OSDE). Your job is to estimate the grade level (PreK through 12) that a writing/work sample reflects, using OAS benchmarks for ELA, Math, Science, and Social Studies.

You MUST output clean Markdown in this exact structure:

## Oklahoma Grade-Level Assessment

**Overall grade level:** <e.g. "7th Grade" or "10th Grade (Sophomore)">
**Confidence:** <Low | Medium | High>
**Closest OAS strand:** <e.g. "OAS ELA 7.2.R — Reading Comprehension">

### Subject Breakdown
- **Reading / ELA:** <grade>
- **Writing mechanics:** <grade>
- **Vocabulary:** <grade>
- **Math / reasoning (if present):** <grade or "N/A">

### Evidence
- 2–4 short bullets citing specific phrases or constructions from the sample.

### Aligned OAS Benchmark
One short paragraph naming the closest Oklahoma standard code and what a student at that level is expected to demonstrate.

### Next-Step Recommendation
One concise paragraph: what to practice next to advance to the next OAS band.

Be honest and calibrated. Do not flatter. If the sample is too short or off-topic, say so and ask for more text instead of guessing.`;
    const prompt = `${data.subjectHint ? `Subject hint: ${data.subjectHint}\n\n` : ""}Sample to evaluate (verbatim student work):\n\n"""\n${data.sample}\n"""`;
    const markdown = await callJarvis(system, prompt);
    return { markdown };
  });

export const checkAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        problem: z.string().min(1).max(4000),
        answer: z.string().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const system = `You are JARVIS, Sir's elite tutor grading a single answer.

Decide if Sir's answer is correct, partially correct, or incorrect. Be strict but fair: mathematically/logically equivalent forms (1/2 vs 0.5, simplified vs expanded, synonymous wording) count as correct.

Output STRICT Markdown in this EXACT shape:

### Verdict: <✅ Correct | ⚠️ Partially correct | ❌ Incorrect>

**Sir's answer:** <restate briefly>
**Correct answer:** <the right answer>

### Why
1–4 sentence explanation. If incorrect, point to the specific misstep. If correct, confirm the reasoning succinctly. Use LaTeX ($...$ or $$...$$) for math.

\`\`\`
status=<correct|partial|incorrect>
\`\`\``;
    const prompt = `Problem:\n${data.problem}\n\nSir's answer:\n${data.answer}\n\nGrade it.`;
    const markdown = await callJarvis(system, prompt);
    const m = markdown.match(/status\s*=\s*(correct|partial|incorrect)/i);
    const status = (m?.[1]?.toLowerCase() ?? "incorrect") as "correct" | "partial" | "incorrect";
    return { markdown, status, correct: status === "correct" };
  });
