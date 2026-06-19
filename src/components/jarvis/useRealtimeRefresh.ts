import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export function useRealtimeRefresh(userId: string | null) {
  const qc = useQueryClient();
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel("jarvis-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["notifications"] });
        setPulse((n) => n + 1);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "social_feeds", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["feeds"] });
        setPulse((n) => n + 1);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "reminders", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["reminders"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, qc]);
  return pulse;
}
