
DROP POLICY IF EXISTS "own cash" ON public.cash_balances;
CREATE POLICY "own cash" ON public.cash_balances FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own checkins" ON public.daily_checkins;
CREATE POLICY "own checkins" ON public.daily_checkins FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own webhooks" ON public.discord_webhooks;
CREATE POLICY "own webhooks" ON public.discord_webhooks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own memory" ON public.message_memory;
CREATE POLICY "Users can manage their own memory" ON public.message_memory FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own notes" ON public.notes;
CREATE POLICY "own notes" ON public.notes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own holdings" ON public.stock_holdings;
CREATE POLICY "own holdings" ON public.stock_holdings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
