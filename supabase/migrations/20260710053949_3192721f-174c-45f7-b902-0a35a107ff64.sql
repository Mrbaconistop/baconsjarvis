create table if not exists public.page_customizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route_key text not null,
  enabled boolean not null default true,
  position text not null default 'bottom' check (position in ('top','bottom','floating','replace')),
  css text not null default '',
  js text not null default '',
  html text not null default '',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, route_key)
);
grant select, insert, update, delete on public.page_customizations to authenticated;
grant all on public.page_customizations to service_role;
alter table public.page_customizations enable row level security;
create policy "pc own read"   on public.page_customizations for select to authenticated using (auth.uid() = user_id);
create policy "pc own insert" on public.page_customizations for insert to authenticated with check (auth.uid() = user_id);
create policy "pc own update" on public.page_customizations for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "pc own delete" on public.page_customizations for delete to authenticated using (auth.uid() = user_id);
create index if not exists page_customizations_user_route_idx on public.page_customizations(user_id, route_key);