import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listFeeds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("social_feeds")
      .select("*")
      .eq("user_id", userId)
      .order("received_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  });

export const markFeedHandled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("social_feeds")
      .update({ is_handled: true })
      .eq("id", data.id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

/* Refresh demo feed — until real provider credentials are added, this seeds 1-2 fresh items per call. */
export const refreshFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const samples = [
      { platform: "twitter", author_name: "Priya Shah", author_handle: "@priyashah", content: "Just tried your latest product — game changer. 10/10 would recommend.", score: 0.86, label: "positive", priority: "normal", actionable: false },
      { platform: "twitter", author_name: "ColdTake42", author_handle: "@coldtake42", content: "This is the worst rollout I've seen in years. Refund please.", score: -0.78, label: "negative", priority: "critical", actionable: true },
      { platform: "linkedin", author_name: "Marcus Holm", author_handle: "marcus-holm", content: "Would value 15 minutes of your time next week to discuss a partnership.", score: 0.4, label: "positive", priority: "high", actionable: true },
      { platform: "instagram", author_name: "lensandlight", author_handle: "@lensandlight", content: "Featured your portrait in our weekly roundup ✨", score: 0.72, label: "positive", priority: "normal", actionable: false },
      { platform: "facebook", author_name: "Karen O.", author_handle: "karen.o", content: "Why has my order been delayed three times?", score: -0.55, label: "negative", priority: "high", actionable: true },
    ];
    const pick = samples[Math.floor(Math.random() * samples.length)];
    const { data: row, error } = await supabase
      .from("social_feeds")
      .insert({
        user_id: userId,
        platform: pick.platform,
        author_name: pick.author_name,
        author_handle: pick.author_handle,
        content: pick.content,
        sentiment_score: pick.score,
        sentiment_label: pick.label,
        priority: pick.priority,
        is_actionable: pick.actionable,
      })
      .select("*")
      .single();
    if (error) throw error;

    if (pick.priority === "critical") {
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "alert",
        priority: "critical",
        title: `Critical mention on ${pick.platform}`,
        message: `Sir, ${pick.author_name} posted: "${pick.content.slice(0, 80)}…" Shall I draft a measured reply?`,
        action_payload: [
          { type: "reply_ai", label: "Draft reply", feedId: row.id },
          { type: "snooze", label: "Snooze 2h", minutes: 120 },
          { type: "dismiss", label: "Dismiss" },
        ],
        source_table: "social_feeds",
        source_id: row.id,
      });
    }
    return row;
  });
