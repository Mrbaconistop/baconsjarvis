import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_reminders",
  title: "List reminders",
  description: "List the signed-in user's upcoming reminders.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional(),
    include_completed: z.boolean().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, include_completed }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = supabaseForUser(ctx)
      .from("reminders")
      .select("id, title, description, datetime, priority, is_completed, created_at")
      .order("datetime", { ascending: true })
      .limit(limit ?? 25);
    if (!include_completed) q = q.eq("is_completed", false);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { reminders: data ?? [] },
    };
  },
});
