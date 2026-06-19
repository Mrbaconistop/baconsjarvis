import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function hashPin(pin: string, userId: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export const setVaultPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    pin: z.string().min(4).max(28),
    currentPin: z.string().min(4).max(28).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: prof } = await supabase.from("profiles").select("vault_pin_hash").eq("id", userId).maybeSingle();
    if (prof?.vault_pin_hash) {
      if (!data.currentPin) throw new Error("Current PIN required to change it");
      const cur = await hashPin(data.currentPin, userId);
      if (cur !== prof.vault_pin_hash) throw new Error("Current PIN is incorrect");
    }
    const hash = await hashPin(data.pin, userId);
    const { error } = await supabase.from("profiles").update({ vault_pin_hash: hash }).eq("id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const hasVaultPin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data } = await supabase.from("profiles").select("vault_pin_hash").eq("id", userId).maybeSingle();
    return { hasPin: !!data?.vault_pin_hash };
  });
