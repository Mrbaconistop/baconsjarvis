CREATE TABLE public.user_facts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'general',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_facts TO authenticated;
GRANT ALL ON public.user_facts TO service_role;
ALTER TABLE public.user_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own facts" ON public.user_facts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER touch_user_facts BEFORE UPDATE ON public.user_facts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_user_facts_user ON public.user_facts(user_id, category);