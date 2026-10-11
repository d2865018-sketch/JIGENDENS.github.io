-- ========================================================
-- SoundWave: Налаштування прав адміністратора для таблиці community_media
-- Запустити в Supabase Dashboard: SQL Editor -> New query -> Run
-- ========================================================

-- Переконуємось, що RLS увімкнено
alter table if exists public.community_media enable row level security;

-- Очищуємо старі політики видалення, якщо вони є
drop policy if exists "community_media_delete" on public.community_media;
drop policy if exists "community_media_delete_all" on public.community_media;
drop policy if exists "community_media_admin_delete" on public.community_media;

-- Дозволити видалення залогіненим користувачам
-- (Сайт перевіряє права адміна через пароль 1230984576admin перед надсиланням запиту)
create policy "community_media_delete_all" on public.community_media
  for delete to authenticated using (true);

-- Дозволити видалення анонімним клієнтам (на випадок входу з паролем адміна без акаунта)
create policy "community_media_delete_anon" on public.community_media
  for delete to anon using (true);

-- Для перевірки (має показати активні політики):
-- select * from pg_policies where tablename = 'community_media';
