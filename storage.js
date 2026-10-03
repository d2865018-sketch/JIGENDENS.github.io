/* ========================================
   SoundWave — Supabase Storage Module (fixed)
   ======================================== */

const publicUrlMap = {};

// Показуємо помилку не через alert (він спамить для кожного треку)
function swNotify(msg) {
  console.warn('[Storage]', msg);
  if (typeof showNotification === 'function') showNotification(msg);
}

async function swGetSession() {
  if (typeof supabaseClient === 'undefined') return null;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session;
  } catch (e) {
    return null;
  }
}

/**
 * Завантажує файл у bucket "music" і ПОВЕРТАЄ публічний URL (або null).
 * Рядок у таблиці тут не чіпаємо — його створює swSaveTracksMeta (upsert).
 */
async function swSaveAudio(trackId, blob) {
  const session = await swGetSession();
  if (!session) {
    swNotify('❌ Помилка: Не авторизовано у Supabase');
    return null;
  }

  try {
    const ext = blob.name
      ? blob.name.split('.').pop().toLowerCase()
      : ((blob.type.split('/')[1] || 'mp3').replace('mpeg', 'mp3'));
    const filePath = `${session.user.id}/${trackId}.${ext}`;

    const { error } = await supabaseClient.storage
      .from('music')
      .upload(filePath, blob, { upsert: true, contentType: blob.type || 'audio/mpeg' });

    if (error) {
      swNotify('❌ Помилка завантаження файлу: ' + error.message);
      return null;
    }

    const { data } = supabaseClient.storage.from('music').getPublicUrl(filePath);
    publicUrlMap[trackId] = data.publicUrl;
    return data.publicUrl;
  } catch (e) {
    console.error('[Storage] swSaveAudio failed:', e);
    swNotify('❌ Немає зв’язку з сервером (Supabase)');
    return null;
  }
}

async function swGetAudio(trackId) {
  return null;
}

async function swDeleteAudio(trackId) {}

/**
 * Зберігає метадані всіх треків одним запитом.
 * Треки, у яких ще немає справжнього URL (blob:), пропускаються —
 * інакше в базі з'являється порожній file_url і трек зникає після перезавантаження.
 */
async function swSaveTracksMeta(email, tracks) {
  const session = await swGetSession();
  if (!session) return false;

  const rows = [];
  for (const t of tracks) {
    let fileUrl = t.src || '';
    if (fileUrl.startsWith('blob:')) fileUrl = publicUrlMap[t.id] || '';
    if (!fileUrl) continue;

    rows.push({
      id: String(t.id),
      user_id: session.user.id,
      title: t.title,
      artist: t.artist,
      file_url: fileUrl,
      cover_url: t.cover,
      is_public: !!t.is_public
    });
  }
  if (rows.length === 0) return true;

  try {
    const { error } = await supabaseClient
      .from('tracks')
      .upsert(rows, { onConflict: 'id' });

    if (error) {
      console.error('Upsert error:', error);
      swNotify('❌ Помилка збереження в базі: ' + error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[Storage] swSaveTracksMeta failed:', e);
    swNotify('❌ Немає зв’язку з сервером (Supabase)');
    return false;
  }
}

function swMapRow(d, genre, forcePublic) {
  publicUrlMap[d.id] = d.file_url;
  return {
    id: d.id,
    title: d.title,
    artist: d.artist || 'Невідомий',
    genre,
    cover: d.cover_url || null,
    src: d.file_url,
    is_public: forcePublic || d.is_public || false,
    liked: false
  };
}

async function swLoadTracks(email) {
  const session = await swGetSession();
  if (!session) return [];

  try {
    const { data, error } = await supabaseClient
      .from('tracks')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: true });

    if (error) {
      swNotify('❌ Помилка завантаження треків: ' + error.message);
      return [];
    }
    return data.map(d => swMapRow(d, 'Завантажене', false)).filter(t => t.src);
  } catch (e) {
    console.error('[Storage] swLoadTracks failed:', e);
    swNotify('❌ Немає зв’язку з сервером (Supabase)');
    return [];
  }
}

async function swLoadPublicTracks() {
  if (typeof supabaseClient === 'undefined') return [];

  try {
    const { data, error } = await supabaseClient
      .from('tracks')
      .select('*')
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    if (error) {
      swNotify('❌ Помилка завантаження Спільноти: ' + error.message);
      return [];
    }
    return data.map(d => swMapRow(d, 'Спільнота', true)).filter(t => t.src);
  } catch (e) {
    console.error('[Storage] swLoadPublicTracks failed:', e);
    return [];
  }
}

async function swDeleteTrack(email, trackId) {
  const session = await swGetSession();
  if (!session) return;

  try {
    // Видаляємо і файл зі Storage, якщо вдається визначити шлях
    const url = publicUrlMap[trackId];
    if (url && url.includes('/music/')) {
      const path = decodeURIComponent(url.split('/music/')[1].split('?')[0]);
      await supabaseClient.storage.from('music').remove([path]);
    }
    await supabaseClient.from('tracks').delete().eq('id', String(trackId));
    delete publicUrlMap[trackId];
  } catch (e) {
    console.error('[Storage] swDeleteTrack failed:', e);
  }
}
