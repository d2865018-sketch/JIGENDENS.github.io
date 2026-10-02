/* ========================================
   SoundWave — Persistent Storage Module
   IndexedDB для аудіо-файлів
   localStorage для метаданих треків
   ======================================== */

const SW_DB_NAME    = 'soundwave_audio_db';
const SW_DB_VERSION = 1;
const SW_STORE      = 'audio_blobs';

// ===== IndexedDB helpers =====

function swOpenDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SW_DB_NAME, SW_DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(SW_STORE)) {
        db.createObjectStore(SW_STORE, { keyPath: 'trackId' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function swSaveAudio(trackId, blob) {
  try {
    const db = await swOpenDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SW_STORE, 'readwrite');
      tx.objectStore(SW_STORE).put({ trackId, blob });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = e => { db.close(); reject(e.target.error); };
    });
  } catch (e) {
    console.error('[Storage] swSaveAudio failed:', e);
  }
}

async function swGetAudio(trackId) {
  try {
    const db = await swOpenDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(SW_STORE, 'readonly');
      const req = tx.objectStore(SW_STORE).get(trackId);
      req.onsuccess = e => {
        db.close();
        resolve(e.target.result ? e.target.result.blob : null);
      };
      req.onerror = e => { db.close(); reject(e.target.error); };
    });
  } catch (e) {
    console.error('[Storage] swGetAudio failed:', e);
    return null;
  }
}

async function swDeleteAudio(trackId) {
  try {
    const db = await swOpenDB();
    return new Promise((resolve) => {
      const tx = db.transaction(SW_STORE, 'readwrite');
      tx.objectStore(SW_STORE).delete(trackId);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); resolve(); };
    });
  } catch (e) {
    console.error('[Storage] swDeleteAudio failed:', e);
  }
}

// ===== Track metadata in localStorage =====

function swTrackKey(email) {
  return `sw_tracks_${email || 'guest'}`;
}

/**
 * Save userTracks metadata (without src Blob URL) to localStorage.
 * Should be called after every change to userTracks.
 */
function swSaveTracksMeta(email, tracks) {
  const meta = tracks.map(t => ({
    id:       t.id,
    title:    t.title,
    artist:   t.artist,
    genre:    t.genre,
    duration: t.duration,
    cover:    t.cover,
    plays:    t.plays,
  }));
  localStorage.setItem(swTrackKey(email), JSON.stringify(meta));
}

/**
 * Load track metadata from localStorage, restore Blob URLs from IndexedDB.
 * Returns array of fully-formed track objects (with .src set).
 */
async function swLoadTracks(email) {
  try {
    const raw = localStorage.getItem(swTrackKey(email));
    if (!raw) return [];
    const meta = JSON.parse(raw);
    const result = [];
    for (const m of meta) {
      const blob = await swGetAudio(m.id);
      if (!blob) continue; // blob missing — skip
      const src = URL.createObjectURL(blob);
      result.push({ ...m, src, liked: false });
    }
    return result;
  } catch (e) {
    console.error('[Storage] swLoadTracks failed:', e);
    return [];
  }
}

/**
 * Delete a track: removes audio from IndexedDB + removes metadata from localStorage.
 */
async function swDeleteTrack(email, trackId) {
  await swDeleteAudio(trackId);
  try {
    const key  = swTrackKey(email);
    const meta = JSON.parse(localStorage.getItem(key) || '[]');
    const upd  = meta.filter(t => t.id !== trackId);
    localStorage.setItem(key, JSON.stringify(upd));
  } catch {}
}
