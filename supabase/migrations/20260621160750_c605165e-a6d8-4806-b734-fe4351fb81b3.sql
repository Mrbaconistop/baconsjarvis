-- Original table creation: discord_webhooks
CREATE TABLE public.discord_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Daily Briefing',
  url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  include_email boolean NOT NULL DEFAULT true,
  include_calendar boolean NOT NULL DEFAULT true,
  include_reminders boolean NOT NULL DEFAULT true,
  include_checkin boolean NOT NULL DEFAULT true,
  include_spending boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discord_webhooks TO authenticated;
GRANT ALL ON public.discord_webhooks TO service_role;
ALTER TABLE public.discord_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own webhooks" ON public.discord_webhooks FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Original table creation: daily_checkins
CREATE TABLE public.daily_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  weight_lbs numeric,
  height_in numeric,
  mood text,
  energy smallint,
  sleep_hours numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_checkins TO authenticated;
GRANT ALL ON public.daily_checkins TO service_role;
ALTER TABLE public.daily_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own checkins" ON public.daily_checkins FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================
-- NEW: Add @everyone toggle to discord_webhooks
-- =============================================
ALTER TABLE public.discord_webhooks ADD COLUMN IF NOT EXISTS include_mention_everyone BOOLEAN NOT NULL DEFAULT false;

-- Re-grant permissions (safe to run multiple times)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discord_webhooks TO authenticated;
GRANT ALL ON public.discord_webhooks TO service_role;

-- Re-create policy to include new column
DROP POLICY IF EXISTS "own webhooks" ON public.discord_webhooks;
CREATE POLICY "own webhooks" ON public.discord_webhooks FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);