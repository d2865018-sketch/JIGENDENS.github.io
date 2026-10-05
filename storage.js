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
  if (!session) return null;

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

  const ownerName = (session.user.user_metadata && session.user.user_metadata.name) || 'Користувач';
  const rows = [];
  let skipped = 0;
  for (const t of tracks) {
    let fileUrl = t.src || '';
    if (fileUrl.startsWith('blob:')) fileUrl = publicUrlMap[t.id] || '';
    if (!fileUrl) { skipped++; continue; }

    rows.push({
      id: String(t.id),
      user_id: session.user.id,
      title: t.title,
      artist: t.artist,
      file_url: fileUrl,
      cover_url: t.cover,
      is_public: !!t.is_public,
      owner_name: t.is_anonymous ? 'Анонім' : ownerName
    });
  }
  if (rows.length === 0) {
    if (skipped > 0) swNotify('⚠️ Файл ще не завантажений у хмару — перевір, що ти увійшов в акаунт');
    return skipped === 0;
  }

  try {
    let { error } = await supabaseClient
      .from('tracks')
      .upsert(rows, { onConflict: 'id' });

    // Якщо колонки owner_name ще немає (SQL не виконано) — зберігаємо без неї
    if (error && /owner_name/i.test(error.message)) {
      ({ error } = await supabaseClient
        .from('tracks')
        .upsert(rows.map(({ owner_name, ...r }) => r), { onConflict: 'id' }));
    }

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

function swSafeCover(cover, id) {
  if (cover && (cover.startsWith('http') || cover.startsWith('data:'))) return cover;
  const list = (typeof COVERS !== 'undefined' && COVERS.length) ? COVERS : null;
  if (!list) return cover || '';
  let h = 0;
  for (const ch of String(id)) h = (h + ch.charCodeAt(0)) % 9973;
  return list[h % list.length];
}

function swMapRow(d, genre, forcePublic) {
  publicUrlMap[d.id] = d.file_url;
  return {
    id: d.id,
    title: d.title,
    artist: d.artist || 'Невідомий',
    genre,
    cover: swSafeCover(d.cover_url, d.id),
    src: d.file_url,
    is_public: forcePublic || d.is_public || false,
    owner: d.owner_name || null,
    owner_id: d.user_id || null,
    is_anonymous: d.owner_name === 'Анонім',
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
    if (data.some(d => !d.owner_name)) {
      const nm = (session.user.user_metadata && session.user.user_metadata.name) || 'Користувач';
      supabaseClient.from('tracks').update({ owner_name: nm })
        .eq('user_id', session.user.id).is('owner_name', null).then(() => {}, () => {});
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


/* ========================================
   Публічні плейлисти (розділ "Спільнота")
   ======================================== */

// Обкладинка треку для знімка плейлиста: лише http/data, і не завелика
function swSnapshotCover(cover, id) {
  if (cover && cover.startsWith('data:') && cover.length > 60000) cover = null;
  return swSafeCover(cover, id);
}

/**
 * Публікує (або оновлює) плейлист у Спільноті.
 * Зберігається копія треків: назва, виконавець, обкладинка, посилання на файл.
 * Повертає { ok, count, skipped }.
 */
async function swPublishPlaylist(pl, allTracks, ownerName) {
  const session = await swGetSession();
  if (!session) { swNotify('⚠️ Увійди в акаунт, щоб публікувати'); return { ok: false }; }

  const snapshot = [];
  let skipped = 0;
  for (const id of pl.trackIds) {
    const t = allTracks.find(x => String(x.id) === String(id));
    if (!t) { skipped++; continue; }
    let src = t.src || '';
    if (src.startsWith('blob:')) src = publicUrlMap[t.id] || '';
    if (!/^https?:/i.test(src)) { skipped++; continue; }   // без файлу — слухати неможливо
    snapshot.push({
      id: String(t.id),
      title: t.title,
      artist: t.artist,
      cover: swSnapshotCover(t.cover, t.id),
      src,
      duration: t.duration || 0
    });
  }

  if (snapshot.length === 0) {
    swNotify('⚠️ У плейлисті немає треків з аудіофайлом');
    return { ok: false };
  }

  let cover = pl.customCover || null;
  if (cover && cover.startsWith('data:') && cover.length > 200000) cover = null;

  try {
    const { error } = await supabaseClient.from('community_playlists').upsert({
      id: `${session.user.id}_${pl.id}`,
      user_id: session.user.id,
      owner_name: ownerName || 'Користувач',
      name: pl.name,
      description: pl.desc || '',
      gradient: pl.gradient || null,
      cover_url: cover,
      tracks: snapshot,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    if (error) {
      console.error('[Playlist] publish error:', error);
      swNotify('❌ Не вдалося опублікувати: ' + error.message);
      return { ok: false };
    }
    return { ok: true, count: snapshot.length, skipped };
  } catch (e) {
    console.error('[Playlist] publish failed:', e);
    swNotify('❌ Немає зв’язку з сервером');
    return { ok: false };
  }
}

async function swUnpublishPlaylist(plId) {
  const session = await swGetSession();
  if (!session) return false;
  try {
    const { error } = await supabaseClient
      .from('community_playlists')
      .delete()
      .eq('id', `${session.user.id}_${plId}`);
    if (error) { swNotify('❌ Не вдалося зняти з публікації: ' + error.message); return false; }
    return true;
  } catch (e) {
    console.error('[Playlist] unpublish failed:', e);
    return false;
  }
}

async function swLoadPublicPlaylists() {
  if (typeof supabaseClient === 'undefined') return [];
  try {
    const { data, error } = await supabaseClient
      .from('community_playlists')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(60);
    if (error) { swNotify('❌ Помилка завантаження плейлистів: ' + error.message); return []; }
    return data || [];
  } catch (e) {
    console.error('[Playlist] load failed:', e);
    return [];
  }
}


/* ========================================
   Фото і відео у Спільноті
   ======================================== */

async function swPublishMedia({ kind, caption, blob, ext }, ownerName) {
  const session = await swGetSession();
  if (!session) { swNotify('⚠️ Увійди в акаунт, щоб публікувати'); return { ok: false }; }

  const id = String(Date.now()) + Math.floor(Math.random() * 1000);
  const path = `${session.user.id}/${id}.${ext}`;

  try {
    const up = await supabaseClient.storage.from('media')
      .upload(path, blob, { upsert: false, contentType: blob.type || undefined });
    if (up.error) {
      swNotify('❌ Помилка завантаження: ' + up.error.message);
      return { ok: false };
    }

    const { data } = supabaseClient.storage.from('media').getPublicUrl(path);
    const { error } = await supabaseClient.from('community_media').insert({
      id,
      user_id: session.user.id,
      owner_name: ownerName || 'Користувач',
      kind,
      caption: caption || '',
      file_url: data.publicUrl
    });
    if (error) {
      await supabaseClient.storage.from('media').remove([path]);
      swNotify('❌ Не вдалося опублікувати: ' + error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('[Media] publish failed:', e);
    swNotify('❌ Немає зв’язку з сервером');
    return { ok: false };
  }
}

async function swLoadMedia() {
  if (typeof supabaseClient === 'undefined') return [];
  try {
    const { data, error } = await supabaseClient
      .from('community_media')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) { swNotify('❌ Помилка завантаження фото/відео: ' + error.message); return []; }
    return data || [];
  } catch (e) {
    console.error('[Media] load failed:', e);
    return [];
  }
}

async function swDeleteMedia(item) {
  const session = await swGetSession();
  if (!session) return false;
  try {
    const marker = '/media/';
    const i = item.file_url.indexOf(marker);
    if (i !== -1) {
      const path = decodeURIComponent(item.file_url.slice(i + marker.length).split('?')[0]);
      await supabaseClient.storage.from('media').remove([path]);
    }
    const { error } = await supabaseClient.from('community_media').delete().eq('id', item.id);
    if (error) { swNotify('❌ Не вдалося видалити: ' + error.message); return false; }
    return true;
  } catch (e) {
    console.error('[Media] delete failed:', e);
    return false;
  }
}
