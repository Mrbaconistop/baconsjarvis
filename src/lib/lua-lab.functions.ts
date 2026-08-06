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
    const { model } = await pickModel(userId, supabase, (data as any).apiKey);
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
    const { model } = await pickModel(userId, supabase, (data as any).apiKey);
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
    const { model } = await pickModel(userId, supabase, (data as any).apiKey);

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

// ============================================================
// PROJECT FACTORY — blueprint + per-module chunked generation
// ============================================================

const blueprintInput = z.object({
  description: z.string().min(1).max(4000),
  moduleCount: z.number().int().min(1).max(60).default(30),
  ...contextSchema,
});

export const projectBlueprint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => blueprintInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { model } = await pickModel(userId, supabase, data.apiKey);
    const { text } = await generateText({
      model,
      system: `You are a Luau architect. Output STRICT JSON only (no prose, no code fences) shaped as:
{"projectName":"string","modules":[{"name":"string","filename":"string","purpose":"string","dependencies":["string"]}]}
Exactly ${data.moduleCount} modules. Design a coherent, production-grade Roblox Luau architecture.

${buildLabSystem("", data)}`,
      prompt: data.description,
      temperature: 0.3,
    });
    const json = /\{[\s\S]*\}/.exec(text)?.[0] ?? "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("Blueprint JSON could not be parsed — try again.");
    }
    const modules = Array.isArray(parsed.modules) ? parsed.modules : [];
    if (!modules.length) throw new Error("Blueprint returned no modules.");
    return {
      projectName: String(parsed.projectName || "Project"),
      modules: modules.slice(0, data.moduleCount).map((m: any) => ({
        name: String(m?.name ?? "Module"),
        filename: String(m?.filename ?? `${m?.name ?? "Module"}.lua`),
        purpose: String(m?.purpose ?? ""),
        dependencies: Array.isArray(m?.dependencies) ? m.dependencies.map(String).slice(0, 20) : [],
      })),
    };
  });

const moduleInput = z.object({
  projectName: z.string().max(200),
  projectDescription: z.string().max(4000),
  module: z.object({
    name: z.string().max(200),
    filename: z.string().max(200),
    purpose: z.string().max(2000),
    dependencies: z.array(z.string().max(200)).max(20).default([]),
  }),
  siblings: z.array(z.string().max(300)).max(60).default([]),
  targetLines: z.number().int().min(100).max(2000).default(1000),
  isMain: z.boolean().default(false),
  ...contextSchema,
});

export const generateProjectModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => moduleInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { model } = await pickModel(userId, supabase, data.apiKey);
    const prompt = data.isMain
      ? `Project "${data.projectName}" — ${data.projectDescription}\n\nModules already generated:\n${data.siblings.join("\n")}\n\nWrite main.lua: a single entry-point script that requires and boots every module above in correct dependency order, with error handling. Output ONE lua code block only.`
      : `Project "${data.projectName}" — ${data.projectDescription}\n\nOther modules in this project:\n${data.siblings.join("\n")}\n\nNow write the FULL implementation of module "${data.module.name}" (${data.module.filename}).\nPurpose: ${data.module.purpose}\nDependencies: ${data.module.dependencies.join(", ") || "none"}\n\nRequirements: production-grade, roughly ${data.targetLines} lines, complete (no TODOs or stubs), consistent with the other modules' names and conventions. Output ONE lua code block only.`;

    const { text } = await generateText({
      model,
      system: buildLabSystem(LAB_BASE, { ...data, mistakes: [] }),
      prompt,
      temperature: 0.2,
    });
    return parseSections(text);
  });
