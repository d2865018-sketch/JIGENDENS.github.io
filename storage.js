/* ========================================
   SoundWave — Supabase Storage Module
   ======================================== */

// We keep a local mapping of trackId to public URL so we can save it properly
const publicUrlMap = {};

async function swSaveAudio(trackId, blob) {
  if (typeof supabaseClient === 'undefined') return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  try {
    const ext = blob.name ? blob.name.split('.').pop() : (blob.type.split('/')[1] || 'mp3');
    const filePath = `${session.user.id}/${trackId}.${ext}`;
    
    // Upload to Supabase Storage
    const { data, error } = await supabaseClient.storage
      .from('music')
      .upload(filePath, blob, { upsert: true });
      
    if (error) throw error;

    // Get public URL
    const { data: publicUrlData } = supabaseClient.storage.from('music').getPublicUrl(filePath);
    const publicUrl = publicUrlData.publicUrl;
    
    publicUrlMap[trackId] = publicUrl;

    // We can also immediately update the database row if it exists
    await supabaseClient.from('tracks').update({ file_url: publicUrl }).eq('id', trackId);

  } catch (e) {
    console.error('[Storage] swSaveAudio failed:', e);
  }
}

async function swGetAudio(trackId) {
  return null; // No longer needed, we use direct URLs
}

async function swDeleteAudio(trackId) {
  // Handled in swDeleteTrack
}

async function swSaveTracksMeta(email, tracks) {
  if (typeof supabaseClient === 'undefined') return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  try {
    for (const t of tracks) {
      let fileUrl = t.src;
      // If it's a local object url, try to get the real URL
      if (fileUrl && fileUrl.startsWith('blob:')) {
         fileUrl = publicUrlMap[t.id] || '';
      }

      // Convert track ID to UUID if it's not (assuming it's a timestamp from app.js)
      // Since our table uses UUIDs by default for 'id', we need to pass a valid UUID.
      // Wait, app.js generates `Date.now().toString()`.
      // Let's modify our Supabase logic: if `t.id` is not a UUID, Supabase will reject it.
      // But we can just use text for ID in DB.
      // Let's assume we alter the table to use text for ID, or we just pass it.
      
      const { data, error } = await supabaseClient
        .from('tracks')
        .upsert({
          id: String(t.id),
          user_id: session.user.id,
          title: t.title,
          artist: t.artist,
          file_url: fileUrl,
          cover_url: t.cover,
          is_public: !!t.is_public
        }, { onConflict: 'id' });
    }
  } catch(e) {
    console.error(e);
  }
}

async function swLoadTracks(email) {
  if (typeof supabaseClient === 'undefined') return [];
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return [];

  try {
    const { data, error } = await supabaseClient
      .from('tracks')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return data.map(d => {
      publicUrlMap[d.id] = d.file_url;
      return {
        id: d.id,
        title: d.title,
        artist: d.artist || 'Невідомий',
        genre: 'Завантажене',
        cover: d.cover_url || null,
        src: d.file_url,
        is_public: d.is_public || false,
        liked: false
      };
    }).filter(t => t.src !== ''); 
  } catch (e) {
    console.error('[Storage] swLoadTracks failed:', e);
    return [];
  }
}

async function swLoadPublicTracks() {
  if (typeof supabaseClient === 'undefined') return [];

  try {
    const { data, error } = await supabaseClient
      .from('tracks')
      .select('*, auth_users:user_id(raw_user_meta_data)')
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data.map(d => {
      publicUrlMap[d.id] = d.file_url;
      let authorName = 'Невідомий користувач';
      if (d.auth_users && d.auth_users.raw_user_meta_data && d.auth_users.raw_user_meta_data.name) {
         authorName = d.auth_users.raw_user_meta_data.name;
      }

      return {
        id: d.id,
        title: d.title,
        artist: d.artist || authorName, // Use user name if artist not set properly, or just authorName
        genre: 'Спільнота',
        cover: d.cover_url || null,
        src: d.file_url,
        is_public: true,
        liked: false
      };
    }).filter(t => t.src !== ''); 
  } catch (e) {
    console.error('[Storage] swLoadPublicTracks failed:', e);
    return [];
  }
}

async function swDeleteTrack(email, trackId) {
  if (typeof supabaseClient === 'undefined') return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  try {
    await supabaseClient.from('tracks').delete().eq('id', String(trackId));
  } catch (e) {
    console.error('[Storage] swDeleteTrack failed:', e);
  }
}
