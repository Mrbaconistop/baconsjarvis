-- Remove the cron job that depends on pg_net before dropping the extension
DO $$ BEGIN
  PERFORM cron.unschedule('ingest-cashapp-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Recreate the hourly Cash App ingest job using the new schema
SELECT cron.schedule(
  'ingest-cashapp-hourly',
  '7 * * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://project--e66d9074-0ef6-403c-a793-7588e4485a5f.lovable.app/api/public/hooks/ingest-cashapp',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);