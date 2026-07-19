import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const IndicatorPrefSchema = z.object({
  enabled: z.boolean(),
  period: z.number().int().min(2).max(400).optional(),
});

export const AnalyzerPrefsSchema = z.object({
  indicators: z
    .object({
      sma: IndicatorPrefSchema,
      ema: IndicatorPrefSchema,
      rsi: IndicatorPrefSchema,
      macd: IndicatorPrefSchema,
      bollinger: IndicatorPrefSchema,
      vwap: IndicatorPrefSchema,
      fibonacci: IndicatorPrefSchema,
    })
    .partial(),
  sensitivity: z.number().min(0).max(100),
  lookback: z.enum(["1m", "3m", "6m", "1y", "5y"]),
  sentimentEnabled: z.boolean(),
  sentimentWeight: z.number().min(0).max(100),
  warMode: z.boolean(),
});

export type AnalyzerPrefs = z.infer<typeof AnalyzerPrefsSchema>;

export const DEFAULT_ANALYZER_PREFS: AnalyzerPrefs = {
  indicators: {
    sma: { enabled: true, period: 20 },
    ema: { enabled: false, period: 20 },
    rsi: { enabled: true, period: 14 },
    macd: { enabled: true },
    bollinger: { enabled: false, period: 20 },
    vwap: { enabled: false },
    fibonacci: { enabled: false },
  },
  sensitivity: 50,
  lookback: "1y",
  sentimentEnabled: true,
  sentimentWeight: 50,
  warMode: false,
};

export const LOOKBACK_DAYS: Record<AnalyzerPrefs["lookback"], number> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
  "5y": 1825,
};

export const getAnalyzerPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data } = await supabase
      .from("user_facts")
      .select("value")
      .eq("user_id", userId)
      .eq("category", "analyzer")
      .eq("key", "prefs")
      .maybeSingle();
    if (!data?.value) return DEFAULT_ANALYZER_PREFS;
    try {
      return AnalyzerPrefsSchema.parse(JSON.parse(data.value));
    } catch {
      return DEFAULT_ANALYZER_PREFS;
    }
  });

export const setAnalyzerPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AnalyzerPrefsSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await supabase
      .from("user_facts")
      .delete()
      .eq("user_id", userId)
      .eq("category", "analyzer")
      .eq("key", "prefs");
    const { error } = await supabase.from("user_facts").insert({
      user_id: userId,
      category: "analyzer",
      key: "prefs",
      value: JSON.stringify(data),
    });
    if (error) throw error;
    return { ok: true };
  });
