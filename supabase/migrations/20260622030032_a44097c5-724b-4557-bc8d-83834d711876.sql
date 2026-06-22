
CREATE TABLE public.map_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  notes TEXT,
  place_id TEXT,
  category TEXT,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.map_places TO authenticated;
GRANT ALL ON public.map_places TO service_role;

ALTER TABLE public.map_places ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own places"
  ON public.map_places
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER map_places_touch_updated_at
  BEFORE UPDATE ON public.map_places
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX map_places_user_idx ON public.map_places(user_id, created_at DESC);
