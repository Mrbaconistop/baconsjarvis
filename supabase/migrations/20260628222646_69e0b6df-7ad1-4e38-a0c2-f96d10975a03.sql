GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_sessions TO authenticated;
GRANT ALL ON public.learning_sessions TO service_role;

ALTER TABLE public.learning_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own learning sessions"
  ON public.learning_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_learning_sessions_updated ON public.learning_sessions;
CREATE TRIGGER trg_learning_sessions_updated
  BEFORE UPDATE ON public.learning_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();