-- ========================================================
-- SoundWave: Налаштування повного видалення постів (community_media)
-- Запустити в Supabase Dashboard: SQL Editor -> New query -> Paste -> Run
-- ========================================================

-- 1. Переконуємось, що RLS увімкнено
alter table if exists public.community_media enable row level security;

-- 2. Очищуємо старі або обмежувальні політики видалення
drop policy if exists "community_media_delete" on public.community_media;
drop policy if exists "community_media_delete_all" on public.community_media;
drop policy if exists "community_media_delete_anon" on public.community_media;
drop policy if exists "community_media_admin_delete" on public.community_media;

-- 3. Дозволяємо видалення постів (перевірка пароля адміна 1230984576admin та авторства відбувається на сайті)
create policy "community_media_delete" on public.community_media
  for delete using (true);

-- 4. Видаляємо старий завислий пост Олени (чиє фото вже видалено зі Storage)
delete from public.community_media where id = '1791443888723541';

-- 5. Для перевірки (має показати активні політики):
-- select * from pg_policies where tablename = 'community_media';
