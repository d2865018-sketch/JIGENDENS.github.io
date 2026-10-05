-- Таблиця для функції "Знайти друга (Потряси)".
-- Supabase → SQL Editor → Run

create table if not exists public.shakes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text,
  created_at timestamptz not null default now()
);

create index if not exists shakes_created_at_idx on public.shakes (created_at desc);

alter table public.shakes enable row level security;

drop policy if exists "shakes_select" on public.shakes;
drop policy if exists "shakes_insert" on public.shakes;
drop policy if exists "shakes_delete" on public.shakes;

-- бачити чужі потрясання можуть усі залогінені
create policy "shakes_select" on public.shakes
  for select to authenticated using (true);

-- додавати і видаляти можна тільки свої
create policy "shakes_insert" on public.shakes
  for insert to authenticated with check (auth.uid() = user_id);

create policy "shakes_delete" on public.shakes
  for delete to authenticated using (auth.uid() = user_id);
