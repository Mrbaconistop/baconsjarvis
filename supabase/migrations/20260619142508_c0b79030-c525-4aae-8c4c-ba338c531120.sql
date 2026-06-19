
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Enums
CREATE TYPE public.priority_level AS ENUM ('critical', 'high', 'normal', 'low');
CREATE TYPE public.notification_type AS ENUM ('alert', 'update', 'warning', 'briefing');
CREATE TYPE public.social_platform AS ENUM ('twitter', 'linkedin', 'instagram', 'facebook', 'gmail', 'calendar');
CREATE TYPE public.sentiment_label AS ENUM ('positive', 'neutral', 'negative');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  preferred_briefing_time TIME NOT NULL DEFAULT '08:00',
  address_as TEXT NOT NULL DEFAULT 'Sir',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Connected accounts
CREATE TABLE public.connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform public.social_platform NOT NULL,
  handle TEXT,
  profile_pic_url TEXT,
  status TEXT NOT NULL DEFAULT 'demo',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.connected_accounts TO authenticated;
GRANT ALL ON public.connected_accounts TO service_role;
ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own accounts" ON public.connected_accounts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Reminders
CREATE TABLE public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  datetime TIMESTAMPTZ NOT NULL,
  priority public.priority_level NOT NULL DEFAULT 'normal',
  is_completed BOOLEAN NOT NULL DEFAULT false,
  source_type TEXT,
  source_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT ALL ON public.reminders TO service_role;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reminders" ON public.reminders FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX reminders_user_datetime_idx ON public.reminders (user_id, datetime);

-- Social feeds
CREATE TABLE public.social_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform public.social_platform NOT NULL,
  author_name TEXT NOT NULL,
  author_handle TEXT,
  author_avatar TEXT,
  content TEXT NOT NULL,
  url TEXT,
  sentiment_score NUMERIC(3,2),
  sentiment_label public.sentiment_label,
  priority public.priority_level NOT NULL DEFAULT 'normal',
  is_actionable BOOLEAN NOT NULL DEFAULT false,
  is_handled BOOLEAN NOT NULL DEFAULT false,
  parent_post_id TEXT,
  external_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_feeds TO authenticated;
GRANT ALL ON public.social_feeds TO service_role;
ALTER TABLE public.social_feeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own feeds" ON public.social_feeds FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX social_feeds_user_received_idx ON public.social_feeds (user_id, received_at DESC);

-- Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.notification_type NOT NULL DEFAULT 'update',
  priority public.priority_level NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_status BOOLEAN NOT NULL DEFAULT false,
  action_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_table TEXT,
  source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications" ON public.notifications FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX notifications_user_created_idx ON public.notifications (user_id, created_at DESC);

-- Engagement stats
CREATE TABLE public.engagement_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform public.social_platform NOT NULL,
  stat_date DATE NOT NULL,
  hour_of_day SMALLINT NOT NULL DEFAULT 12,
  impressions INTEGER NOT NULL DEFAULT 0,
  engagements INTEGER NOT NULL DEFAULT 0,
  posts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, platform, stat_date, hour_of_day)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement_stats TO authenticated;
GRANT ALL ON public.engagement_stats TO service_role;
ALTER TABLE public.engagement_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own stats" ON public.engagement_stats FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- New user trigger: profile + default role + seed demo data
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := NEW.id;
BEGIN
  INSERT INTO public.profiles (id, name, email, avatar_url)
  VALUES (
    uid,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'user');

  -- Seed demo connected accounts
  INSERT INTO public.connected_accounts (user_id, platform, handle, status) VALUES
    (uid, 'twitter', '@you', 'demo'),
    (uid, 'linkedin', 'You', 'demo'),
    (uid, 'instagram', '@you', 'demo'),
    (uid, 'facebook', 'Your Page', 'demo');

  -- Seed demo reminders
  INSERT INTO public.reminders (user_id, title, description, datetime, priority, source_type) VALUES
    (uid, 'Board meeting', 'Q4 strategy review with leadership team', now() + interval '3 hours', 'critical', 'calendar'),
    (uid, 'Call David Chen', 'Discuss the Stark Industries partnership', now() + interval '1 day', 'high', 'manual'),
    (uid, 'Flight to Tokyo', 'Departs Haneda 09:40 — leave by 06:30 for traffic', now() + interval '2 days', 'high', 'gmail'),
    (uid, 'Review quarterly report', NULL, now() + interval '5 days', 'normal', 'manual');

  -- Seed demo social feed
  INSERT INTO public.social_feeds (user_id, platform, author_name, author_handle, content, sentiment_score, sentiment_label, priority, is_actionable, received_at) VALUES
    (uid, 'twitter', 'Maya Patel', '@mayatech', 'Honestly disappointed with the latest release. Expected more.', -0.72, 'negative', 'critical', true, now() - interval '12 minutes'),
    (uid, 'linkedin', 'Rachel Okonkwo', 'rachel-okonkwo', 'Would love to connect — admired your keynote at TechSummit.', 0.65, 'positive', 'high', true, now() - interval '34 minutes'),
    (uid, 'twitter', 'Dev Community', '@devcomm', 'Your thread on edge architecture has 2.4k retweets and counting 🚀', 0.88, 'positive', 'normal', false, now() - interval '1 hour'),
    (uid, 'instagram', 'studio.kira', '@studio.kira', 'Loved meeting you at the gallery opening!', 0.78, 'positive', 'normal', true, now() - interval '2 hours'),
    (uid, 'facebook', 'James Wright', 'jwright', 'Question about your products page — link seems broken?', -0.2, 'neutral', 'high', true, now() - interval '3 hours'),
    (uid, 'twitter', 'AnonUser88', '@anon88', 'overrated and overhyped honestly', -0.81, 'negative', 'critical', true, now() - interval '4 hours'),
    (uid, 'linkedin', 'Sofia Restrepo', 'sofia-r', 'Congratulations on the funding round!', 0.92, 'positive', 'normal', false, now() - interval '5 hours');

  -- Seed demo notifications
  INSERT INTO public.notifications (user_id, type, priority, title, message, action_payload) VALUES
    (uid, 'alert', 'critical', 'Negative mention detected',
     'Sir, a hostile tweet from @anon88 has been flagged. I advise focusing on your board meeting in 3 hours. Shall I draft a measured reply?',
     '[{"type":"reply_ai","label":"Draft reply"},{"type":"snooze","label":"Snooze 2h","minutes":120},{"type":"dismiss","label":"Dismiss"}]'::jsonb),
    (uid, 'update', 'high', 'LinkedIn connection request',
     'Rachel Okonkwo (Director of Engineering, Northwind) requests to connect with a personalised note.',
     '[{"type":"accept_with_note","label":"Accept with note"},{"type":"ignore","label":"Ignore"}]'::jsonb),
    (uid, 'briefing', 'normal', 'Morning briefing ready',
     'Sir, your overnight digest: 14 new followers, 1 viral thread (2.4k RTs), 1 critical mention requiring attention.',
     '[{"type":"view","label":"View briefing"}]'::jsonb);

  -- Seed engagement stats (past 30 days, random-ish)
  INSERT INTO public.engagement_stats (user_id, platform, stat_date, hour_of_day, impressions, engagements, posts)
  SELECT
    uid,
    (ARRAY['twitter','linkedin','instagram','facebook']::public.social_platform[])[1 + floor(random()*4)::int],
    (current_date - (i || ' days')::interval)::date,
    h,
    (500 + floor(random()*4000))::int,
    (20 + floor(random()*400))::int,
    CASE WHEN random() < 0.15 THEN 1 ELSE 0 END
  FROM generate_series(0, 29) AS i, generate_series(7, 22, 3) AS h;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.social_feeds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.reminders;
