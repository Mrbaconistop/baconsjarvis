
-- ============================================================
-- 1. FULL-TEXT SEARCH ON chat_messages (permanent keyword memory)
-- ============================================================
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS fts tsvector;

CREATE OR REPLACE FUNCTION public.chat_messages_fts_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE txt text;
BEGIN
  IF NEW.parts IS NOT NULL THEN
    SELECT string_agg(COALESCE(p->>'text',''), ' ')
      INTO txt
      FROM jsonb_array_elements(NEW.parts) p
      WHERE p->>'type' = 'text';
  END IF;
  NEW.fts := to_tsvector('english', COALESCE(txt, ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_fts_trg ON public.chat_messages;
CREATE TRIGGER chat_messages_fts_trg
  BEFORE INSERT OR UPDATE OF parts ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_messages_fts_update();

CREATE INDEX IF NOT EXISTS chat_messages_fts_idx
  ON public.chat_messages USING gin(fts);

-- Backfill existing rows
UPDATE public.chat_messages
SET fts = to_tsvector('english', COALESCE((
  SELECT string_agg(COALESCE(p->>'text',''), ' ')
  FROM jsonb_array_elements(parts) p
  WHERE p->>'type' = 'text'
), ''))
WHERE fts IS NULL;

-- ============================================================
-- 2. RECALL RPC (FTS over chat_messages + user_facts)
-- ============================================================
CREATE OR REPLACE FUNCTION public.recall_chat_memory(
  _user_id uuid,
  _query text,
  _limit int DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  role text,
  message text,
  created_at timestamptz,
  rank real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.role,
    COALESCE((
      SELECT string_agg(COALESCE(p->>'text',''), ' ')
      FROM jsonb_array_elements(m.parts) p
      WHERE p->>'type' = 'text'
    ), '') AS message,
    m.created_at,
    ts_rank(m.fts, websearch_to_tsquery('english', _query)) AS rank
  FROM public.chat_messages m
  WHERE m.user_id = _user_id
    AND m.fts @@ websearch_to_tsquery('english', _query)
    AND _query IS NOT NULL AND length(trim(_query)) > 0
  ORDER BY rank DESC, m.created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 20));
$$;

GRANT EXECUTE ON FUNCTION public.recall_chat_memory(uuid, text, int) TO authenticated, service_role;

-- ============================================================
-- 3. PROACTIVE WATCHER — every 5 minutes
-- ============================================================
DO $$
DECLARE
  cron_secret text;
BEGIN
  SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;

  IF cron_secret IS NULL THEN
    RAISE NOTICE 'CRON_SECRET not found in vault; skipping cron seed';
    RETURN;
  END IF;

  PERFORM cron.unschedule('jarvis-watcher-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jarvis-watcher-tick');

  PERFORM cron.schedule(
    'jarvis-watcher-tick',
    '*/5 * * * *',
    format($cmd$SELECT net.http_post(
      url := 'https://project--e66d9074-0ef6-403c-a793-7588e4485a5f.lovable.app/api/public/hooks/watcher-tick',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', %L),
      body := '{}'::jsonb
    ) AS request_id;$cmd$, cron_secret)
  );
END $$;
