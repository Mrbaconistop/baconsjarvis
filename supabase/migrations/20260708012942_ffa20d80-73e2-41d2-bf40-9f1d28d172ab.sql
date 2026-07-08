
CREATE TABLE IF NOT EXISTS public.router_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  intent text NOT NULL,
  provider text NOT NULL,
  model_id text NOT NULL,
  has_image boolean NOT NULL DEFAULT false,
  user_text_snippet text,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  recalled_count int NOT NULL DEFAULT 0,
  thread_id uuid
);
CREATE INDEX IF NOT EXISTS router_traces_user_created_idx ON public.router_traces(user_id, created_at DESC);
GRANT SELECT, INSERT ON public.router_traces TO authenticated;
GRANT ALL ON public.router_traces TO service_role;
ALTER TABLE public.router_traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own router traces" ON public.router_traces
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.watcher_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  watcher text NOT NULL,
  ok boolean NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  duration_ms int
);
CREATE INDEX IF NOT EXISTS watcher_runs_ran_at_idx ON public.watcher_runs(ran_at DESC);
GRANT SELECT ON public.watcher_runs TO authenticated;
GRANT ALL ON public.watcher_runs TO service_role;
ALTER TABLE public.watcher_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read watcher runs" ON public.watcher_runs
  FOR SELECT TO authenticated USING (true);
