-- 1) Fix mutable search_path on match_memory
CREATE OR REPLACE FUNCTION public.match_memory(query_embedding vector, user_id uuid, match_count integer DEFAULT 5)
RETURNS TABLE(id uuid, message text, role text, created_at timestamp with time zone, similarity double precision)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    message_memory.id,
    message_memory.message,
    message_memory.role,
    message_memory.created_at,
    1 - (message_memory.embedding <=> query_embedding) AS similarity
  FROM public.message_memory
  WHERE message_memory.user_id = $2
  ORDER BY message_memory.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

-- 2) Re-issue any CashApp ingest cron jobs to use the private CRON_SECRET
DO $$
DECLARE
  j RECORD;
  cron_secret TEXT;
BEGIN
  -- vault.decrypted_secrets is only readable by privileged roles; migrations run as such.
  BEGIN
    SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets
    WHERE name = 'CRON_SECRET'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    cron_secret := NULL;
  END;

  FOR j IN
    SELECT jobid, jobname, schedule, command
    FROM cron.job
    WHERE command ILIKE '%ingest-cashapp%'
  LOOP
    PERFORM cron.unschedule(j.jobid);
    IF cron_secret IS NOT NULL THEN
      PERFORM cron.schedule(
        j.jobname,
        j.schedule,
        format(
          $cmd$SELECT net.http_post(
            url := 'https://project--e66d9074-0ef6-403c-a793-7588e4485a5f.lovable.app/api/public/hooks/ingest-cashapp',
            headers := jsonb_build_object('Content-Type','application/json','apikey',%L),
            body := '{}'::jsonb
          );$cmd$,
          cron_secret
        )
      );
    END IF;
  END LOOP;
END $$;