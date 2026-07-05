import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), handled: z.boolean().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("social_feeds")
      .update({ is_handled: data.handled ?? true })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const refreshFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ platform: z.string().optional() }).parse(input ?? {}))
  .handler(async () => {
    return { ok: true, refreshed: 0 };
  });

export const importCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .array(
        z.object({
          platform: z.enum(["twitter", "linkedin", "instagram", "facebook", "gmail", "calendar"]),
          username: z.string().min(1),
          password: z.string().min(1),
        }),
      )
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const inserted: any[] = [];
    for (const cred of data) {
      const { data: row, error } = await supabase
        .from("vault_items")
        .insert({
          user_id: userId,
          kind: "credential",
          label: `Social: ${cred.platform}/${cred.username}`,
          tags: [cred.platform, "social"],
          data: {
            platform: cred.platform,
            username: cred.username,
            password: cred.password,
            note: `Imported credential for ${cred.platform}.`,
          },
        })
        .select("*")
        .single();
      if (error) throw error;
      inserted.push(row);
    }
    return inserted;
  });

export const setDiscordChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ channelId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase.from("user_facts").upsert(
      {
        user_id: userId,
        category: "discord",
        key: "feed_channel",
        value: data.channelId,
      },
      { onConflict: "user_id,category,key" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const getDiscordChannel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data } = await supabase
      .from("user_facts")
      .select("value")
      .eq("user_id", userId)
      .eq("category", "discord")
      .eq("key", "feed_channel")
      .maybeSingle();
    return { channelId: data?.value || null };
  });

export const fetchDiscordMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        channelId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) throw new Error("DISCORD_BOT_TOKEN not set.");

    let channelId = data.channelId;
    if (!channelId) {
      const { data: pref } = await supabase
        .from("user_facts")
        .select("value")
        .eq("user_id", userId)
        .eq("category", "discord")
        .eq("key", "feed_channel")
        .maybeSingle();
      channelId = pref?.value;
    }
    if (!channelId) throw new Error("No Discord channel configured.");

    const url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=${data.limit}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord API error: ${response.status} ${errorText}`);
    }
    const messages = await response.json();

    const posts = messages.map((msg: any) => ({
      user_id: userId,
      platform: "discord",
      author_name: msg.author.global_name || msg.author.username,
      author_handle: msg.author.username,
      content: msg.content || "(embed or attachment)",
      received_at: new Date(msg.timestamp).toISOString(),
      sentiment_label: "neutral",
      priority: "normal",
      is_actionable: false,
      external_id: msg.id,
      url: `https://discord.com/channels/${msg.guild_id}/${msg.channel_id}/${msg.id}`,
    }));

    const { data: inserted, error } = await supabase.from("social_feeds").insert(posts).select("*");
    if (error) throw error;
    return inserted;
  });

// ==================== DISCORD DMs ====================
export const fetchDiscordDMs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        limit: z.number().int().min(1).max(50).default(10),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) throw new Error("DISCORD_BOT_TOKEN not set.");

    // 1. Get bot's own user ID
    const botInfoRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!botInfoRes.ok) throw new Error("Failed to get bot info");
    const botInfo = await botInfoRes.json();

    // 2. Get list of DM channels
    const channelsRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!channelsRes.ok) throw new Error("Failed to fetch DM channels");
    const channels = await channelsRes.json();

    // 3. For each channel, fetch latest messages (limit 10)
    const allMessages: any[] = [];
    for (const channel of channels.slice(0, 5)) {
      const msgRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages?limit=${data.limit}`, {
        headers: { Authorization: `Bot ${token}` },
      });
      if (!msgRes.ok) continue;
      const msgs = await msgRes.json();
      for (const msg of msgs) {
        if (msg.author.id === botInfo.id) continue;
        allMessages.push({
          user_id: userId,
          platform: "discord_dm",
          author_name: msg.author.global_name || msg.author.username,
          author_handle: msg.author.username,
          content: msg.content || "(embed or attachment)",
          received_at: new Date(msg.timestamp).toISOString(),
          sentiment_label: "neutral",
          priority: "normal",
          is_actionable: false,
          external_id: msg.id,
          url: `https://discord.com/channels/@me/${channel.id}/${msg.id}`,
          channel_name: channel.recipients?.[0]?.username || "Unknown",
        });
      }
    }

    // 4. Insert into social_feeds
    const { data: inserted, error } = await supabase.from("social_feeds").insert(allMessages).select("*");
    if (error) throw error;
    return inserted;
  });
