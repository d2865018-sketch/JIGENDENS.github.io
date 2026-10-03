-- Прибирає великі base64-аватари з метаданих усіх користувачів
-- (вони роздувають JWT і ламають запити до бази).
-- Supabase → SQL Editor → Run
update auth.users
set raw_user_meta_data = raw_user_meta_data - 'customAvatar'
where raw_user_meta_data ? 'customAvatar'
  and left(raw_user_meta_data->>'customAvatar', 5) = 'data:';
