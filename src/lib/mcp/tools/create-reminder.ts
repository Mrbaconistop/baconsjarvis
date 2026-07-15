import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_reminder",
  title: "Create reminder",
  description: "Create a reminder for the signed-in user at a specific ISO datetime.",
  inputSchema: {
    title: z.string().min(1),
    datetime: z.string().datetime().describe("ISO-8601 datetime (with timezone)."),
    description: z.string().optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, datetime, description, priority }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("reminders")
      .insert({
        user_id: ctx.getUserId()!,
        title,
        datetime,
        description: description ?? null,
        priority: (priority ?? "normal") as any,
        source_type: "mcp",
      })
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return { content: [{ type: "text", text: `Created reminder ${data.id}` }], structuredContent: { reminder: data } };
  },
});
