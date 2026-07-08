// Browser notification helpers. Registers permission, fires a native
// Notification for every new critical/high notification row that comes in
// via realtime, and exposes a manual pusher for JARVIS to trigger toasts.

import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const NOTIF_ENABLED_KEY = "jarvis-notif-enabled";

export function notifPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotifPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  const result = await Notification.requestPermission();
  if (result === "granted") localStorage.setItem(NOTIF_ENABLED_KEY, "true");
  return result;
}

export function pushBrowserNotification(title: string, body: string, opts?: { tag?: string; icon?: string }) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: opts?.tag, icon: opts?.icon ?? "/favicon.ico" });
  } catch (err) {
    console.warn("[notifications] push failed", err);
  }
}

/**
 * Mount once at the app root. Subscribes to the user's `notifications` table
 * inserts via Supabase Realtime and fires a browser + toast notification for
 * anything priority `high` or `critical`.
 */
export function useNotificationBridge() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let userId: string | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled || !data.user) return;
      userId = data.user.id;
      channel = supabase
        .channel(`notif-bridge-${userId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          (payload) => {
            const row = payload.new as { title?: string; message?: string; priority?: string; id?: string };
            const title = row.title ?? "JARVIS";
            const body = row.message ?? "";
            const priority = row.priority ?? "normal";
            // In-app toast for all
            if (priority === "critical") toast.error(title, { description: body });
            else if (priority === "high") toast.warning(title, { description: body });
            else toast.info(title, { description: body });
            // Native OS notification only for high+critical
            if (priority === "critical" || priority === "high") {
              pushBrowserNotification(title, body, { tag: row.id });
            }
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);
}
