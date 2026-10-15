-- ========================================================
-- SoundWave: Таблиця Загального Чату (General Chat)
-- Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ========================================================

create table if not exists public.general_chat (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  user_name text not null default 'Анонім',
  is_anonymous boolean not null default false,
  avatar_url text,
  message text not null,
  image_url text,
  created_at timestamptz not null default now()
);

-- Додати колонку image_url якщо таблиця вже існує
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'general_chat' and column_name = 'image_url'
  ) then
    alter table public.general_chat add column image_url text;
  end if;
end $$;

create index if not exists general_chat_created_at_idx on public.general_chat (created_at desc);

-- Увімкнути Row Level Security
alter table public.general_chat enable row level security;

-- Очистити старі політики
drop policy if exists "general_chat_select" on public.general_chat;
drop policy if exists "general_chat_insert" on public.general_chat;
drop policy if exists "general_chat_delete" on public.general_chat;

-- Читати повідомлення можуть усі (і залогінені, і гості)
create policy "general_chat_select" on public.general_chat
  for select using (true);

-- Писати повідомлення можуть усі (і залогінені, і гості)
create policy "general_chat_insert" on public.general_chat
  for insert with check (true);

-- Видаляти повідомлення можуть автори та адміністратори
create policy "general_chat_delete" on public.general_chat
  for delete using (true);

-- Додати до Realtime (якщо публікація існує)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.general_chat;
  end if;
exception when others then
  null;
end $$;

-- ========================================================
-- (Опціонально) Налаштування бакетів у Storage для фото
-- ========================================================
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('chat_images', 'chat_images', true)
on conflict (id) do update set public = true;

-- Політика на читання та додавання фото для всіх
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'storage_chat_images_public_read') then
    create policy "storage_chat_images_public_read" on storage.objects
      for select using (bucket_id in ('media', 'chat_images', 'music'));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'storage_chat_images_public_insert') then
    create policy "storage_chat_images_public_insert" on storage.objects
      for insert with check (bucket_id in ('media', 'chat_images', 'music'));
  end if;
exception when others then
  null;
end $$;

