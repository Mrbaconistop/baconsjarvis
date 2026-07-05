ALTER TABLE public.chat_threads ADD COLUMN IF NOT EXISTS tab_slug text;
CREATE INDEX IF NOT EXISTS idx_chat_threads_user_tab ON public.chat_threads(user_id, tab_slug);