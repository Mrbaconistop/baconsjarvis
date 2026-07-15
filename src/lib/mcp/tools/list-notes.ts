import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_notes",
  title: "List notes",
  description: "List the signed-in JARVIS user's notes, most recent first.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe("Max notes to return (default 20)."),
    tag: z.string().optional().describe("Filter to notes containing this tag."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, tag }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = supabaseForUser(ctx)
      .from("notes")
      .select("id, title, body, tags, url, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (tag) q = q.contains("tags", [tag]);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { notes: data ?? [] },
    };
  },
});
