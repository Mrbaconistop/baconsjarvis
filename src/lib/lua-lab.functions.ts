import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";
import { z } from "zod";
import { getModelForUser } from "./ai-gateway.server";

const BASE = `You are JARVIS in Lua Lab — a senior Roblox Luau / Lua engineer.

Output format (ALWAYS, exactly):
###PLAN
<3-8 short bullet lines explaining the logic and approach BEFORE any code>
###CODE
\`\`\`lua
<the complete script, no placeholders>
\`\`\`
###NOTES
<1-4 short lines: where the script goes (Script/LocalScript/ModuleScript), how to test it>

Rules: no markdown outside those sections, no prose before ###PLAN, keep code complete and runnable.`;

function buildSystem(lang: string, rules: string[], mistakes: string[]) {
  return `${BASE}

TARGET LANGUAGE: ${lang === "luau" ? "Roblox Luau (typed Lua 5.1 superset, Roblox API)" : "vanilla Lua 5.1 (no Roblox APIs)"}.

ACTIVE VALIDATION RULES — the code you write MUST satisfy every one of these:
${rules.length ? rules.map((r) => `- ${r}`).join("\n") : "- (none)"}

${
  mistakes.length
    ? `MISTAKE MEMORY — you previously produced these issues. Do not repeat them:\n${mistakes.map((m) => `- ${m}`).join("\n")}`
    : ""
}`;
}

const genInput = z.object({
  description: z.string().min(1).max(4000),
  language: z.enum(["lua", "luau"]),
  rules: z.array(z.string()).max(60).default([]),
  mistakes: z.array(z.string()).max(40).default([]),
  currentCode: z.string().max(60000).optional(),
});

export const generateLuaCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => genInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { model } = await getModelForUser(userId, supabase);
    const prompt = data.currentCode?.trim()
      ? `Existing script:\n\`\`\`lua\n${data.currentCode}\n\`\`\`\n\nRequest: ${data.description}`
      : data.description;

    const { text } = await generateText({
      model,
      system: buildSystem(data.language, data.rules, data.mistakes),
      prompt,
      temperature: 0.2,
    });
    return parseSections(text);
  });

const fixInput = z.object({
  code: z.string().min(1).max(60000),
  language: z.enum(["lua", "luau"]),
  issues: z.array(z.string()).max(60),
  rules: z.array(z.string()).max(60).default([]),
});

export const fixLuaCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => fixInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { model } = await getModelForUser(userId, supabase);
    const { text } = await generateText({
      model,
      system: buildSystem(data.language, data.rules, []),
      prompt: `The validator flagged these issues:\n${data.issues.map((i) => `- ${i}`).join("\n")}\n\nFix ALL of them in this script without changing its behaviour:\n\`\`\`lua\n${data.code}\n\`\`\``,
      temperature: 0.1,
    });
    return parseSections(text);
  });

function parseSections(text: string) {
  const plan = /###PLAN([\s\S]*?)(###CODE|$)/.exec(text)?.[1]?.trim() ?? "";
  const notes = /###NOTES([\s\S]*)$/.exec(text)?.[1]?.trim() ?? "";
  const codeBlock = /```(?:lua|luau)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const code = (codeBlock ?? /###CODE([\s\S]*?)(###NOTES|$)/.exec(text)?.[1] ?? "").trim();
  return { plan, code, notes, raw: text };
}
