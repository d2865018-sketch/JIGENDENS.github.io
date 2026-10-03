/* ========================================
   SoundWave — Application JavaScript
   ======================================== */

// ===== CONFIG =====
// Covers used as fallback for user-uploaded tracks
const COVERS = [
  'C:/Users/user/.gemini/antigravity-ide/brain/e4dae186-20ea-4351-9b96-9d0cb2f2653e/album_cover_1_1790801808009.jpg',
  'C:/Users/user/.gemini/antigravity-ide/brain/e4dae186-20ea-4351-9b96-9d0cb2f2653e/album_cover_2_1790801818107.jpg',
  'C:/Users/user/.gemini/antigravity-ide/brain/e4dae186-20ea-4351-9b96-9d0cb2f2653e/album_cover_3_1790801827240.jpg',
  'C:/Users/user/.gemini/antigravity-ide/brain/e4dae186-20ea-4351-9b96-9d0cb2f2653e/album_cover_4_1790801849446.jpg',
  'C:/Users/user/.gemini/antigravity-ide/brain/e4dae186-20ea-4351-9b96-9d0cb2f2653e/album_cover_5_1790801858353.jpg',
  'C:/Users/user/.gemini/antigravity-ide/brain/e4dae186-20ea-4351-9b96-9d0cb2f2653e/album_cover_6_1790801869435.jpg',
];

// iTunes search terms per genre button
const GENRE_TERMS = {
  all:        'top chart music hits',
  electronic: 'electronic dance music EDM',
  chill:      'chill lofi relax study',
  jazz:       'jazz classic smooth',
  hiphop:     'hip hop rap',
  pop:        'pop chart 2024',
  rock:       'rock classic hits',
  rnb:        'rnb soul R&B',
};

// ===== iTunes API (JSONP — works from file://) =====
function itunesJsonp(term, limit = 25, country = 'US') {
  return new Promise((resolve) => {
    const cbName = 'sw_itunes_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
    const script = document.createElement('script');

    const cleanup = () => {
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    // Timeout fallback
    const timer = setTimeout(() => { cleanup(); resolve([]); }, 9000);

    window[cbName] = (data) => {
      clearTimeout(timer);
      cleanup();
      const results = (data.results || [])
        .filter(r => r.kind === 'song' && r.previewUrl)
        .map(itunesToTrack);
      resolve(results);
    };

    script.onerror = () => { clearTimeout(timer); cleanup(); resolve([]); };
    script.src = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}&country=${country}&callback=${cbName}`;
    document.head.appendChild(script);
  });
}

function itunesToTrack(r) {
  const art = (r.artworkUrl100 || '').replace('100x100bb', '400x400bb').replace('100x100', '400x400');
  return {
    id:       r.trackId,
    title:    r.trackName    || 'Unknown',
    artist:   r.artistName   || 'Unknown',
    album:    r.collectionName || '',
    genre:    (r.primaryGenreName || 'music').toLowerCase().replace(/[^a-z]/g, ''),
    duration: Math.round((r.trackTimeMillis || 30000) / 1000),
    cover:    art || COVERS[0],
    plays:    r.trackViewUrl ? '♫ iTunes' : '—',
    src:      r.previewUrl,   // real 30-sec preview!
    preview:  true,
  };
}

// ===== STATE =====
let tracks = [];   // Populated from iTunes
let userTracks = [];

let currentTrackIndex = -1;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let likedIds = new Set();

// Save liked IDs to localStorage per user account
function saveLiked() {
  // currentUser is defined in auth.js — check if it exists
  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const key = user ? `sw_liked_${user.email}` : 'sw_liked_guest';
  localStorage.setItem(key, JSON.stringify([...likedIds]));
}

// Load liked IDs from localStorage for a specific user email
function loadLiked(email) {
  try {
    const key = email ? `sw_liked_${email}` : 'sw_liked_guest';
    const saved = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(saved)) {
      likedIds = new Set(saved);
    } else {
      likedIds = new Set();
    }
  } catch {
    likedIds = new Set();
  }
  // Re-render everything that depends on likes
  updateLikeBtn();
  renderLikedList();
  updatePlayingHighlights();
}
let currentSection = 'home';
let currentGenreFilter = 'all';
let progressInterval = null;

// ===== WEB AUDIO ENGINE =====
let audioCtx = null;
let masterGain = null;
let activeNodes = [];
let demoStartTimestamp = 0;
let demoDuration = 0;
let demoCurrentTime = 0;
let demoPlaybackTimer = null;
let isDemo = false;

// Genre sound presets: [waveform, base freq, chordIntervals, bpm, hasRhythm]
const GENRE_PRESETS = {
  electronic: { wave:'sawtooth', freq:110,  intervals:[0,7,12,19],  bpm:128, pad:true  },
  chill:      { wave:'sine',     freq:82.4, intervals:[0,4,7,11],   bpm:70,  pad:true  },
  jazz:       { wave:'triangle', freq:98,   intervals:[0,4,7,10,14],bpm:90,  pad:true  },
  techno:     { wave:'sawtooth', freq:55,   intervals:[0,12,19,24], bpm:140, pad:false },
  pop:        { wave:'sine',     freq:130,  intervals:[0,4,7,9],    bpm:100, pad:true  },
  rock:       { wave:'sawtooth', freq:73.4, intervals:[0,7,12],     bpm:120, pad:false },
  custom:     { wave:'sine',     freq:110,  intervals:[0,7,12],     bpm:90,  pad:true  },
};

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.18;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function stopAllDemoNodes() {
  activeNodes.forEach(n => { try { n.stop(); } catch(e){} });
  activeNodes = [];
  clearInterval(demoPlaybackTimer);
}

function startDemoSynth(track) {
  const ctx = getAudioCtx();
  stopAllDemoNodes();

  const preset = GENRE_PRESETS[track.genre] || GENRE_PRESETS.electronic;
  const { wave, freq, intervals, bpm, pad } = preset;
  const beatLen = 60 / bpm; // seconds per beat

  // --- CHORD PAD (continuous ambient) ---
  if (pad) {
    intervals.forEach((semitones, i) => {
      const f = freq * Math.pow(2, semitones / 12);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();

      osc.type = wave;
      osc.frequency.value = f;

      // slight detune for richness
      osc.detune.value = (i % 2 === 0 ? 4 : -4);

      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.22 / intervals.length, ctx.currentTime + 0.8);

      pan.pan.value = (i / intervals.length) * 1.2 - 0.6;

      osc.connect(gain);
      gain.connect(pan);
      pan.connect(masterGain);
      osc.start();
      activeNodes.push(osc);
    });
  }

  // --- BASS LINE (rhythmic) ---
  const bassSeq = [0, 0, 7, 0, 5, 0, 7, 5];
  bassSeq.forEach((semitones, i) => {
    const f = (freq / 2) * Math.pow(2, semitones / 12);
    const t = ctx.currentTime + i * beatLen * 0.5;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + beatLen * 0.45);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + beatLen * 0.5);
    activeNodes.push(osc);
  });

  // --- MELODY (arpeggio) ---
  const arpIntervals = [0, 4, 7, 12, 7, 4, 0, 4];
  arpIntervals.forEach((semitones, i) => {
    const f = freq * 2 * Math.pow(2, semitones / 12);
    const t = ctx.currentTime + 1.2 + i * beatLen * 0.25;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = pad ? 'triangle' : 'square';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + beatLen * 0.22);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + beatLen * 0.25);
    activeNodes.push(osc);
  });

  // --- KICK DRUM (if rhythm genre) ---
  if (!pad || ['techno','electronic','rock'].includes(track.genre)) {
    [0, 2, 4, 6].forEach(beat => {
      const t = ctx.currentTime + beat * beatLen * 0.5;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.15);
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.2);
      activeNodes.push(osc);
    });
    // HI-HAT
    [0.5,1,1.5,2,2.5,3,3.5,4].forEach(beat => {
      const t = ctx.currentTime + beat * beatLen * 0.5;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1);
      const src = ctx.createBufferSource();
      const hiGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 8000;
      src.buffer = buf;
      src.connect(filter);
      filter.connect(hiGain);
      hiGain.gain.setValueAtTime(0.06, t);
      hiGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      hiGain.connect(masterGain);
      src.start(t);
      activeNodes.push(src);
    });
  }

  // Loop synth every 4 beats
  const loopLen = beatLen * 8 * 1000;
  const loopSynth = () => {
    if (!isPlaying || !isDemo) return;
    startDemoSynth(track);
  };
  setTimeout(loopSynth, loopLen);
}

const audio = document.getElementById('audio-element');
audio.crossOrigin = 'anonymous'; // Important for Web Audio API to process iTunes tracks

// ===== EQUALIZER =====
let mediaSource = null;
let eqFilters = [];
let preampGainNode = null;

const EQ_PRESETS = {
  'normal':  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'pop':     [-2, -1, 0, 2, 4, 4, 2, 0, -1, -2],
  'rock':    [4, 3, 2, -1, -2, -1, 1, 3, 4, 4],
  'jazz':    [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  'classic': [0, 0, 0, 0, 0, 0, -1, -2, -3, -4],
  'bass':    [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'treble':  [0, 0, 0, 0, 0, 1, 3, 4, 5, 6]
};

function initEqualizer() {
  if (mediaSource) return;
  const ctx = getAudioCtx();
  
  mediaSource = ctx.createMediaElementSource(audio);
  preampGainNode = ctx.createGain();
  preampGainNode.gain.value = 1;
  
  // 10 bands: 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k
  const freqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  
  freqs.forEach((freq, i) => {
    const filter = ctx.createBiquadFilter();
    filter.type = i === 0 ? 'lowshelf' : (i === freqs.length - 1 ? 'highshelf' : 'peaking');
    if (filter.type === 'peaking') filter.Q.value = 1.41;
    filter.frequency.value = freq;
    filter.gain.value = 0;
    eqFilters.push(filter);
  });
  
  mediaSource.connect(preampGainNode);
  preampGainNode.connect(eqFilters[0]);
  for(let i = 0; i < eqFilters.length - 1; i++) {
    eqFilters[i].connect(eqFilters[i+1]);
  }
  eqFilters[eqFilters.length - 1].connect(ctx.destination);
}

function openEqualizer() {
  initEqualizer();
  document.getElementById('eq-overlay').classList.add('open');
}

function closeEqualizer() {
  document.getElementById('eq-overlay').classList.remove('open');
}

function updateEq(index, val) {
  if (index === 'preamp') {
    if (preampGainNode) {
      // mapping -12..12 dB to linear gain (10^(dB/20))
      preampGainNode.gain.value = Math.pow(10, parseFloat(val) / 20);
    }
    const displayVal = val > 0 ? '+' + val : val;
    const el = document.getElementById('eq-val-preamp');
    if(el) el.textContent = `${displayVal}dB`;
    document.getElementById('eq-preset-select').value = 'custom';
    return;
  }
  
  if (eqFilters[index]) {
    eqFilters[index].gain.value = parseFloat(val);
  }
  const displayVal = val > 0 ? '+' + val : val;
  const el = document.getElementById(`eq-val-${index}`);
  if(el) el.textContent = `${displayVal}dB`;
  document.getElementById('eq-preset-select').value = 'custom';
}

function applyEqPreset(presetName) {
  if (presetName === 'custom') return;
  const values = EQ_PRESETS[presetName] || EQ_PRESETS['normal'];
  
  // Update preamp to 0dB for presets
  if (preampGainNode) preampGainNode.gain.value = 1;
  const preampSlider = document.getElementById('eq-slider-preamp');
  if (preampSlider) preampSlider.value = 0;
  const preampValEl = document.getElementById('eq-val-preamp');
  if (preampValEl) preampValEl.textContent = '0dB';

  // Update bands
  const sliders = document.querySelectorAll('.eq-slider-band');
  for(let i = 0; i < 10; i++) {
    if (eqFilters[i]) eqFilters[i].gain.value = values[i];
    if (sliders[i]) sliders[i].value = values[i];
    const valEl = document.getElementById(`eq-val-${i}`);
    if (valEl) {
      const displayVal = values[i] > 0 ? '+' + values[i] : values[i];
      valEl.textContent = `${displayVal}dB`;
    }
  }
}

function resetEq() {
  applyEqPreset('normal');
  document.getElementById('eq-preset-select').value = 'normal';
}

// ===== MP3TAG EDITOR =====
let mp3tagSelectedTrackId = null;
let tempMp3TagCover = null;

function renderMp3TagList() {
  const container = document.getElementById('mp3tag-tracks-list');
  const empty = document.getElementById('mp3tag-empty');
  
  if (!userTracks || userTracks.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    resetMp3TagEditor();
    return;
  }
  
  empty.style.display = 'none';
  container.innerHTML = userTracks.map(t => `
    <div class="mp3tag-track-item ${String(t.id) === String(mp3tagSelectedTrackId) ? 'selected' : ''}" onclick="selectMp3TagTrack('${t.id}')">
      <img src="${t.cover}" alt="cover" style="width:40px; height:40px; border-radius:4px; object-fit:cover;" />
      <div style="flex:1; min-width:0;">
        <div class="track-title" style="font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color: ${String(t.id) === String(mp3tagSelectedTrackId) ? '#fff' : 'var(--text-primary)'}">${t.title}</div>
        <div class="track-artist" style="font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color: ${String(t.id) === String(mp3tagSelectedTrackId) ? '#fff' : 'var(--text-muted)'}">${t.artist}</div>
      </div>
    </div>
  `).join('');
}

function resetMp3TagEditor() {
  mp3tagSelectedTrackId = null;
  tempMp3TagCover = null;
  document.getElementById('mp3tag-editor-col').style.opacity = '0.5';
  document.getElementById('mp3tag-editor-col').style.pointerEvents = 'none';
  document.getElementById('mp3tag-title').value = '';
  document.getElementById('mp3tag-artist').value = '';
  document.getElementById('mp3tag-genre').value = '';
  document.getElementById('mp3tag-cover-preview').innerHTML = `
    <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.5); opacity:0; transition:0.2s;" class="hover-overlay">
       <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="30" height="30"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    </div>
  `;
}

function selectMp3TagTrack(id) {
  const track = userTracks.find(t => String(t.id) === String(id));
  if (!track) return;
  
  mp3tagSelectedTrackId = String(id);
  tempMp3TagCover = track.cover; // keep original by default
  
  // enable editor
  document.getElementById('mp3tag-editor-col').style.opacity = '1';
  document.getElementById('mp3tag-editor-col').style.pointerEvents = 'auto';
  
  document.getElementById('mp3tag-title').value = track.title || '';
  document.getElementById('mp3tag-artist').value = track.artist || '';
  document.getElementById('mp3tag-genre').value = track.genre || '';
  
  const publicToggle = document.getElementById('mp3tag-public');
  if (publicToggle) publicToggle.checked = track.is_public || false;
  
  renderMp3TagCoverPreview();
  renderMp3TagList(); // refresh active state
}

function handleMp3TagCoverUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    tempMp3TagCover = e.target.result;
    renderMp3TagCoverPreview();
  };
  reader.readAsDataURL(file);
}

function renderMp3TagCoverPreview() {
  document.getElementById('mp3tag-cover-preview').innerHTML = `
    <img src="${tempMp3TagCover}" style="width:100%; height:100%; object-fit:cover;" />
    <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.5); opacity:0; transition:0.2s;" class="hover-overlay">
       <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="30" height="30"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    </div>
  `;
}

async function saveMp3Tag() {
  if (!mp3tagSelectedTrackId) return;
  
  const track = userTracks.find(t => String(t.id) === String(mp3tagSelectedTrackId));
  if (!track) return;
  
  track.title = document.getElementById('mp3tag-title').value || 'Невідомий трек';
  track.artist = document.getElementById('mp3tag-artist').value || 'Невідомий виконавець';
  track.genre = document.getElementById('mp3tag-genre').value || track.genre;
  if (tempMp3TagCover) track.cover = tempMp3TagCover;
  
  const publicToggle = document.getElementById('mp3tag-public');
  if (publicToggle) track.is_public = publicToggle.checked;
  
  const saved = await swSaveTracksMeta(currentUser.email, userTracks);
  if (saved) showNotification(track.is_public ? '🌍 Збережено — трек публічний' : '💾 Теги успішно збережено');
  renderMp3TagList();
  renderLibraryList();
  renderExtSavedList();
    
    // Update player if this track is currently playing
    if (tracks[currentTrackIndex] && tracks[currentTrackIndex].id === track.id) {
      document.getElementById('player-title').textContent = track.title;
      document.getElementById('player-artist').textContent = track.artist;
      document.getElementById('player-cover').style.backgroundImage = `url('${track.cover}')`;
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata.title = track.title;
        navigator.mediaSession.metadata.artist = track.artist;
        navigator.mediaSession.metadata.artwork = [{ src: track.cover, sizes: '512x512', type: 'image/png' }];
      }
    }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  setupDragDrop();
  setupExtractorDragDrop();
  setupMediaSession();
  updateVolumeSlider();
  audio.volume = 0.8;
  audio.addEventListener('ended', onTrackEnded);
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', updateTotalTime);
  audio.addEventListener('play', onPlay);
  audio.addEventListener('pause', onPause);
  setupKeyboard();
  // Load playlists for guest (will be reloaded after login)
  loadPlaylists(null);
  // Load real music from iTunes on startup
  loadTracksByTerm('top chart music hits', true);
});



// ===== Loading skeleton =====
function setLoadingCards(containerId, count = 6, type = 'card') {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (type === 'card') {
    el.innerHTML = Array(count).fill(`
      <div class="track-card skeleton-card">
        <div class="track-card-cover skeleton-box"></div>
        <div class="track-card-info">
          <div class="skeleton-line" style="width:70%"></div>
          <div class="skeleton-line" style="width:50%;margin-top:6px"></div>
        </div>
      </div>`).join('');
  } else {
    el.innerHTML = Array(count).fill(`
      <div class="track-row skeleton-row">
        <div class="skeleton-box" style="width:40px;height:40px;border-radius:8px"></div>
        <div class="skeleton-box" style="width:48px;height:48px;border-radius:8px"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px">
          <div class="skeleton-line" style="width:55%"></div>
          <div class="skeleton-line" style="width:35%"></div>
        </div>
      </div>`).join('');
  }
}

/**
 * Fetch tracks from iTunes by search term and populate the tracks array.
 * @param {string} term - search term
 * @param {boolean} isFeatured - if true, also update featured banner
 */
async function loadTracksByTerm(term, isFeatured = false) {
  // Show skeletons
  setLoadingCards('trending-grid', 6, 'card');
  setLoadingCards('recommended-list', 5, 'row');

  const results = await itunesJsonp(term, 25);

  if (results.length > 0) {
    tracks = results;
  } else {
    // Fallback message if API is unavailable
    document.getElementById('trending-grid').innerHTML =
      '<div class="empty-state" style="grid-column:1/-1"><span>🌐</span><p>Не вдалося завантажити треки. Перевір інтернет-з\'єднання.</p></div>';
    document.getElementById('recommended-list').innerHTML = '';
    return;
  }

  renderAll(isFeatured);
}

function renderAll(updateFeatured = true) {
  renderTrendingGrid();
  renderRecommendedList();
  if (updateFeatured && tracks.length > 0) {
    updateFeaturedBanner(0);
  }
}

// ===== RENDER =====
function renderTrendingGrid() {
  const grid = document.getElementById('trending-grid');
  const list = getAllTracks().slice(0, 6);
  grid.innerHTML = list.map((t, i) => trackCardHTML(t, i)).join('');
}

function renderRecommendedList() {
  const el = document.getElementById('recommended-list');
  const list = getAllTracks().slice(0, 5);
  el.innerHTML = list.map((t, i) => trackRowHTML(t, i + 6, 'rec')).join('');
}

function renderExploreList(filter = 'all') {
  const el = document.getElementById('explore-list');
  const term = GENRE_TERMS[filter] || GENRE_TERMS.all;
  setLoadingCards('explore-list', 10, 'row');
  itunesJsonp(term, 30).then(results => {
    if (results.length === 0) {
      el.innerHTML = '<div class="empty-state"><span>\uD83D\uDD0D</span><p>\u041D\u0456\u0447\u043E\u0433\u043E \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E</p></div>';
      return;
    }
    // Store in global tracks so clicks work
    tracks = results;
    el.innerHTML = results.map((t, i) => trackRowHTML(t, i, 'explore')).join('');
  });
}

function renderLibraryList() {
  const el = document.getElementById('library-list');
  const empty = document.getElementById('library-empty');
  if (userTracks.length === 0) {
    el.innerHTML = '';
    el.appendChild(empty);
    return;
  }
  el.innerHTML = userTracks.map((t, i) => trackRowHTML(t, i, 'library')).join('');
}

function renderLikedList() {
  const el = document.getElementById('liked-list');
  const empty = document.getElementById('liked-empty');
  const liked = getAllTracks().filter(t => likedIds.has(t.id));
  if (liked.length === 0) {
    el.innerHTML = '';
    el.appendChild(empty);
    return;
  }
  el.innerHTML = liked.map((t, i) => trackRowHTML(t, i, 'liked')).join('');
}

function renderFeatured() {
  updateFeaturedBanner(0);
}

function updateFeaturedBanner(idx) {
  const all = getAllTracks();
  if (all.length === 0) return;
  const t = all[idx] || all[0];
  document.getElementById('featured-title').textContent = t.title;
  document.getElementById('featured-artist').textContent = t.artist;
  document.getElementById('featured-bg').style.backgroundImage = `url('${t.cover}')`;
  document.getElementById('featured-banner').onclick = (e) => {
    if (!e.target.closest('.featured-play-btn')) playTrackById(idx);
  };
  document.querySelector('.featured-play-btn').onclick = (e) => {
    e.stopPropagation();
    playTrackById(idx);
  };
}

// ===== TRACK HTML =====
function trackCardHTML(track, idx) {
  const playing = currentTrackIndex === getTrackGlobalIndex(track);
  return `
    <div class="track-card ${playing ? 'now-playing' : ''}" onclick="playTrackById(${idx})" id="card-${track.id}">
      <div class="track-card-cover">
        <img src="${track.cover}" alt="${track.title}" loading="lazy" />
        <div class="track-card-play-overlay">
          <button class="track-card-play-btn">
            ${playing && isPlaying
              ? `<svg viewBox="0 0 24 24" fill="white" width="20" height="20"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
              : `<svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M5 3l14 9-14 9V3z"/></svg>`
            }
          </button>
        </div>
      </div>
      <div class="track-card-info">
        <div class="track-card-title">${track.title}</div>
        <div class="track-card-artist">${track.artist}</div>
        <span class="track-card-genre">${track.genre}</span>
      </div>
    </div>
  `;
}

function trackRowHTML(track, displayNum, ctx) {
  const globalIdx = getTrackGlobalIndex(track);
  const playing = currentTrackIndex === globalIdx && isPlaying;
  const liked = likedIds.has(track.id);
  const isUserTrack = userTracks.some(t => String(t.id) === String(track.id));
  return `
    <div class="track-row ${currentTrackIndex === globalIdx ? 'playing' : ''}" 
         onclick="playTrackByGlobalIndex(${globalIdx})" 
         id="row-${track.id}">
      <div style="position:relative; width:40px; display:flex; align-items:center; justify-content:center;">
        <span class="track-row-num">${displayNum + 1}</span>
        <div class="track-row-num-icon">
          ${playing
            ? `<div class="playing-bars"><span></span><span></span><span></span></div>`
            : `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="color:var(--text-secondary)"><path d="M5 3l14 9-14 9V3z"/></svg>`
          }
        </div>
      </div>
      <div class="track-row-cover">
        <img src="${track.cover}" alt="${track.title}" loading="lazy" />
      </div>
      <div class="track-row-info">
        <div class="track-row-title">${track.title}</div>
        <div class="track-row-artist">${track.artist} · ${track.plays || '—'} прослуховувань</div>
      </div>
      <button class="track-row-like ${liked ? 'liked' : ''}" 
              onclick="event.stopPropagation(); toggleLikeById(${track.id})"
              title="${liked ? 'Прибрати' : 'Вподобати'}">
        <svg viewBox="0 0 24 24" fill="${liked ? '#e05574' : 'none'}" stroke="${liked ? '#e05574' : 'currentColor'}" stroke-width="2" width="16" height="16">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </button>
      <button class="track-row-add-pl"
              onclick="event.stopPropagation(); openAddToPlaylist(${track.id})"
              title="Додати до плейлиста">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
      ${isUserTrack && (ctx === 'library' || ctx === 'extractor') ? `
        <button class="track-row-delete" 
                onclick="event.stopPropagation(); deleteUserTrack(${track.id})"
                title="Видалити трек">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      ` : ''}
      <span class="track-row-duration">${formatTime(track.duration)}</span>
    </div>
  `;
}


// ===== TRACK UTILITIES =====
function getAllTracks() {
  return [...tracks, ...userTracks];
}

function getTrackGlobalIndex(track) {
  return getAllTracks().findIndex(t => String(t.id) === String(track.id));
}

function getTrackAtIndex(idx) {
  return getAllTracks()[idx];
}

// ===== PLAYBACK =====
function playTrackById(idx) {
  playTrackByGlobalIndex(idx);
}

function playTrackByGlobalIndex(globalIdx) {
  const all = getAllTracks();
  if (globalIdx < 0 || globalIdx >= all.length) return;
  const track = all[globalIdx];
  currentTrackIndex = globalIdx;

  // Update player UI
  document.getElementById('player-title').textContent = track.title;
  document.getElementById('player-artist').textContent = track.artist;

  const coverEl = document.getElementById('player-cover');
  coverEl.innerHTML = `<img src="${track.cover}" alt="${track.title}" style="width:100%;height:100%;object-fit:cover;" />`;

  // Update like button
  updateLikeBtn();

  // Load audio
  if (track.src) {
    // Real audio file
    isDemo = false;
    stopAllDemoNodes();
    audio.src = track.src;
    audio.play().catch(e => console.warn('Audio play failed:', e));
  } else {
    // Demo track — synthesize real sound + track progress
    isDemo = true;
    audio.src = '';
    startDemoSynth(track);
    startDemoProgress(track);
  }

  isPlaying = true;
  document.getElementById('play-icon').style.display = 'none';
  document.getElementById('pause-icon').style.display = 'block';
  document.getElementById('visualizer').classList.remove('paused');

  // Update all lists
  updatePlayingHighlights();
  updateQueueList();

  // Update featured banner with current track
  updateFeaturedBanner(globalIdx < tracks.length ? globalIdx : 0);
}

function startDemoProgress(track) {
  clearInterval(demoPlaybackTimer);
  demoCurrentTime = 0;
  demoDuration = track.duration;
  document.getElementById('total-time').textContent = formatTime(demoDuration);
  document.getElementById('current-time').textContent = '0:00';
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-thumb').style.left = '0%';
  demoStartTimestamp = Date.now();

  demoPlaybackTimer = setInterval(() => {
    if (!isPlaying) return;
    demoCurrentTime = Math.min(demoDuration, (Date.now() - demoStartTimestamp) / 1000);
    const pct = (demoCurrentTime / demoDuration) * 100;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-thumb').style.left = pct + '%';
    document.getElementById('current-time').textContent = formatTime(demoCurrentTime);
    if (demoCurrentTime >= demoDuration) {
      clearInterval(demoPlaybackTimer);
      onTrackEnded();
    }
  }, 300);
}

function resumeDemoProgress() {
  if (currentTrackIndex < 0) return;
  const track = getTrackAtIndex(currentTrackIndex);
  if (!track || track.src) return;
  // Resume Web Audio context
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  // Re-trigger synth
  startDemoSynth(track);
  // Resume progress timer
  demoStartTimestamp = Date.now() - demoCurrentTime * 1000;
  demoPlaybackTimer = setInterval(() => {
    if (!isPlaying) return;
    demoCurrentTime = Math.min(demoDuration, (Date.now() - demoStartTimestamp) / 1000);
    const pct = (demoCurrentTime / demoDuration) * 100;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-thumb').style.left = pct + '%';
    document.getElementById('current-time').textContent = formatTime(demoCurrentTime);
    if (demoCurrentTime >= demoDuration) {
      clearInterval(demoPlaybackTimer);
      onTrackEnded();
    }
  }, 300);
}

function togglePlay() {
  if (currentTrackIndex < 0) {
    playTrackByGlobalIndex(0);
    return;
  }
  const track = getTrackAtIndex(currentTrackIndex);
  if (isPlaying) {
    isPlaying = false;
    if (track.src) {
      audio.pause();
    } else {
      // Pause demo: stop synth nodes and timer
      stopAllDemoNodes();
      // suspend AudioContext to silence immediately
      if (audioCtx) audioCtx.suspend();
    }
    document.getElementById('play-icon').style.display = 'block';
    document.getElementById('pause-icon').style.display = 'none';
    document.getElementById('visualizer').classList.add('paused');
  } else {
    isPlaying = true;
    if (track.src) {
      audio.play().catch(() => {});
    } else {
      resumeDemoProgress();
    }
    document.getElementById('play-icon').style.display = 'none';
    document.getElementById('pause-icon').style.display = 'block';
    document.getElementById('visualizer').classList.remove('paused');
  }
}

function onPlay() {
  isPlaying = true;
  document.getElementById('play-icon').style.display = 'none';
  document.getElementById('pause-icon').style.display = 'block';
  document.getElementById('visualizer').classList.remove('paused');
}

function onPause() {
  if (currentTrackIndex >= 0) {
    const track = getTrackAtIndex(currentTrackIndex);
    if (track && track.src) {
      isPlaying = false;
      document.getElementById('play-icon').style.display = 'block';
      document.getElementById('pause-icon').style.display = 'none';
      document.getElementById('visualizer').classList.add('paused');
    }
  }
}

function onTrackEnded() {
  if (isRepeat) {
    playTrackByGlobalIndex(currentTrackIndex);
  } else {
    nextTrack();
  }
}

function nextTrack() {
  const all = getAllTracks();
  if (all.length === 0) return;
  let nextIdx;
  if (isShuffle) {
    nextIdx = Math.floor(Math.random() * all.length);
  } else {
    nextIdx = (currentTrackIndex + 1) % all.length;
  }
  playTrackByGlobalIndex(nextIdx);
}

function prevTrack() {
  const all = getAllTracks();
  if (all.length === 0) return;
  const track = getTrackAtIndex(currentTrackIndex);
  const elapsed = track && track.src ? audio.currentTime : demoCurrentTime;
  if (elapsed > 3) {
    // Restart current
    if (track && track.src) { audio.currentTime = 0; }
    else { demoCurrentTime = 0; demoStartTimestamp = Date.now(); }
    return;
  }
  let prevIdx = currentTrackIndex - 1;
  if (prevIdx < 0) prevIdx = all.length - 1;
  playTrackByGlobalIndex(prevIdx);
}

function toggleShuffle() {
  isShuffle = !isShuffle;
  document.getElementById('shuffle-btn').classList.toggle('active', isShuffle);
  showNotification(isShuffle ? '🔀 Перемішування увімкнено' : '🔀 Перемішування вимкнено');
}

function toggleRepeat() {
  isRepeat = !isRepeat;
  document.getElementById('repeat-btn').classList.toggle('active', isRepeat);
  showNotification(isRepeat ? '🔁 Повтор увімкнено' : '🔁 Повтор вимкнено');
}

// ===== PROGRESS =====
function updateProgress() {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-thumb').style.left = pct + '%';
  document.getElementById('current-time').textContent = formatTime(audio.currentTime);
}

function updateTotalTime() {
  document.getElementById('total-time').textContent = formatTime(audio.duration);
}

function seekTo(event) {
  const bar = document.getElementById('progress-bar');
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const track = getTrackAtIndex(currentTrackIndex);
  if (!track) return;
  if (track.src && audio.duration) {
    audio.currentTime = pct * audio.duration;
  } else {
    demoCurrentTime = pct * demoDuration;
    demoStartTimestamp = Date.now() - demoCurrentTime * 1000;
    document.getElementById('progress-fill').style.width = (pct * 100) + '%';
    document.getElementById('progress-thumb').style.left = (pct * 100) + '%';
    document.getElementById('current-time').textContent = formatTime(demoCurrentTime);
  }
}

// ===== VOLUME =====
function setVolume(val) {
  audio.volume = val / 100;
  // Also control synth volume for demo tracks
  if (masterGain) masterGain.gain.value = (val / 100) * 0.18;
  updateVolumeSlider();
  const icon = document.getElementById('vol-icon');
  if (val == 0) {
    icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;
  } else if (val < 50) {
    icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
  } else {
    icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
  }
}

function toggleMute() {
  const slider = document.getElementById('volume-slider');
  if (audio.volume > 0) {
    audio._prevVol = audio.volume;
    audio.volume = 0;
    slider.value = 0;
  } else {
    audio.volume = audio._prevVol || 0.8;
    slider.value = audio.volume * 100;
  }
  setVolume(slider.value);
}

function updateVolumeSlider() {
  const slider = document.getElementById('volume-slider');
  if (slider) slider.value = audio.volume * 100;
}

// ===== LIKE =====
function toggleLike() {
  if (currentTrackIndex < 0) return;
  const track = getTrackAtIndex(currentTrackIndex);
  toggleLikeById(track.id);
}

function toggleLikeById(id) {
  const allTracks = getAllTracks();
  const track = allTracks.find(t => String(t.id) === String(id));
  if (!track) return;
  if (likedIds.has(id)) {
    likedIds.delete(id);
    showNotification(`💔 ${track.title} видалено з вподобаних`);
  } else {
    likedIds.add(id);
    showNotification(`❤️ ${track.title} додано до вподобаних`);
  }
  saveLiked();          // ← persist per account
  updateLikeBtn();
  renderLikedList();
  updatePlayingHighlights();
}

function updateLikeBtn() {
  const btn = document.getElementById('like-btn-player');
  if (currentTrackIndex < 0) return;
  const track = getTrackAtIndex(currentTrackIndex);
  if (!track) return;
  const liked = likedIds.has(track.id);
  btn.classList.toggle('liked', liked);
}

// ===== QUEUE =====
function toggleQueue() {
  const panel = document.getElementById('queue-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) updateQueueList();
}

function updateQueueList() {
  const el = document.getElementById('queue-list');
  const all = getAllTracks();
  if (all.length === 0) {
    el.innerHTML = '<div style="padding:20px; color:var(--text-muted); font-size:13px; text-align:center;">Черга порожня</div>';
    return;
  }
  el.innerHTML = all.map((t, i) => `
    <div class="queue-item ${i === currentTrackIndex ? 'active' : ''}" onclick="playTrackByGlobalIndex(${i})">
      <div class="queue-item-cover">
        <img src="${t.cover}" alt="${t.title}" />
      </div>
      <div class="queue-item-info">
        <div class="queue-item-title">${t.title}</div>
        <div class="queue-item-artist">${t.artist}</div>
      </div>
      <span style="font-size:11px;color:var(--text-muted)">${formatTime(t.duration)}</span>
    </div>
  `).join('');
}

// ===== NAVIGATION =====
function showSection(name, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');
  if (el) el.classList.add('active');
  currentSection = name;

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');

  if (name === 'library') renderLibraryList();
  if (name === 'liked') renderLikedList();
  if (name === 'home') renderTrendingGrid();
  if (name === 'explore') renderExploreList(currentGenreFilter);
  if (name === 'extractor') renderExtSavedList();
  if (name === 'mp3tag') renderMp3TagList();
  if (name === 'community') renderCommunityList();
}

async function renderCommunityList() {
  const container = document.getElementById('community-list');
  if (!container) return;
  container.innerHTML = '<div class="empty-state" style="text-align:center; padding:40px; color:var(--text-muted);"><div class="spinner"></div> Завантаження...</div>';

  let publicTracks = [];
  if (typeof swLoadPublicTracks === 'function') {
    publicTracks = await swLoadPublicTracks();
  }

  if (publicTracks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span>🌍</span>
        <p>Поки що немає публічних треків. Будь першим!</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  publicTracks.forEach((track) => {
    // We add them to our global tracks array if they are not there, so we can play them
    const existingIdx = tracks.findIndex(t => String(t.id) === String(track.id));
    let finalIdx = existingIdx;
    if (existingIdx === -1) {
      tracks.push(track);
      finalIdx = tracks.length - 1;
    }
    
    container.appendChild(createTrackItem(tracks[finalIdx], finalIdx, 'community-list'));
  });
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ===== SEARCH =====
let searchDebounceTimer = null;

function handleSearch(query) {
  const q = query.trim();

  if (q.length === 0) {
    showSection('home', document.getElementById('nav-home'));
    return;
  }

  // Switch to search section immediately
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('section-search').classList.add('active');
  document.getElementById('search-results-count').textContent = '🔍 Пошук...';
  setLoadingCards('search-list', 8, 'row');

  // Debounce: wait 500ms after typing stops
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    const results = await itunesJsonp(q, 30);
    const el = document.getElementById('search-list');

    if (results.length === 0) {
      document.getElementById('search-results-count').textContent = '\u041d\u0456\u0447\u043e\u0433\u043e \u043d\u0435 \u0437\u043d\u0430\u0439\u0434\u0435\u043d\u043e';
      el.innerHTML = `<div class="empty-state"><span>\uD83D\uDD0D</span><p>\u041d\u0456\u0447\u043e\u0433\u043e \u043d\u0435 \u0437\u043d\u0430\u0439\u0434\u0435\u043d\u043e \u0437\u0430 \u0437\u0430\u043f\u0438\u0442\u043e\u043c \u00ab${escapeHtml(q)}\u00bb</p></div>`;
      return;
    }

    // Store in global tracks so clicks work!
    tracks = results;
    document.getElementById('search-results-count').textContent = `\u0417\u043d\u0430\u0439\u0434\u0435\u043d\u043e ${results.length} \u0442\u0440\u0435\u043a\u0456\u0432 \uD83C\uDFB5`;
    el.innerHTML = results.map((t, i) => trackRowHTML(t, i, 'search')).join('');
  }, 500);
}

// ===== GENRE FILTER =====
function filterByGenre(genre, el) {
  currentGenreFilter = genre;
  document.querySelectorAll('.genre-tag').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderExploreList(genre); // will query iTunes by genre term
}

// ===== FILE UPLOAD =====
/**
 * Persist current userTracks metadata to localStorage (no blob URLs).
 * Call this whenever userTracks changes.
 */
function persistUserTracks() {
  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  if (typeof swSaveTracksMeta === 'function') {
    swSaveTracksMeta(user ? user.email : null, userTracks);
  }
}

/**
 * Handle file upload: saves blob to IndexedDB + metadata to localStorage.
 */
async function handleFileUpload(input) {
  const files = Array.from(input.files).filter(f => f.type.startsWith('audio/'));
  if (files.length === 0) {
    showNotification('⚠️ Вибери аудіофайли (mp3, wav, ogg, flac)');
    return;
  }

  showNotification(`⏳ Завантажується ${files.length} файл ${files.length > 1 ? 'aв' : ''}...`);

  for (const file of files) {
    const url  = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^/.]+$/, '');
    const cover = COVERS[Math.floor(Math.random() * COVERS.length)];
    const trackId = Date.now() + Math.floor(Math.random() * 10000);

    const track = {
      id:       trackId,
      title:    name,
      artist:   'Невідомий артист',
      genre:    'custom',
      duration: 0,
      cover,
      plays:    '0',
      src:      url,
    };

    // Get duration asynchronously
    await new Promise(resolve => {
      const tmp = new Audio(url);
      tmp.onloadedmetadata = () => { track.duration = tmp.duration; resolve(); };
      tmp.onerror = resolve; // fallback
      setTimeout(resolve, 3000); // timeout safety
    });

    // Save audio blob to IndexedDB for persistence
    let uploadOk = true;
    if (typeof swSaveAudio === 'function') {
      const uploadedUrl = await swSaveAudio(trackId, file);
      uploadOk = !!uploadedUrl;
      if (uploadedUrl) { URL.revokeObjectURL(track.src); track.src = uploadedUrl; }
    }

    userTracks.push(track);
    if (uploadOk) showNotification(`🎵 "​${name}​" збережено!`);
  }

  // Persist all metadata after all files are processed
  persistUserTracks();

  renderLibraryList();
  updateQueueList();
  renderTrendingGrid();
  input.value = '';
}

/**
 * Delete a user-uploaded track from UI, IndexedDB, and localStorage.
 */
async function deleteUserTrack(trackId) {
  // Stop if currently playing
  if (currentTrackIndex >= 0) {
    const playing = getTrackAtIndex(currentTrackIndex);
    if (playing && playing.id === trackId) {
      if (isPlaying) togglePlay();
      currentTrackIndex = -1;
      document.getElementById('player-title').textContent = 'Нічого не грає';
      document.getElementById('player-artist').textContent = '—';
      document.getElementById('player-cover').innerHTML = '';
    }
  }

  const track = userTracks.find(t => String(t.id) === String(trackId));
  const name  = track ? track.title : 'Трек';

  // Revoke blob URL
  if (track && track.src) URL.revokeObjectURL(track.src);

  // Remove from array
  userTracks = userTracks.filter(t => String(t.id) !== String(trackId));

  // Remove from likes
  likedIds.delete(trackId);
  saveLiked();

  // Remove from IndexedDB + localStorage
  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  if (typeof swDeleteTrack === 'function') {
    await swDeleteTrack(user ? user.email : null, trackId);
  }

  showNotification(`🗑️ "​${name}​" видалено`);
  renderLibraryList();
  renderLikedList();
  updateQueueList();
  updatePlayingHighlights();
}

function setupDragDrop() {
  const dropZone = document.getElementById('upload-drop-zone');
  if (!dropZone) return;

  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, () => dropZone.classList.remove('drag-over'));
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
    if (files.length === 0) {
      showNotification('⚠️ Перетягни аудіофайли (mp3, wav, ogg)');
      return;
    }
    const fakeInput = { files };
    handleFileUpload(fakeInput);
  });

  // Also handle body-level drag
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
    if (files.length > 0) {
      const fakeInput = { files };
      handleFileUpload(fakeInput);
      showSection('library', document.getElementById('nav-library'));
    }
  });
}


// =============================================
//  PLAYLIST SYSTEM
// =============================================

const PLAYLIST_GRADIENTS = [
  'linear-gradient(135deg, #667eea, #764ba2)',
  'linear-gradient(135deg, #f093fb, #f5576c)',
  'linear-gradient(135deg, #4facfe, #00f2fe)',
  'linear-gradient(135deg, #43e97b, #38f9d7)',
  'linear-gradient(135deg, #fa709a, #fee140)',
  'linear-gradient(135deg, #a18cd1, #fbc2eb)',
  'linear-gradient(135deg, #ff9a9e, #fecfef)',
  'linear-gradient(135deg, #ffecd2, #fcb69f)',
  'linear-gradient(135deg, #30cfd0, #330867)',
  'linear-gradient(135deg, #ff6b35, #f7931e)',
];

let playlists = [];         // [{id, name, desc, gradient, trackIds:[]}]
let currentPlaylistId = null; // ID currently open in playlist view
let editingPlaylistId = null; // ID being edited (null = create new)
let addToPlaylistTrackId = null; // track being added
let selectedGradient = PLAYLIST_GRADIENTS[0];

// --- Persistence ---
function savePlaylists() {
  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const key = user ? `sw_playlists_${user.email}` : 'sw_playlists_guest';
  localStorage.setItem(key, JSON.stringify(playlists));
}
function loadPlaylists(email) {
  try {
    const key = email ? `sw_playlists_${email}` : 'sw_playlists_guest';
    const saved = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(saved)) playlists = saved;
    else playlists = [];
  } catch { playlists = []; }
  renderSidebarPlaylists();
}

// --- Sidebar render ---
function renderSidebarPlaylists() {
  const list = document.getElementById('playlists-list');
  const hint = document.getElementById('playlist-empty-hint');
  if (!list) return;
  if (playlists.length === 0) {
    list.innerHTML = '<div class="playlist-empty-hint">Натисни + щоб створити плейлист</div>';
    return;
  }
  list.innerHTML = playlists.map(pl => {
    const covers = getPlaylistCovers(pl, 4);
    const thumbHTML = buildThumbHTML(covers, pl.gradient, 'playlist-thumb', pl.customCover);
    const isActive = currentPlaylistId === pl.id ? 'active' : '';
    return `
      <div class="playlist-item ${isActive}" onclick="openPlaylistView('${pl.id}')">
        ${thumbHTML}
        <div class="playlist-item-info">
          <div class="playlist-item-name">${escapeHtml(pl.name)}</div>
          <div class="playlist-item-count">${pl.trackIds.length} ${trackWord(pl.trackIds.length)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function trackWord(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'трек';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'треки';
  return 'треків';
}

// --- Cover helpers ---
function getPlaylistCovers(pl, max = 4) {
  const all = getAllTracks();
  return pl.trackIds
    .map(id => all.find(t => String(t.id) === String(id)))
    .filter(Boolean)
    .slice(0, max)
    .map(t => t.cover);
}

function buildThumbHTML(covers, gradient, cls, customCover) {
  if (customCover) {
    return `<div class="${cls} single"><img src="${customCover}" /></div>`;
  }
  if (covers.length === 0) {
    return `<div class="${cls} single" style="background:${gradient}"></div>`;
  }
  if (covers.length === 1) {
    return `<div class="${cls} single"><img src="${covers[0]}" /></div>`;
  }
  const imgs = covers.slice(0, 4).map(c => `<img src="${c}" />`).join('');
  return `<div class="${cls}">${imgs}</div>`;
}

function buildViewCoverHTML(covers, gradient) {
  if (covers.length === 0) {
    return `<div class="playlist-view-cover gradient-cover" style="background:${gradient}">
      <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5" width="60" height="60">
        <path d="M9 19V6l12-3v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/>
      </svg>
    </div>`;
  }
  if (covers.length === 1) {
    return `<div class="playlist-view-cover single"><img src="${covers[0]}" /></div>`;
  }
  const imgs = covers.slice(0, 4).map(c => `<img src="${c}" />`).join('');
  return `<div class="playlist-view-cover">${imgs}</div>`;
}

// --- Open playlist view ---
function openPlaylistView(id) {
  const pl = playlists.find(p => p.id === id);
  if (!pl) return;
  currentPlaylistId = id;

  // Update cover
  const covers = getPlaylistCovers(pl, 4);
  const pvCover = document.getElementById('pv-cover');
  if (pvCover) {
    if (pl.customCover) {
      pvCover.className = 'playlist-view-cover single';
      pvCover.style.background = '';
      pvCover.innerHTML = `<img src="${pl.customCover}" />`;
    } else if (covers.length === 0) {
      pvCover.className = 'playlist-view-cover gradient-cover';
      pvCover.style.background = pl.gradient;
      pvCover.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5" width="60" height="60">
        <path d="M9 19V6l12-3v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/>
      </svg>`;
    } else if (covers.length === 1) {
      pvCover.className = 'playlist-view-cover single';
      pvCover.style.background = '';
      pvCover.innerHTML = `<img src="${covers[0]}" />`;
    } else {
      pvCover.className = 'playlist-view-cover';
      pvCover.style.background = '';
      pvCover.innerHTML = covers.slice(0, 4).map(c => `<img src="${c}" />`).join('');
    }
  }

  document.getElementById('pv-name').textContent = pl.name;
  document.getElementById('pv-desc').textContent = pl.desc || '';
  document.getElementById('pv-stats').textContent =
    `${pl.trackIds.length} ${trackWord(pl.trackIds.length)}`;

  // Render tracks
  renderPlaylistTracks(pl);

  // Switch section
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('section-playlist').classList.add('active');
  document.getElementById('sidebar').classList.remove('open');

  renderSidebarPlaylists();
}


function renderPlaylistTracks(pl) {
  const el = document.getElementById('playlist-tracks-list');
  const all = getAllTracks();
  const tracksInPl = pl.trackIds
    .map(id => all.find(t => String(t.id) === String(id)))
    .filter(Boolean);

  if (tracksInPl.length === 0) {
    el.innerHTML = `
      <div class="empty-state" style="padding:60px 20px">
        <span>🎵</span>
        <p>Плейлист порожній. Додай треки через кнопку ···</p>
      </div>`;
    return;
  }

  el.innerHTML = tracksInPl.map((t, i) => playlistTrackRowHTML(t, i, pl.id)).join('');
}

function playlistTrackRowHTML(track, displayNum, plId) {
  const globalIdx = getTrackGlobalIndex(track);
  const playing = currentTrackIndex === globalIdx && isPlaying;
  const liked = likedIds.has(track.id);
  return `
    <div class="track-row ${currentTrackIndex === globalIdx ? 'playing' : ''}"
         onclick="playTrackByGlobalIndex(${globalIdx})"
         id="plrow-${track.id}">
      <div style="position:relative; width:40px; display:flex; align-items:center; justify-content:center;">
        <span class="track-row-num">${displayNum + 1}</span>
        <div class="track-row-num-icon">
          ${playing
            ? `<div class="playing-bars"><span></span><span></span><span></span></div>`
            : `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="color:var(--text-secondary)"><path d="M5 3l14 9-14 9V3z"/></svg>`
          }
        </div>
      </div>
      <div class="track-row-cover">
        <img src="${track.cover}" alt="${track.title}" loading="lazy" />
      </div>
      <div class="track-row-info">
        <div class="track-row-title">${track.title}</div>
        <div class="track-row-artist">${track.artist}</div>
      </div>
      <button class="track-row-like ${liked ? 'liked' : ''}"
              onclick="event.stopPropagation(); toggleLikeById(${track.id})"
              title="${liked ? 'Прибрати' : 'Вподобати'}">
        <svg viewBox="0 0 24 24" fill="${liked ? '#e05574' : 'none'}" stroke="${liked ? '#e05574' : 'currentColor'}" stroke-width="2" width="16" height="16">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </button>
      <button class="track-row-remove-pl"
              onclick="event.stopPropagation(); removeFromPlaylist('${plId}', ${track.id})"
              title="Видалити з плейлиста">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <span class="track-row-duration">${formatTime(track.duration)}</span>
    </div>
  `;
}

// --- Play all ---
function playPlaylistAll() {
  const pl = playlists.find(p => p.id === currentPlaylistId);
  if (!pl || pl.trackIds.length === 0) return;
  const all = getAllTracks();
  const first = all.find(t => String(t.id) === String(pl.trackIds[0]));
  if (!first) return;
  playTrackByGlobalIndex(getTrackGlobalIndex(first));
}

// --- Remove from playlist ---
function removeFromPlaylist(plId, trackId) {
  const pl = playlists.find(p => p.id === plId);
  if (!pl) return;
  pl.trackIds = pl.trackIds.filter(id => id !== trackId);
  savePlaylists();
  renderPlaylistTracks(pl);
  document.getElementById('pv-stats').textContent =
    `${pl.trackIds.length} ${trackWord(pl.trackIds.length)}`;
  renderSidebarPlaylists();
  showNotification('🗑️ Трек видалено з плейлиста');
}

// --- Delete current playlist ---
function deleteCurrentPlaylist() {
  const pl = playlists.find(p => p.id === currentPlaylistId);
  if (!pl) return;
  if (!confirm(`Видалити плейлист "${pl.name}"?`)) return;
  playlists = playlists.filter(p => p.id !== currentPlaylistId);
  currentPlaylistId = null;
  savePlaylists();
  renderSidebarPlaylists();
  showSection('home', document.getElementById('nav-home'));
  showNotification('🗑️ Плейлист видалено');
}

let tempPlaylistCoverBase64 = null;

// --- Edit playlist ---
function openEditPlaylist() {
  const pl = playlists.find(p => p.id === currentPlaylistId);
  if (!pl) return;
  editingPlaylistId = pl.id;
  selectedGradient = pl.gradient || PLAYLIST_GRADIENTS[0];
  tempPlaylistCoverBase64 = pl.customCover || null;
  document.getElementById('playlist-modal-title').textContent = 'Редагувати плейлист';
  document.getElementById('playlist-modal-save').textContent = 'Зберегти';
  document.getElementById('playlist-name-input').value = pl.name;
  document.getElementById('playlist-desc-input').value = pl.desc || '';
  renderCoverPicker();
  document.getElementById('playlist-modal-overlay').classList.add('open');
}

// --- Create playlist ---
function openCreatePlaylist() {
  editingPlaylistId = null;
  tempPlaylistCoverBase64 = null;
  selectedGradient = PLAYLIST_GRADIENTS[Math.floor(Math.random() * PLAYLIST_GRADIENTS.length)];
  document.getElementById('playlist-modal-title').textContent = 'Новий плейлист';
  document.getElementById('playlist-modal-save').textContent = 'Створити';
  document.getElementById('playlist-name-input').value = '';
  document.getElementById('playlist-desc-input').value = '';
  // Close add-to-playlist if open
  document.getElementById('add-to-playlist-overlay').classList.remove('open');
  renderCoverPicker();
  document.getElementById('playlist-modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('playlist-name-input').focus(), 300);
}

function closePlaylistModal() {
  document.getElementById('playlist-modal-overlay').classList.remove('open');
  document.getElementById('playlist-cover-file').value = '';
}

function handlePlaylistCoverUpload(input) {
  const file = input.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    tempPlaylistCoverBase64 = e.target.result;
    
    // Clear selected gradient
    document.querySelectorAll('.cover-option').forEach(o => o.classList.remove('selected'));
    
    const preview = document.getElementById('playlist-cover-preview');
    preview.className = 'playlist-cover-preview single';
    preview.style.background = 'transparent';
    preview.innerHTML = `<img src="${tempPlaylistCoverBase64}" style="width:100%; height:100%; object-fit:cover;" />`;
  };
  reader.readAsDataURL(file);
}

function renderCoverPicker() {
  const optionsEl = document.getElementById('playlist-cover-options');
  const previewEl = document.getElementById('playlist-cover-preview');
  optionsEl.innerHTML = PLAYLIST_GRADIENTS.map((g, i) => `
    <div class="cover-option ${g === selectedGradient && !tempPlaylistCoverBase64 ? 'selected' : ''}"
         style="background:${g}"
         onclick="selectGradient('${g}', this)"></div>
  `).join('');
  
  previewEl.className = 'playlist-cover-preview single';
  if (tempPlaylistCoverBase64) {
    previewEl.style.background = 'transparent';
    previewEl.innerHTML = `<img src="${tempPlaylistCoverBase64}" style="width:100%; height:100%; object-fit:cover;" />`;
  } else {
    previewEl.style.background = selectedGradient;
    previewEl.innerHTML = '';
  }
}

function selectGradient(gradient, el) {
  selectedGradient = gradient;
  tempPlaylistCoverBase64 = null;
  document.querySelectorAll('.cover-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  const preview = document.getElementById('playlist-cover-preview');
  preview.style.background = gradient;
  preview.innerHTML = '';
}

// --- Save (create or update) playlist ---
function savePlaylist() {
  const name = document.getElementById('playlist-name-input').value.trim();
  if (!name) {
    document.getElementById('playlist-name-input').focus();
    document.getElementById('playlist-name-input').style.borderColor = '#e05574';
    setTimeout(() => document.getElementById('playlist-name-input').style.borderColor = '', 1500);
    return;
  }
  const desc = document.getElementById('playlist-desc-input').value.trim();

  if (editingPlaylistId) {
    const pl = playlists.find(p => p.id === editingPlaylistId);
    if (pl) {
      pl.name = name;
      pl.desc = desc;
      pl.gradient = selectedGradient;
      pl.customCover = tempPlaylistCoverBase64;
    }
    showNotification('✏️ Плейлист оновлено');
    // refresh view if still open
    if (currentPlaylistId === editingPlaylistId) {
      document.getElementById('pv-name').textContent = name;
      document.getElementById('pv-desc').textContent = desc;
      // Also reload the view fully to update covers
      openPlaylistView(editingPlaylistId);
    }
  } else {
    const pl = {
      id: 'pl_' + Date.now(),
      name,
      desc,
      gradient: selectedGradient,
      customCover: tempPlaylistCoverBase64,
      trackIds: [],
    };
    playlists.unshift(pl);
    showNotification(`🎵 Плейлист "${name}" створено`);
  }

  savePlaylists();
  renderSidebarPlaylists();
  closePlaylistModal();
}

// --- Add to playlist modal ---
function openAddToPlaylist(trackId) {
  addToPlaylistTrackId = trackId;
  renderAddToPlaylistList();
  document.getElementById('add-to-playlist-overlay').classList.add('open');
}

function closeAddToPlaylist() {
  document.getElementById('add-to-playlist-overlay').classList.remove('open');
  addToPlaylistTrackId = null;
}

function renderAddToPlaylistList() {
  const el = document.getElementById('add-to-playlist-list');
  if (playlists.length === 0) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Немає плейлистів. Створи перший!</div>`;
    return;
  }
  el.innerHTML = playlists.map(pl => {
    const covers = getPlaylistCovers(pl, 4);
    const thumbHTML = buildThumbHTML(covers, pl.gradient, 'atp-thumb');
    const inPl = pl.trackIds.includes(addToPlaylistTrackId);
    return `
      <div class="atp-item ${inPl ? 'in-playlist' : ''}" onclick="addTrackToPlaylist('${pl.id}')">
        ${thumbHTML}
        <div class="atp-info">
          <div class="atp-name">${escapeHtml(pl.name)}</div>
          <div class="atp-count">${pl.trackIds.length} ${trackWord(pl.trackIds.length)}</div>
        </div>
        ${inPl ? `<div class="atp-added"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" width="10" height="10"><polyline points="20 6 9 17 4 12"/></svg></div>` : ''}
      </div>
    `;
  }).join('');
}

function addTrackToPlaylist(plId) {
  const pl = playlists.find(p => p.id === plId);
  if (!pl || addToPlaylistTrackId === null) return;
  if (pl.trackIds.includes(addToPlaylistTrackId)) return;
  pl.trackIds.push(addToPlaylistTrackId);
  savePlaylists();
  renderAddToPlaylistList();
  renderSidebarPlaylists();
  const all = getAllTracks();
  const track = all.find(t => String(t.id) === String(addToPlaylistTrackId));
  showNotification(`➕ "${track ? track.title : 'Трек'}" → ${pl.name}`);
  setTimeout(closeAddToPlaylist, 800);
}

// Legacy stub kept for safety
function loadPlaylist(name) {}



// ===== UI UTILS =====
function updatePlayingHighlights() {
  document.querySelectorAll('.track-row').forEach(row => row.classList.remove('playing'));
  if (currentTrackIndex < 0) return;
  const track = getTrackAtIndex(currentTrackIndex);
  if (!track) return;
  const el = document.getElementById(`row-${track.id}`);
  if (el) el.classList.add('playing');
  renderTrendingGrid();
  renderRecommendedList();
  if (currentSection === 'explore') renderExploreList(currentGenreFilter);
}

let notifTimer = null;
function showNotification(msg) {
  const el = document.getElementById('notification');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function formatTime(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== KEYBOARD SHORTCUTS =====
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    switch(e.code) {
      case 'Space': e.preventDefault(); togglePlay(); break;
      case 'ArrowRight': e.preventDefault(); nextTrack(); break;
      case 'ArrowLeft': e.preventDefault(); prevTrack(); break;
      case 'KeyL': toggleLike(); break;
      case 'KeyS': toggleShuffle(); break;
      case 'KeyR': toggleRepeat(); break;
      case 'KeyM': toggleMute(); break;
    }
  });
}

// ===== MEDIA SESSION =====
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', togglePlay);
  navigator.mediaSession.setActionHandler('pause', togglePlay);
  navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
  navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
}

// =============================================
//  AUDIO EXTRACTOR
// =============================================

let extractorBlob = null;   // current media blob (File or fetched)
let extractorCustomCover = null;
let extractorIsAudio = false;

function switchExtTab(tab) {
  document.querySelectorAll('.ext-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ext-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`ext-tab-${tab}`).classList.add('active');
  document.getElementById(`ext-panel-${tab}`).classList.add('active');
  resetExtPreview();
}

// --- Drag & Drop ---
function setupExtractorDragDrop() {
  const zone = document.getElementById('ext-drop-zone');
  if (!zone) return;
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processExtractorFile(file);
  });
}

function handleExtractorFile(input) {
  const file = input.files[0];
  if (file) processExtractorFile(file);
  input.value = '';
}

function processExtractorFile(file) {
  extractorBlob = file;
  extractorIsAudio = file.type.startsWith('audio/');

  const nameWithoutExt = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
  document.getElementById('ext-title').value = nameWithoutExt;
  document.getElementById('ext-artist').value = '';

  showExtPreview(URL.createObjectURL(file), extractorIsAudio);
}

function loadExtractorUrl() {
  const url = document.getElementById('ext-url-input').value.trim();
  if (!url) return;

  const btn = document.querySelector('.ext-url-btn');
  btn.textContent = 'Завантаження...';
  btn.disabled = true;

  // Intercept TikTok URLs
  if (url.includes('tiktok.com')) {
    btn.textContent = 'Отримання даних TikTok...';
    fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then(data => {
        if (data.code === 0 && data.data && data.data.play) {
          const videoUrl = data.data.play;
          const author = data.data.author ? data.data.author.nickname : 'TikTok User';
          const title = data.data.title || 'TikTok Video';
          const cover = data.data.cover;

          document.getElementById('ext-title').value = title;
          document.getElementById('ext-artist').value = author;
          
          if (cover) {
            extractorCustomCover = cover;
            document.getElementById('ext-save-cover').innerHTML = `<img src="${cover}" style="width:100%; height:100%; object-fit:cover;" />`;
            document.getElementById('ext-save-cover').style.background = 'transparent';
          }
          
          showExtPreview(videoUrl, false);
          
          btn.textContent = 'Завантаження відео...';
          return fetch(videoUrl)
            .then(r => r.blob())
            .then(blob => {
              extractorBlob = blob;
              extractorIsAudio = false;
            });
        } else {
          throw new Error('Не вдалося отримати TikTok відео');
        }
      })
      .catch(e => {
        if (typeof showNotification === 'function') showNotification('❌ Помилка: неможливо завантажити TikTok');
        extractorBlob = null;
      })
      .finally(() => {
        btn.textContent = 'Завантажити';
        btn.disabled = false;
      });
    return;
  }

  // Try to load directly into video element (works for direct mp4/webm URLs)
  const isAudio = /\.(mp3|wav|flac|ogg|aac|m4a)(\?|$)/i.test(url);
  showExtPreview(url, isAudio);

  // Try to fetch the blob for saving
  fetch(url)
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    })
    .then(blob => {
      extractorBlob = blob;
      extractorIsAudio = isAudio;
    })
    .catch(() => {
      // Can't fetch (CORS) — will use URL directly
      extractorBlob = null;
    })
    .finally(() => {
      btn.textContent = 'Завантажити';
      btn.disabled = false;
    });

  // Pre-fill title from URL
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const filename = pathParts[pathParts.length - 1];
    const nameWithoutExt = decodeURIComponent(filename).replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
    if (nameWithoutExt) document.getElementById('ext-title').value = nameWithoutExt;
  } catch {}
}

function showExtPreview(src, isAudio) {
  const preview = document.getElementById('ext-preview');
  const mediaWrap = preview.querySelector('.ext-media-wrap');
  const video = document.getElementById('ext-video');

  video.src = src;
  // Show/hide based on type
  if (isAudio) {
    mediaWrap.innerHTML = `<audio controls src="${src}" style="width:100%;padding:16px;box-sizing:border-box"></audio>`;
  } else {
    mediaWrap.innerHTML = `<video id="ext-video" src="${src}" controls controlsList="nodownload" preload="metadata" style="width:100%;max-height:320px;display:block;background:#000"></video>`;
  }

  preview.classList.add('visible');
  preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetExtPreview() {
  const preview = document.getElementById('ext-preview');
  preview.classList.remove('visible');
  const mediaWrap = preview.querySelector('.ext-media-wrap');
  mediaWrap.innerHTML = `<video id="ext-video" controls controlsList="nodownload" preload="metadata"></video>`;
  extractorBlob = null;
  extractorCustomCover = null;
  document.getElementById('ext-title').value = '';
  document.getElementById('ext-artist').value = '';
}

// --- Save extracted track ---
async function saveExtractedTrack() {
  const title = document.getElementById('ext-title').value.trim() || 'Без назви';
  const artist = document.getElementById('ext-artist').value.trim() || 'Невідомо';
  const saveToLibrary = document.getElementById('ext-save-library').checked;
  const saveToLiked = document.getElementById('ext-save-liked').checked;

  const btn = document.getElementById('ext-save-btn');
  btn.disabled = true;
  btn.innerHTML = `<span>Збереження...</span>`;

  try {
    // Determine source blob
    let blob = extractorBlob;
    let blobUrl;

    if (!blob) {
      // Try URL mode: get from video element src
      const videoEl = document.querySelector('#ext-preview video, #ext-preview audio');
      if (videoEl && videoEl.src && !videoEl.src.startsWith('blob:')) {
        // Can't save remote URL to IndexedDB without CORS - save URL as track with remote src
        await saveExtractedRemoteTrack(title, artist, videoEl.src, saveToLibrary, saveToLiked);
        return;
      }
    }

    if (!blob) {
      showNotification('⚠️ Не вдалося отримати файл. Спробуй завантажити файл напряму.');
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Зберегти трек`;
      return;
    }

    blobUrl = URL.createObjectURL(blob);
    const trackId = Date.now();
    const user = typeof currentUser !== 'undefined' ? currentUser : null;
    const email = user ? user.email : null;

    // Generate gradient cover
    const gradients = [
      'linear-gradient(135deg,#667eea,#764ba2)',
      'linear-gradient(135deg,#f093fb,#f5576c)',
      'linear-gradient(135deg,#4facfe,#00f2fe)',
      'linear-gradient(135deg,#43e97b,#38f9d7)',
      'linear-gradient(135deg,#fa709a,#fee140)',
    ];
    const coverGrad = gradients[trackId % gradients.length];
    const coverSvg = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'>${coverGrad.match(/#\w+/g).map((c,i) => `<stop offset='${i*100}%25' stop-color='${c}'/>`).join('')}</linearGradient></defs><rect width='200' height='200' fill='url(%23g)'/><text x='50%25' y='55%25' text-anchor='middle' fill='white' font-size='64' font-family='sans-serif'>🎵</text></svg>`;

    const track = {
      id: trackId,
      title,
      artist,
      genre: 'Відео',
      duration: 0,
      cover: extractorCustomCover || coverSvg,
      plays: '0',
      src: blobUrl,
      liked: false,
    };

    // Get duration
    try {
      const tempAudio = new Audio(blobUrl);
      await new Promise((res) => {
        tempAudio.addEventListener('loadedmetadata', () => {
          track.duration = Math.round(tempAudio.duration) || 0;
          res();
        });
        tempAudio.addEventListener('error', res);
        setTimeout(res, 3000);
      });
    } catch {}

    // Save audio blob to IndexedDB
    await swSaveAudio(trackId, blob);

    // Save metadata to localStorage
    if (saveToLibrary) {
      userTracks.push(track);
      swSaveTracksMeta(email, userTracks);
      if (typeof renderLibraryList === 'function') renderLibraryList();
      if (typeof updateQueueList === 'function') updateQueueList();
    }

    // Add to liked
    if (saveToLiked) {
      likedIds.add(trackId);
      saveLiked(email);
      if (typeof renderLikedList === 'function') renderLikedList();
    }

    showNotification(`✅ "${title}" збережено!`);
    resetExtPreview();

    // Update ext saved block
    renderExtSavedList();

  } catch (e) {
    console.error('[Extractor] Save failed:', e);
    showNotification('❌ Помилка збереження');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Зберегти трек`;
  }
}

async function saveExtractedRemoteTrack(title, artist, src, saveToLibrary, saveToLiked) {
  const trackId = Date.now();
  const user = typeof currentUser !== 'undefined' ? currentUser : null;
  const email = user ? user.email : null;
  const coverSvg = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='200' height='200' fill='%23667eea'/><text x='50%25' y='55%25' text-anchor='middle' fill='white' font-size='64' font-family='sans-serif'>🎵</text></svg>`;

  const track = { id: trackId, title, artist, genre: 'Відео', duration: 0, cover: extractorCustomCover || coverSvg, plays: '0', src, liked: false };

  if (saveToLibrary) {
    userTracks.push(track);
    swSaveTracksMeta(email, userTracks);
    if (typeof renderLibraryList === 'function') renderLibraryList();
  }
  if (saveToLiked) {
    likedIds.add(trackId);
    saveLiked(email);
    if (typeof renderLikedList === 'function') renderLikedList();
  }
  showNotification(`✅ "${title}" збережено (без офлайн-збереження)`);
  resetExtPreview();
  renderExtSavedList();

  const btn = document.getElementById('ext-save-btn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Зберегти трек`;
  }
}

function renderExtSavedList() {
  // Show user tracks tagged as 'Відео' genre
  const videoTracks = userTracks.filter(t => t.genre === 'Відео');
  const block = document.getElementById('ext-saved-block');
  const list = document.getElementById('ext-saved-list');
  if (!block || !list) return;
  if (videoTracks.length === 0) { block.style.display = 'none'; return; }
  block.style.display = '';
  list.innerHTML = videoTracks.map((t, i) => trackRowHTML(t, i, 'extractor')).join('');
}

// =============================================
//  ACCOUNT SWITCHER
// =============================================

function openAccountSwitcher() {
  if (typeof getUsers !== 'function') return;
  const users = getUsers();
  const list = document.getElementById('accsw-list');
  if (!list) return;

  if (users.length === 0) {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Немає збережених акаунтів</div>`;
  } else {
    const currentEmail = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
    list.innerHTML = users.map(u => {
      const initials = u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
      const grad = typeof AVATAR_GRADIENTS !== 'undefined'
        ? AVATAR_GRADIENTS[u.avatarIdx || 0]
        : 'linear-gradient(135deg,#ff6b35,#f7931e)';
      const isCurrent = u.email === currentEmail;
      
      let avatarHTML = '';
      if (u.customAvatar) {
        avatarHTML = `<div class="accsw-avatar" style="background:transparent"><img src="${u.customAvatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" /></div>`;
      } else {
        avatarHTML = `<div class="accsw-avatar" style="background:${grad}">${initials}</div>`;
      }

      return `
        <div class="accsw-item ${isCurrent ? 'current' : ''}"
             onclick="${isCurrent ? '' : `switchToAccount('${u.email}')`}">
          ${avatarHTML}
          <div class="accsw-info">
            <div class="accsw-name">${escapeHtml(u.name)}</div>
            <div class="accsw-email">${escapeHtml(u.email)}</div>
          </div>
          ${isCurrent ? '<div class="accsw-badge">Зараз</div>' : ''}
        </div>
      `;
    }).join('');
  }

  document.getElementById('accsw-overlay').classList.add('open');
}

function closeAccountSwitcher() {
  document.getElementById('accsw-overlay').classList.remove('open');
}

async function switchToAccount(email) {
  closeAccountSwitcher();
  if (typeof getUsers !== 'function') return;
  const users = getUsers();
  const user = users.find(u => u.email === email);
  if (!user) return;

  // Stop music and clear queue
  if (typeof audio !== 'undefined' && audio) audio.pause();
  queue = [];
  currentTrackIndex = -1;
  document.getElementById('player-title').textContent = 'Трек не вибрано';
  document.getElementById('player-artist').textContent = 'Виконавець';
  document.getElementById('player-cover').src = 'https://ui-avatars.com/api/?name=Music&background=2a2a35&color=fff&size=120';
  document.getElementById('play-btn').innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M5 3l14 9-14 9V3z"/></svg>`;
  if (typeof updateQueueList === 'function') updateQueueList();

  // Clear current playlists view
  playlists = [];
  renderSidebarPlaylists();

  // Logout current
  if (typeof currentUser !== 'undefined' && currentUser) {
    if (typeof userTracks !== 'undefined') {
      userTracks.forEach(t => { if (t.src && t.src.startsWith('blob:')) URL.revokeObjectURL(t.src); });
      userTracks = [];
      if (typeof renderLibraryList === 'function') renderLibraryList();
    }
  }

  // Save session and login as new user
  if (typeof saveSession === 'function') saveSession(user);
  if (typeof loginSuccess === 'function') {
    try {
      await loginSuccess(user, true);
    } catch(e) {
      console.error('Login success error:', e);
    }
  }

  // Redirect to home page so we don't stay on an old playlist
  if (typeof showSection === 'function') {
    showSection('home', document.getElementById('nav-home'));
  }
}

// ===== DELETE TRACK =====
async function deleteUserTrack(trackId) {
  if (!confirm('Ти дійсно хочеш видалити цей трек назавжди?')) return;
  
  const user = typeof currentUser !== 'undefined' ? currentUser : null;
  const email = user ? user.email : null;
  
  // Find the track
  const track = userTracks.find(t => String(t.id) === String(trackId));
  if (!track) return;
  
  // Delete from storage
  if (typeof swDeleteTrack === 'function') {
    await swDeleteTrack(email, trackId);
  }
  
  // Clean up Blob URL to free memory
  if (track.src && track.src.startsWith('blob:')) {
    URL.revokeObjectURL(track.src);
  }
  
  // Remove from state
  userTracks = userTracks.filter(t => String(t.id) !== String(trackId));
  likedIds.delete(trackId);
  if (typeof saveLiked === 'function') saveLiked(email);
  
  // Remove from all playlists
  let playlistsUpdated = false;
  playlists.forEach(pl => {
    if (pl.trackIds.includes(trackId)) {
      pl.trackIds = pl.trackIds.filter(id => id !== trackId);
      playlistsUpdated = true;
    }
  });
  if (playlistsUpdated) {
    savePlaylists();
    renderSidebarPlaylists();
    if (currentPlaylistId) {
      const activePl = playlists.find(p => p.id === currentPlaylistId);
      if (activePl) {
        renderPlaylistTracks(activePl);
        document.getElementById('pv-stats').textContent = `${activePl.trackIds.length} ${trackWord(activePl.trackIds.length)}`;
      }
    }
  }
  
  // Update UI
  if (typeof renderLibraryList === 'function') renderLibraryList();
  if (typeof renderLikedList === 'function') renderLikedList();
  if (typeof renderExtSavedList === 'function') renderExtSavedList();
  if (typeof updateQueueList === 'function') updateQueueList();
  
  showNotification('🗑️ Трек видалено');
}

// Init extractor drag-drop on DOMContentLoaded is called in main init

