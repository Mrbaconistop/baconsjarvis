// Prompt/parsing helpers for Lua Lab (imported by the server functions).

export const LAB_BASE = `You are JARVIS in Lua Lab — a senior Roblox Luau / Lua engineer.

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

export const LAB_CHAT_BASE = `You are JARVIS in Lua Lab — a senior Roblox Luau / Lua engineer and pair programmer.

Behaviour:
- Be concise. Answer directly, use fenced \`\`\`lua blocks for code.
- If the user says you made a mistake / that's wrong / that's broken, DO NOT guess. Ask exactly one clarifying question: "What specifically was wrong? Can you describe what you expected?"
- Once the user explains the mistake, ask: "Should I remember this correction for future generations?" and on that same message emit a final line in this exact format:
  ###CORRECTION_REQ: <short description of the mistake> → <the correction to remember>
- Never claim to have stored a correction unless the user explicitly confirmed with yes.
- Use the provided vault snippets, knowledge, rules, API references and stored corrections as authoritative context.`;

export type LabContext = {
  language: string;
  rules?: string[];
  mistakes?: string[];
  corrections?: { mistake: string; correction: string }[];
  knowledge?: string[];
  apiRefs?: string[];
  vault?: { title: string; excerpt: string }[];
};

function block(title: string, items: string[]) {
  if (!items.length) return "";
  return `\n${title}:\n${items.map((i) => `- ${i}`).join("\n")}\n`;
}

export function buildLabSystem(base: string, ctx: LabContext) {
  const lang =
    ctx.language === "luau"
      ? "Roblox Luau (typed Lua 5.1 superset, Roblox API)"
      : "vanilla Lua 5.1 (no Roblox APIs)";

  return `${base}

TARGET LANGUAGE: ${lang}.
${block("ACTIVE VALIDATION RULES — the code you write MUST satisfy every one of these", ctx.rules ?? [])}${block(
    "MISTAKE MEMORY — you previously produced these issues. Do not repeat them",
    ctx.mistakes ?? [],
  )}${block(
    "USER-CONFIRMED CORRECTIONS — these override your defaults, always honour them",
    (ctx.corrections ?? []).map((c) => (c.mistake ? `${c.mistake} → ${c.correction}` : c.correction)),
  )}${block("KNOWLEDGE BASE", ctx.knowledge ?? [])}${block("API REFERENCES", ctx.apiRefs ?? [])}${
    ctx.vault?.length
      ? `\nRELEVANT VAULT SNIPPETS (auto-searched from the user's vault — reuse their conventions):\n${ctx.vault
          .map((v) => `--- ${v.title} ---\n${v.excerpt}`)
          .join("\n\n")}\n`
      : ""
  }`;
}

export function parseSections(text: string) {
  const plan = /###PLAN([\s\S]*?)(###CODE|$)/.exec(text)?.[1]?.trim() ?? "";
  const notes = /###NOTES([\s\S]*)$/.exec(text)?.[1]?.trim() ?? "";
  const codeBlock = /```(?:lua|luau)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const code = (codeBlock ?? /###CODE([\s\S]*?)(###NOTES|$)/.exec(text)?.[1] ?? "").trim();
  return { plan, code, notes, raw: text };
}
