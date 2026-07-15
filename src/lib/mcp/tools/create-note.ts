import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_note",
  title: "Create note",
  description: "Create a note for the signed-in JARVIS user.",
  inputSchema: {
    body: z.string().min(1).describe("Note body (markdown allowed)."),
    title: z.string().optional().describe("Optional title."),
    tags: z.array(z.string()).optional().describe("Optional tags."),
    url: z.string().url().optional().describe("Optional source URL."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ body, title, tags, url }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("notes")
      .insert({ user_id: ctx.getUserId()!, body, title: title ?? null, tags: tags ?? [], url: url ?? null })
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return { content: [{ type: "text", text: `Created note ${data.id}` }], structuredContent: { note: data } };
  },
});
