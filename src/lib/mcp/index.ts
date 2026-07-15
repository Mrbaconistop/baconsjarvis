import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listNotes from "./tools/list-notes";
import createNote from "./tools/create-note";
import listReminders from "./tools/list-reminders";
import createReminder from "./tools/create-reminder";
import searchChatMemory from "./tools/search-chat-memory";
import listStockHoldings from "./tools/list-stock-holdings";

// Direct Supabase auth issuer (never the .lovable.cloud proxy).
// VITE_SUPABASE_PROJECT_ID is inlined at build time; fallback keeps the issuer
// well-formed during the throwaway manifest-extract eval.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "jarvis-mcp",
  title: "JARVIS",
  version: "0.1.0",
  instructions:
    "Tools for a signed-in JARVIS user: manage notes and reminders, search chat memory, and read tracked stock holdings. Every tool acts as the authenticated user via Supabase RLS.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listNotes, createNote, listReminders, createReminder, searchChatMemory, listStockHoldings],
});
