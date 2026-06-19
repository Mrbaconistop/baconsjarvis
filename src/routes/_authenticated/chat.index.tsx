import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/chat")({
  ssr: false,
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
    // Find latest thread or create one, then redirect.
    const { data: existing } = await supabase
      .from("chat_threads").select("id")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (existing) throw redirect({ to: "/chat/$threadId", params: { threadId: existing.id } });
    const { data: created, error } = await supabase
      .from("chat_threads").insert({ user_id: session.user.id, title: "New conversation" })
      .select("id").single();
    if (error || !created) throw new Error(error?.message ?? "Could not start chat");
    throw redirect({ to: "/chat/$threadId", params: { threadId: created.id } });
  },
});
