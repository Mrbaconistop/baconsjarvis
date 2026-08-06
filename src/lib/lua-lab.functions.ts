import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";
import { z } from "zod";
import { getModelForUser, resolveChatModel } from "./ai-gateway.server";
import { LAB_BASE, LAB_CHAT_BASE, buildLabSystem, parseSections } from "./lua-lab-prompt";

const correctionSchema = z.object({ mistake: z.string().max(500), correction: z.string().max(2000) });

const contextSchema = {
  language: z.enum(["lua", "luau"]),
  rules: z.array(z.string()).max(60).default([]),
  mistakes: z.array(z.string()).max(40).default([]),
  corrections: z.array(correctionSchema).max(60).default([]),
  knowledge: z.array(z.string().max(6000)).max(40).default([]),
  apiRefs: z.array(z.string().max(6000)).max(40).default([]),
  vault: z.array(z.object({ title: z.string().max(200), excerpt: z.string().max(6000) })).max(12).default([]),
  apiKey: z.string().max(300).optional(),
};

// Resolves the model for the user, but lets the caller override the API key
// (used by the multi-key rotation in the Lua Lab "API Keys" panel).
async function pickModel(userId: string, supabase: any, apiKey?: string) {
  const base = await getModelForUser(userId, supabase);
  if (!apiKey?.trim()) return base;
  return { ...base, ...resolveChatModel({ provider: base.provider as any, apiKey: apiKey.trim() }) };
}

const genInput = z.object({
  description: z.string().min(1).max(4000),
  currentCode: z.string().max(60000).optional(),
  ...contextSchema,
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
      system: buildLabSystem(LAB_BASE, data),
      prompt,
      temperature: 0.2,
    });
    return parseSections(text);
  });

const fixInput = z.object({
  code: z.string().min(1).max(60000),
  issues: z.array(z.string()).max(60),
  ...contextSchema,
});

export const fixLuaCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => fixInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { model } = await getModelForUser(userId, supabase);
    const { text } = await generateText({
      model,
      system: buildLabSystem(LAB_BASE, { ...data, mistakes: [] }),
      prompt: `The validator flagged these issues:\n${data.issues.map((i) => `- ${i}`).join("\n")}\n\nFix ALL of them in this script without changing its behaviour:\n\`\`\`lua\n${data.code}\n\`\`\``,
      temperature: 0.1,
    });
    return parseSections(text);
  });

const chatInput = z.object({
  message: z.string().min(1).max(8000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(24)
    .default([]),
  ...contextSchema,
});

export const chatLuaLab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => chatInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { model } = await getModelForUser(userId, supabase);

    const { text } = await generateText({
      model,
      system: buildLabSystem(LAB_CHAT_BASE, data),
      messages: [
        ...data.history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: data.message },
      ],
      temperature: 0.2,
    });

    const req = /###CORRECTION_REQ:\s*(.+)/.exec(text)?.[1]?.trim();
    let correctionRequest: { mistake: string; correction: string } | null = null;
    if (req) {
      const [mistake, correction] = req.split(/→|->/).map((s) => s.trim());
      correctionRequest = { mistake: mistake ?? req, correction: correction ?? req };
    }
    return {
      text: text.replace(/###CORRECTION_REQ:.*/g, "").trim(),
      correctionRequest,
    };
  });
