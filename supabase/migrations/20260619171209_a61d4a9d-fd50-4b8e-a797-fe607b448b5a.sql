-- CASH ON HAND
CREATE TABLE public.cash_balances (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_balances TO authenticated;
GRANT ALL ON public.cash_balances TO service_role;
ALTER TABLE public.cash_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cash" ON public.cash_balances FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER cash_balances_touch BEFORE UPDATE ON public.cash_balances
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- STOCK HOLDINGS
CREATE TABLE public.stock_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  shares NUMERIC(20,6) NOT NULL DEFAULT 0,
  avg_cost_cents BIGINT,
  last_price_cents BIGINT,
  last_price_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, ticker)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_holdings TO authenticated;
GRANT ALL ON public.stock_holdings TO service_role;
ALTER TABLE public.stock_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own holdings" ON public.stock_holdings FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER stock_holdings_touch BEFORE UPDATE ON public.stock_holdings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX stock_holdings_user_idx ON public.stock_holdings(user_id);