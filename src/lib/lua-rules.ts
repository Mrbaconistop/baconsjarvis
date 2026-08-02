// Local (client-side) Lua/Luau validation rule engine + mistake memory.
// Everything is stored in localStorage — no backend, no credits.

export type Lang = "lua" | "luau";
export type Severity = "error" | "warning" | "style";

export type Issue = {
  ruleId: string;
  label: string;
  severity: Severity;
  line: number;
  message: string;
};

export type Rule = {
  id: string;
  label: string;
  description: string;
  severity: Severity;
  langs: Lang[];
  /** Line-level check. Return a message when the line violates the rule. */
  line?: (line: string, index: number, all: string[]) => string | null;
  /** Whole-document check. */
  doc?: (code: string, lines: string[]) => Issue[] | null;
};

const stripStrings = (l: string) =>
  l.replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');

const codePart = (l: string) => stripStrings(l).split("--")[0] ?? "";

export const RULES: Rule[] = [
  // ---------- syntax ----------
  {
    id: "balanced-blocks",
    label: "Balanced blocks",
    description: "Checks that do/if/for/while/function blocks are closed with matching `end`.",
    severity: "error",
    langs: ["lua", "luau"],
    doc: (_code, lines) => {
      let depth = 0;
      lines.forEach((raw) => {
        const l = codePart(raw);
        const opens = (l.match(/\b(function|if|for|while|do)\b/g) || []).length;
        const inlineThenEnd = (l.match(/\bthen\b.*\bend\b/g) || []).length;
        const closes = (l.match(/\bend\b/g) || []).length;
        const elseif = (l.match(/\belseif\b/g) || []).length;
        depth += opens - elseif - closes;
        void inlineThenEnd;
      });
      if (depth > 0)
        return [
          {
            ruleId: "balanced-blocks",
            label: "Balanced blocks",
            severity: "error" as const,
            line: lines.length,
            message: `${depth} block(s) are never closed — missing ${depth} \`end\`.`,
          },
        ];
      if (depth < 0)
        return [
          {
            ruleId: "balanced-blocks",
            label: "Balanced blocks",
            severity: "error" as const,
            line: lines.length,
            message: `${-depth} extra \`end\` keyword(s).`,
          },
        ];
      return null;
    },
  },
  {
    id: "balanced-parens",
    label: "Balanced brackets",
    description: "Checks that (), {} and [] are balanced across the script.",
    severity: "error",
    langs: ["lua", "luau"],
    doc: (_code, lines) => {
      const counts = { "(": 0, "{": 0, "[": 0 };
      lines.forEach((raw) => {
        const l = codePart(raw);
        for (const c of l) {
          if (c === "(") counts["("]++;
          else if (c === ")") counts["("]--;
          else if (c === "{") counts["{"]++;
          else if (c === "}") counts["{"]--;
          else if (c === "[") counts["["]++;
          else if (c === "]") counts["["]--;
        }
      });
      const bad = Object.entries(counts).filter(([, n]) => n !== 0);
      if (!bad.length) return null;
      return bad.map(([k, n]) => ({
        ruleId: "balanced-parens",
        label: "Balanced brackets",
        severity: "error" as const,
        line: lines.length,
        message: `Unbalanced \`${k}\` (${n > 0 ? `${n} unclosed` : `${-n} extra closing`}).`,
      }));
    },
  },
  {
    id: "not-equal-operator",
    label: "Use ~= not !=",
    description: "Lua uses `~=` for inequality; `!=` is a syntax error.",
    severity: "error",
    langs: ["lua", "luau"],
    line: (l) => (/!=/.test(codePart(l)) ? "`!=` is invalid in Lua — use `~=`." : null),
  },
  {
    id: "no-plus-concat",
    label: "String concat with ..",
    description: "Strings are joined with `..`, not `+`.",
    severity: "error",
    langs: ["lua", "luau"],
    line: (l) => (/["'][^"']*["']\s*\+/.test(stripStrings(l) === l ? l : l) && /\+/.test(l) && /["']/.test(l) ? "Use `..` to concatenate strings, not `+`." : null),
  },
  {
    id: "no-js-comments",
    label: "Lua comments",
    description: "Comments start with `--`, not `//`.",
    severity: "error",
    langs: ["lua", "luau"],
    line: (l) => (/(^|\s)\/\//.test(stripStrings(l)) ? "`//` is integer division in Luau, not a comment — use `--`." : null),
  },

  // ---------- common mistakes ----------
  {
    id: "no-legacy-wait",
    label: "No legacy wait()/spawn()",
    description: "Deprecated globals — use task.wait / task.spawn / task.delay.",
    severity: "warning",
    langs: ["luau"],
    line: (l) => {
      const c = codePart(l);
      if (/(^|[^.\w])wait\s*\(/.test(c)) return "`wait()` is deprecated — use `task.wait()`.";
      if (/(^|[^.\w])spawn\s*\(/.test(c)) return "`spawn()` is deprecated — use `task.spawn()`.";
      if (/(^|[^.\w])delay\s*\(/.test(c)) return "`delay()` is deprecated — use `task.delay()`.";
      return null;
    },
  },
  {
    id: "no-deprecated-bodymovers",
    label: "No BodyMovers",
    description: "BodyVelocity/BodyPosition/BodyGyro are deprecated — use LinearVelocity/AlignPosition/AlignOrientation.",
    severity: "warning",
    langs: ["luau"],
    line: (l) =>
      /Body(Velocity|Position|Gyro|Force|Angular)/.test(codePart(l))
        ? "BodyMovers are deprecated — use LinearVelocity / AlignPosition / AlignOrientation / VectorForce."
        : null,
  },
  {
    id: "waitforchild-timeout",
    label: "WaitForChild guard",
    description: "Infinite yields are a top Roblox bug — pass a timeout or handle nil.",
    severity: "style",
    langs: ["luau"],
    line: (l) =>
      /:WaitForChild\(\s*["'][^"']+["']\s*\)/.test(l) ? "`WaitForChild` without a timeout can yield forever." : null,
  },
  {
    id: "pcall-http-datastore",
    label: "pcall risky calls",
    description: "DataStore and HttpService calls must be wrapped in pcall.",
    severity: "warning",
    langs: ["luau"],
    line: (l) => {
      const c = codePart(l);
      if (/(GetAsync|SetAsync|UpdateAsync|IncrementAsync|RequestAsync|GetAsync)\s*\(/.test(c) && !/pcall/.test(c))
        return "Wrap DataStore/HTTP calls in `pcall` — they throw on failure.";
      return null;
    },
  },
  {
    id: "remote-validation",
    label: "Validate remote input",
    description: "Server-side OnServerEvent handlers must validate client arguments.",
    severity: "warning",
    langs: ["luau"],
    line: (l) =>
      /OnServerEvent|OnServerInvoke/.test(codePart(l))
        ? "Never trust the client — validate every argument in this handler (type + range)."
        : null,
  },
  {
    id: "no-loadstring",
    label: "No loadstring",
    description: "loadstring/getfenv/setfenv are unsafe and disabled in most contexts.",
    severity: "warning",
    langs: ["lua", "luau"],
    line: (l) => (/\b(loadstring|getfenv|setfenv)\b/.test(codePart(l)) ? "Avoid `loadstring`/`getfenv`/`setfenv`." : null),
  },
  {
    id: "no-while-true-nowait",
    label: "No busy loops",
    description: "`while true do` must yield with task.wait().",
    severity: "error",
    langs: ["lua", "luau"],
    doc: (_c, lines) => {
      const out: Issue[] = [];
      lines.forEach((raw, i) => {
        if (!/while\s+true\s+do/.test(codePart(raw))) return;
        const body = lines.slice(i, i + 12).join("\n");
        if (!/(task\.wait|wait\(|RunService|:Wait\(\))/.test(body))
          out.push({
            ruleId: "no-while-true-nowait",
            label: "No busy loops",
            severity: "error",
            line: i + 1,
            message: "`while true do` with no yield will freeze the script — add `task.wait()`.",
          });
      });
      return out.length ? out : null;
    },
  },

  // ---------- best practices ----------
  {
    id: "prefer-local",
    label: "Prefer local variables",
    description: "Implicit globals leak across scripts and are slow.",
    severity: "style",
    langs: ["lua", "luau"],
    line: (l) => {
      const c = codePart(l).trim();
      if (/^[A-Za-z_]\w*\s*=\s*[^=]/.test(c) && !/^(local|return|end)\b/.test(c))
        return "Assignment to an implicit global — prefer `local`.";
      return null;
    },
  },
  {
    id: "service-getservice",
    label: "Use GetService",
    description: "Access services with game:GetService(\"X\") instead of game.X.",
    severity: "style",
    langs: ["luau"],
    line: (l) =>
      /game\.(Players|ReplicatedStorage|ServerStorage|RunService|TweenService|HttpService|Workspace|Lighting)/.test(
        codePart(l),
      )
        ? 'Use `game:GetService("...")` instead of dot access.'
        : null,
  },
  {
    id: "strict-mode",
    label: "Enable --!strict",
    description: "Luau type checking catches whole classes of bugs.",
    severity: "style",
    langs: ["luau"],
    doc: (code) =>
      /^\s*--!(strict|nonstrict|nocheck)/m.test(code)
        ? null
        : [
            {
              ruleId: "strict-mode",
              label: "Enable --!strict",
              severity: "style" as const,
              line: 1,
              message: "Add `--!strict` at the top for Luau type checking.",
            },
          ],
  },
  {
    id: "disconnect-connections",
    label: "Clean up connections",
    description: "Stored event connections should be disconnected to avoid leaks.",
    severity: "style",
    langs: ["luau"],
    doc: (code) =>
      /:Connect\(/.test(code) && !/(:Disconnect\(|Destroying|:Once\()/.test(code)
        ? [
            {
              ruleId: "disconnect-connections",
              label: "Clean up connections",
              severity: "style" as const,
              line: 1,
              message: "Script connects events but never disconnects — possible memory leak.",
            },
          ]
        : null,
  },
  {
    id: "no-print-spam",
    label: "No debug print spam",
    description: "Prints inside loops flood the output and hurt performance.",
    severity: "style",
    langs: ["lua", "luau"],
    doc: (_c, lines) => {
      const out: Issue[] = [];
      let loopDepth = 0;
      lines.forEach((raw, i) => {
        const c = codePart(raw);
        if (/\b(for|while)\b.*\bdo\b/.test(c)) loopDepth++;
        if (/\bend\b/.test(c) && loopDepth > 0) loopDepth--;
        if (loopDepth > 0 && /\bprint\s*\(/.test(c))
          out.push({
            ruleId: "no-print-spam",
            label: "No debug print spam",
            severity: "style",
            line: i + 1,
            message: "`print()` inside a loop — remove before shipping.",
          });
      });
      return out.length ? out : null;
    },
  },
];

export function validate(code: string, lang: Lang, enabled: Record<string, boolean>): Issue[] {
  const lines = code.split("\n");
  const issues: Issue[] = [];
  for (const rule of RULES) {
    if (enabled[rule.id] === false) continue;
    if (!rule.langs.includes(lang)) continue;
    if (rule.line) {
      lines.forEach((l, i) => {
        const msg = rule.line!(l, i, lines);
        if (msg) issues.push({ ruleId: rule.id, label: rule.label, severity: rule.severity, line: i + 1, message: msg });
      });
    }
    if (rule.doc) {
      const found = rule.doc(code, lines);
      if (found) issues.push(...found);
    }
  }
  return issues.sort((a, b) => a.line - b.line);
}

// ---------------- persistence ----------------

const RULES_KEY = "lua-lab.rules.v1";
const MEM_KEY = "lua-lab.mistakes.v1";

export function loadRuleToggles(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(RULES_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveRuleToggles(v: Record<string, boolean>) {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(v));
  } catch {}
}

export type Mistake = { ruleId: string; label: string; message: string; count: number; lastSeen: number };

export function loadMistakes(): Mistake[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(MEM_KEY) || "[]");
  } catch {
    return [];
  }
}
export function saveMistakes(list: Mistake[]) {
  try {
    localStorage.setItem(MEM_KEY, JSON.stringify(list));
  } catch {}
}
export function rememberMistakes(issues: Issue[]): Mistake[] {
  const map = new Map(loadMistakes().map((m) => [m.ruleId, m]));
  for (const i of issues) {
    const prev = map.get(i.ruleId);
    map.set(i.ruleId, {
      ruleId: i.ruleId,
      label: i.label,
      message: i.message,
      count: (prev?.count ?? 0) + 1,
      lastSeen: Date.now(),
    });
  }
  const next = [...map.values()].sort((a, b) => b.count - a.count).slice(0, 40);
  saveMistakes(next);
  return next;
}
