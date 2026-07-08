
CREATE OR REPLACE FUNCTION public.recall_chat_memory(
  _user_id uuid,
  _query text,
  _limit int DEFAULT 5
)
RETURNS TABLE(id uuid, role text, message text, created_at timestamptz, rank real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.id, m.role,
    COALESCE((SELECT string_agg(COALESCE(p->>'text',''), ' ')
              FROM jsonb_array_elements(m.parts) p WHERE p->>'type' = 'text'), '') AS message,
    m.created_at,
    ts_rank(m.fts, websearch_to_tsquery('english', _query)) AS rank
  FROM public.chat_messages m
  WHERE m.user_id = _user_id
    AND auth.uid() = _user_id
    AND m.fts @@ websearch_to_tsquery('english', _query)
    AND _query IS NOT NULL AND length(trim(_query)) > 0
  ORDER BY rank DESC, m.created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 20));
$$;

REVOKE EXECUTE ON FUNCTION public.recall_chat_memory(uuid, text, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.recall_chat_memory(uuid, text, int) TO authenticated, service_role;
