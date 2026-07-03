CREATE TABLE IF NOT EXISTS public.custom_tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL,
  label text NOT NULL,
  icon text NOT NULL DEFAULT 'Sparkles',
  description text,
  content_html text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_tabs TO authenticated;
GRANT ALL ON public.custom_tabs TO service_role;

ALTER TABLE public.custom_tabs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own custom_tabs select" ON public.custom_tabs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own custom_tabs insert" ON public.custom_tabs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own custom_tabs update" ON public.custom_tabs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own custom_tabs delete" ON public.custom_tabs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS custom_tabs_user_sort_idx
  ON public.custom_tabs (user_id, sort_order, created_at);

ALTER PUBLICATION supabase_realtime ADD TABLE public.custom_tabs;