/* ========================================
   SoundWave — Публічні профілі та друзі
   Потребує: supabaseClient, currentUser (auth.js), MSG / msgOpenChat (messages.js),
             swMapRow (storage.js), showSection / showNotification (app.js)
   SQL: profiles.sql
   ======================================== */

const PF = {
  rows: [],          // записи friendships, де я учасник
  profiles: {},      // userId -> рядок з таблиці profiles
  timer: null,
  setupError: false,
  lastIncoming: -1,
  openUid: null,     // чий профіль відкрито у вікні
  openData: null,
  searchTimer: null,
  searchSeq: 0,
};

/* ---------- Допоміжні ---------- */

function pfEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pfEl(id) { return document.getElementById(id); }

function pfMe() {
  if (typeof MSG !== 'undefined' && MSG.me && MSG.me.id) return MSG.me.id;
  if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) return currentUser.id;
  return null;
}

function pfNotify(msg) {
  if (typeof showNotification === 'function') showNotification(msg);
  else console.log('[Friends]', msg);
}

function pfGradient(seed) {
  if (typeof msgGradient === 'function') return msgGradient(seed);
  return 'linear-gradient(135deg,#ff6b35,#f7931e)';
}

function pfAvatar(p, size = 44) {
  const name = (p && p.name) || '?';
  const id = (p && p.id) || name;
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`;
  if (p && p.avatar_url && /^https?:/i.test(p.avatar_url)) {
    return `<div class="pf-av" style="${st}"><img src="${pfEsc(p.avatar_url)}" data-nofb="1" alt="" /></div>`;
  }
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  return `<div class="pf-av" style="${st};background:${pfGradient(id)}">${pfEsc(initials)}</div>`;
}

function pfJoined(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
}

/* ---------- Дані профілів ---------- */

async function pfFetchProfiles(ids) {
  const need = [...new Set(ids)].filter(id => id && !PF.profiles[id]);
  if (!need.length || typeof supabaseClient === 'undefined') return;
  try {
    const { data } = await supabaseClient.from('profiles').select('*').in('id', need);
    (data || []).forEach(p => { PF.profiles[p.id] = p; });
  } catch (e) {
    console.warn('[Friends] profiles load failed', e);
  }
}

async function pfFetchOne(uid) {
  try {
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) { console.warn('[Profile] load failed', error.message); return null; }
    if (data) PF.profiles[uid] = data;
    return data;
  } catch (e) {
    console.warn('[Profile] load failed', e);
    return null;
  }
}

async function pfFetchUserTracks(uid) {
  try {
    const { data, error } = await supabaseClient
      .from('tracks')
      .select('*')
      .eq('user_id', uid)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) return [];
    const map = (typeof swMapRow === 'function') ? (d => swMapRow(d, 'Спільнота', true)) : (d => ({
      id: d.id, title: d.title, artist: d.artist || 'Невідомий', cover: d.cover_url, src: d.file_url,
      is_public: true, owner: d.owner_name, owner_id: d.user_id, liked: false
    }));
    return (data || []).map(map).filter(t => t.src);
  } catch (e) {
    return [];
  }
}

/* ---------- Друзі: дані ---------- */

async function pfLoad() {
  const me = pfMe();
  if (!me || typeof supabaseClient === 'undefined') { PF.rows = []; pfUpdateBadge(); return; }
  try {
    const { data, error } = await supabaseClient
      .from('friendships')
      .select('*')
      .or(`requester_id.eq.${me},addressee_id.eq.${me}`);
    if (error) {
      PF.setupError = /relation|does not exist|schema cache/i.test(error.message);
      console.warn('[Friends] load failed:', error.message);
      PF.rows = [];
      pfUpdateBadge();
      return;
    }
    PF.setupError = false;
    PF.rows = data || [];
    await pfFetchProfiles(PF.rows.map(r => r.requester_id === me ? r.addressee_id : r.requester_id));
    pfUpdateBadge();
  } catch (e) {
    console.warn('[Friends] load failed', e);
  }
}

function pfRow(uid) {
  const me = pfMe();
  return PF.rows.find(r => (r.requester_id === me && r.addressee_id === uid) || (r.requester_id === uid && r.addressee_id === me));
}

// 'guest' | 'self' | 'none' | 'outgoing' | 'incoming' | 'friends'
function pfStatus(uid) {
  const me = pfMe();
  if (!me) return 'guest';
  if (uid === me) return 'self';
  const r = pfRow(uid);
  if (!r) return 'none';
  if (r.status === 'accepted') return 'friends';
  return r.requester_id === me ? 'outgoing' : 'incoming';
}

function pfIncomingCount() {
  const me = pfMe();
  return PF.rows.filter(r => r.status === 'pending' && r.addressee_id === me).length;
}

function pfUpdateBadge() {
  const b = pfEl('friends-badge');
  const n = pfIncomingCount();
  if (b) {
    b.textContent = n;
    b.style.display = n > 0 ? '' : 'none';
  }
  if (PF.lastIncoming >= 0 && n > PF.lastIncoming) pfNotify('👥 Новий запит у друзі!');
  PF.lastIncoming = n;
}

/* ---------- Друзі: дії ---------- */

async function pfSendRequest(uid) {
  const me = pfMe();
  if (!me) { if (typeof openAuth === 'function') openAuth('login'); return false; }
  const st = pfStatus(uid);
  if (st === 'incoming') return pfAccept(uid);
  if (st !== 'none') return false;

  const { error } = await supabaseClient.from('friendships').insert({
    requester_id: me, addressee_id: uid, status: 'pending'
  });
  if (error && error.code !== '23505') {
    pfNotify(/relation|does not exist|schema cache/i.test(error.message)
      ? '⚠️ Таблицю friendships не створено — запусти profiles.sql у Supabase'
      : '❌ Не вдалося надіслати запит: ' + error.message);
    return false;
  }
  if (!error) pfNotify('✅ Запит у друзі надіслано');
  await pfLoad();
  pfRefreshUI();
  return true;
}

async function pfAccept(uid) {
  const me = pfMe();
  if (!me) return false;
  const { error } = await supabaseClient.from('friendships')
    .update({ status: 'accepted' })
    .eq('requester_id', uid).eq('addressee_id', me);
  if (error) { pfNotify('❌ Не вдалося прийняти запит: ' + error.message); return false; }
  pfNotify('🎉 Тепер ви друзі!');
  await pfLoad();
  pfRefreshUI();
  return true;
}

async function pfRemove(uid, okMsg) {
  const me = pfMe();
  if (!me) return false;
  const { error } = await supabaseClient.from('friendships').delete()
    .or(`and(requester_id.eq.${me},addressee_id.eq.${uid}),and(requester_id.eq.${uid},addressee_id.eq.${me})`);
  if (error) { pfNotify('❌ Помилка: ' + error.message); return false; }
  if (okMsg) pfNotify(okMsg);
  await pfLoad();
  pfRefreshUI();
  return true;
}

/* ---------- Кнопки (однакові для списку друзів і профілю) ---------- */

function pfBtn(act, uid, name, label, cls) {
  return `<button class="pf-btn ${cls || ''}" data-pf-act="${act}" data-uid="${pfEsc(uid)}" data-name="${pfEsc(name || '')}">${label}</button>`;
}

function pfActionsHTML(uid, name) {
  switch (pfStatus(uid)) {
    case 'self': return '';
    case 'guest': return pfBtn('login', uid, name, 'Увійти, щоб додати в друзі', 'primary');
    case 'none': return pfBtn('add', uid, name, '➕ Додати в друзі', 'primary');
    case 'outgoing': return `<span class="pf-pill">Запит надіслано</span>` + pfBtn('cancel', uid, name, 'Скасувати');
    case 'incoming': return pfBtn('accept', uid, name, '✅ Прийняти', 'primary') + pfBtn('decline', uid, name, 'Відхилити');
    case 'friends': return pfBtn('write', uid, name, '✉️ Написати', 'primary') + pfBtn('remove', uid, name, 'Видалити', 'danger');
  }
  return '';
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pf-act]');
  if (!b) return;
  e.preventDefault();
  const act = b.dataset.pfAct, uid = b.dataset.uid, name = b.dataset.name;

  if (act === 'profile') return openUserProfile(uid, name);
  if (act === 'close') return pfCloseProfile();
  if (act === 'login') { pfCloseProfile(); if (typeof openAuth === 'function') openAuth('login'); return; }
  if (act === 'edit') { pfCloseProfile(); if (typeof openProfileEdit === 'function') openProfileEdit(); return; }
  if (act === 'write') {
    pfCloseProfile();
    if (typeof msgOpenChat === 'function') msgOpenChat(uid, name);
    return;
  }
  if (act === 'play') return pfPlayTrack(b.dataset.tid);

  if (b.disabled) return;
  b.disabled = true;
  try {
    if (act === 'add') await pfSendRequest(uid);
    else if (act === 'accept') await pfAccept(uid);
    else if (act === 'decline') await pfRemove(uid);
    else if (act === 'cancel') await pfRemove(uid, 'Запит скасовано');
    else if (act === 'remove') {
      if (confirm(`Видалити ${name || 'користувача'} з друзів?`)) await pfRemove(uid, 'Видалено з друзів');
    }
  } finally {
    b.disabled = false;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pfEl('pf-overlay')) pfCloseProfile();
});

/* ---------- Вікно профілю ---------- */

function pfCloseProfile() {
  const ov = pfEl('pf-overlay');
  if (ov) ov.remove();
  PF.openUid = null;
  PF.openData = null;
  document.body.classList.remove('pf-lock');
}

async function openUserProfile(uid, nameHint) {
  if (!uid) return;
  if (typeof supabaseClient === 'undefined') return pfNotify('Немає зв’язку з сервером');
  pfCloseProfile();

  const ov = document.createElement('div');
  ov.className = 'pf-overlay';
  ov.id = 'pf-overlay';
  ov.innerHTML = `<div class="pf-modal"><button class="pf-close" data-pf-act="close" title="Закрити">✕</button>
    <div id="pf-body"><div class="pf-loading">Завантаження...</div></div></div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) pfCloseProfile(); });
  document.body.appendChild(ov);
  document.body.classList.add('pf-lock');
  PF.openUid = uid;

  if (pfMe() && !PF.rows.length && !PF.setupError) await pfLoad();
  const [prof, tracks] = await Promise.all([pfFetchOne(uid), pfFetchUserTracks(uid)]);
  if (PF.openUid !== uid) return;

  PF.openData = {
    uid,
    prof: prof || { id: uid, name: nameHint || 'Користувач' },
    tracks,
  };
  pfRenderProfile();
}

function pfRenderProfile() {
  const d = PF.openData;
  const body = pfEl('pf-body');
  if (!d || !body) return;
  const p = d.prof, uid = d.uid;
  const name = p.name || 'Користувач';

  const bannerStyle = (p.banner_url && /^https?:/i.test(p.banner_url))
    ? `background-image:url('${pfEsc(p.banner_url)}')`
    : `background:${pfGradient(uid)}`;

  const joined = pfJoined(p.joined_at);
  const chips = [];
  if (p.fav_genre) chips.push(`<span class="pf-chip">🎵 ${pfEsc(p.fav_genre)}</span>`);
  chips.push(`<span class="pf-chip">🎧 Публічних треків: ${d.tracks.length}</span>`);

  const top = p.top_track ? d.tracks.find(t => String(t.id) === String(p.top_track)) : null;
  const topHTML = top ? `
    <div class="pf-section-title">Улюблений трек</div>
    <div class="pf-track">
      <img src="${pfEsc(top.cover)}" alt="" />
      <div class="pf-track-info"><div class="pf-track-title">${pfEsc(top.title)}</div><div class="pf-track-artist">${pfEsc(top.artist)}</div></div>
      <button class="pf-play" data-pf-act="play" data-tid="${pfEsc(top.id)}" title="Грати">▶</button>
    </div>` : '';

  const tracksHTML = d.tracks.length ? `
    <div class="pf-section-title">Публічні треки</div>
    <div class="pf-tracks">${d.tracks.map(t => `
      <div class="pf-track">
        <img src="${pfEsc(t.cover)}" alt="" />
        <div class="pf-track-info"><div class="pf-track-title">${pfEsc(t.title)}</div><div class="pf-track-artist">${pfEsc(t.artist)}</div></div>
        <button class="pf-play" data-pf-act="play" data-tid="${pfEsc(t.id)}" title="Грати">▶</button>
      </div>`).join('')}</div>` : '';

  const isSelf = pfStatus(uid) === 'self';
  let actions = isSelf ? pfBtn('edit', uid, name, '✏️ Редагувати профіль', 'primary') : pfActionsHTML(uid, name);
  if (!isSelf && pfStatus(uid) !== 'friends' && pfMe()) actions += pfBtn('write', uid, name, '✉️ Написати');

  body.innerHTML = `
    <div class="pf-banner" style="${bannerStyle}"></div>
    <div class="pf-head">
      <div class="pf-head-av">${pfAvatar({ ...p, id: uid }, 88)}</div>
      <div class="pf-actions" id="pf-actions">${actions}</div>
    </div>
    <div class="pf-info">
      <h2 class="pf-name">${pfEsc(name)}${isSelf ? ' <span class="pf-you">це ти</span>' : ''}</h2>
      ${joined ? `<div class="pf-joined">📅 З нами з ${pfEsc(joined)}</div>` : ''}
      ${p.bio ? `<p class="pf-bio">${pfEsc(p.bio)}</p>` : ''}
      <div class="pf-chips">${chips.join('')}</div>
      ${topHTML}
      ${tracksHTML}
    </div>`;
}

function pfPlayTrack(tid) {
  const d = PF.openData;
  if (!d) return;
  const t = d.tracks.find(x => String(x.id) === String(tid));
  if (!t) return;
  try {
    if (typeof tracks !== 'undefined' && !tracks.some(x => String(x.id) === String(t.id))) tracks.push(t);
    if (typeof getAllTracks === 'function' && typeof playTrackByGlobalIndex === 'function') {
      const idx = getAllTracks().findIndex(x => String(x.id) === String(t.id));
      if (idx !== -1) playTrackByGlobalIndex(idx);
    }
  } catch (e) {
    console.warn('[Profile] play failed', e);
  }
}

function msgOpenActiveProfile() {
  if (typeof MSG !== 'undefined' && MSG.activeId) {
    const p = MSG.profiles && MSG.profiles[MSG.activeId];
    openUserProfile(MSG.activeId, p && p.name);
  }
}

/* ---------- Вкладка «Друзі» ---------- */

function pfRefreshUI() {
  pfUpdateBadge();
  if (typeof currentSection !== 'undefined' && currentSection === 'friends') pfRenderFriends();
  if (PF.openData) pfRenderProfile();
  pfRenderSearchResults();
}

function pfUserRow(p, uid, actionsHTML) {
  const name = p.name || 'Користувач';
  return `
    <div class="pf-row">
      <div class="pf-row-main" data-pf-act="profile" data-uid="${pfEsc(uid)}" data-name="${pfEsc(name)}">
        ${pfAvatar({ ...p, id: uid }, 46)}
        <div class="pf-row-info">
          <div class="pf-row-name">${pfEsc(name)}</div>
          <div class="pf-row-sub">${p.bio ? pfEsc(p.bio) : 'Відкрити профіль'}</div>
        </div>
      </div>
      <div class="pf-row-actions">${actionsHTML}</div>
    </div>`;
}

function pfRenderFriends() {
  const guest = pfEl('friends-guest');
  const main = pfEl('friends-main');
  const lists = pfEl('friends-lists');
  if (!guest || !main || !lists) return;

  const me = pfMe();
  if (!me) {
    guest.style.display = 'flex';
    main.style.display = 'none';
    return;
  }
  guest.style.display = 'none';
  main.style.display = '';

  if (PF.setupError) {
    lists.innerHTML = `<div class="empty-state"><span>🛠️</span><p>Таблицю друзів ще не створено. Запусти <b>profiles.sql</b> у Supabase → SQL Editor.</p></div>`;
    return;
  }

  const other = (r) => r.requester_id === me ? r.addressee_id : r.requester_id;
  const prof = (id) => PF.profiles[id] || { id, name: 'Користувач' };
  const incoming = PF.rows.filter(r => r.status === 'pending' && r.addressee_id === me);
  const outgoing = PF.rows.filter(r => r.status === 'pending' && r.requester_id === me);
  const friends = PF.rows.filter(r => r.status === 'accepted');

  const block = (title, arr, emptyText) => `
    <div class="pf-block">
      <div class="pf-block-title">${title} <span class="pf-count">${arr.length}</span></div>
      ${arr.length ? arr.map(r => { const id = other(r); return pfUserRow(prof(id), id, pfActionsHTML(id, prof(id).name)); }).join('')
                   : `<div class="pf-empty">${emptyText}</div>`}
    </div>`;

  let html = '';
  if (incoming.length) html += block('📨 Запити у друзі', incoming, '');
  html += block('👥 Мої друзі', friends, 'Поки що немає друзів. Знайди людей через пошук вище, у «Спільноті» або через «Знайти друга (Потряси)» 📱');
  if (outgoing.length) html += block('⏳ Надіслані запити', outgoing, '');
  lists.innerHTML = html;
}

async function pfOnSectionOpen() {
  pfRenderFriends();
  if (pfMe()) {
    await pfLoad();
    pfRenderFriends();
  }
}

/* ---------- Пошук користувачів ---------- */

function pfOnSearch(value) {
  clearTimeout(PF.searchTimer);
  PF.searchTimer = setTimeout(() => pfRunSearch(value), 300);
}

async function pfRunSearch(value) {
  const box = pfEl('friends-search-results');
  if (!box) return;
  const q = String(value || '').trim().replace(/[%_\\]/g, '');
  const seq = ++PF.searchSeq;
  if (q.length < 2) { PF.searchResults = null; box.innerHTML = ''; return; }
  box.innerHTML = '<div class="pf-empty">Пошук...</div>';
  try {
    const { data, error } = await supabaseClient
      .from('profiles').select('*')
      .ilike('name', `%${q}%`)
      .neq('id', pfMe())
      .limit(12);
    if (seq !== PF.searchSeq) return;
    if (error) { box.innerHTML = `<div class="pf-empty">Помилка пошуку: ${pfEsc(error.message)}</div>`; return; }
    (data || []).forEach(p => { PF.profiles[p.id] = p; });
    PF.searchResults = data || [];
    pfRenderSearchResults();
  } catch (e) {
    box.innerHTML = '<div class="pf-empty">Немає зв’язку з сервером</div>';
  }
}

function pfRenderSearchResults() {
  const box = pfEl('friends-search-results');
  if (!box || !PF.searchResults) return;
  box.innerHTML = PF.searchResults.length
    ? `<div class="pf-block"><div class="pf-block-title">🔎 Результати</div>${
        PF.searchResults.map(p => pfUserRow(p, p.id, pfActionsHTML(p.id, p.name))).join('')}</div>`
    : '<div class="pf-empty">Нікого не знайдено</div>';
}

/* ---------- Ініціалізація ---------- */

async function pfInit() {
  if (!pfMe()) return;
  PF.lastIncoming = -1;
  await pfLoad();
  if (PF.timer) clearInterval(PF.timer);
  PF.timer = setInterval(async () => {
    if (!pfMe() || document.visibilityState !== 'visible') return;
    await pfLoad();
    if (typeof currentSection !== 'undefined' && currentSection === 'friends') pfRenderFriends();
  }, 20000);
}

function pfTeardown() {
  if (PF.timer) clearInterval(PF.timer);
  PF.timer = null;
  PF.rows = [];
  PF.profiles = {};
  PF.lastIncoming = -1;
  PF.setupError = false;
  PF.searchResults = null;
  pfCloseProfile();
  pfUpdateBadge();
  pfRenderFriends();
}

// Підключаємось до входу/виходу, не чіпаючи messages.js
(function hookAuthLifecycle() {
  if (typeof msgInit === 'function') {
    const origInit = msgInit;
    window.msgInit = async function (...args) {
      const r = await origInit.apply(this, args);
      pfInit();
      return r;
    };
  }
  if (typeof msgTeardown === 'function') {
    const origTeardown = msgTeardown;
    window.msgTeardown = function (...args) {
      const r = origTeardown.apply(this, args);
      pfTeardown();
      return r;
    };
  }
  // якщо вхід встиг відбутися до завантаження цього файлу
  setTimeout(() => { if (pfMe() && !PF.timer) pfInit(); }, 2500);
})();

/* ---------- Стилі ---------- */

(function injectProfileStyles() {
  const css = `
  body.pf-lock { overflow: hidden; }
  .pf-overlay { position: fixed; inset: 0; z-index: 9500; background: rgba(0,0,0,.72); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; padding: 16px; }
  .pf-modal { position: relative; width: min(540px, 100%); max-height: 92vh; overflow-y: auto;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
  .pf-close { position: absolute; top: 12px; right: 12px; z-index: 2; width: 34px; height: 34px; border-radius: 50%;
    border: none; background: rgba(0,0,0,.55); color: #fff; cursor: pointer; font-size: 15px; }
  .pf-close:hover { background: rgba(0,0,0,.8); }
  .pf-loading { padding: 70px 20px; text-align: center; color: var(--text-muted); }
  .pf-banner { height: 130px; background-size: cover; background-position: center; border-radius: 20px 20px 0 0; }
  .pf-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; padding: 0 20px; margin-top: -44px; }
  .pf-head-av .pf-av { border: 4px solid var(--bg-card); }
  .pf-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; padding-bottom: 6px; }
  .pf-info { padding: 12px 20px 22px; }
  .pf-name { margin: 6px 0 2px; font-size: 22px; font-weight: 700; color: var(--text-primary); }
  .pf-you { font-size: 11px; font-weight: 600; color: var(--accent); border: 1px solid var(--accent); border-radius: 100px; padding: 1px 8px; vertical-align: middle; }
  .pf-joined { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
  .pf-bio { margin: 8px 0 12px; font-size: 14px; line-height: 1.5; color: var(--text-secondary, #b0b0c0); white-space: pre-wrap; word-break: break-word; }
  .pf-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
  .pf-chip { font-size: 12px; padding: 5px 12px; border-radius: 100px; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-primary); }
  .pf-section-title { margin: 18px 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
  .pf-tracks { display: flex; flex-direction: column; gap: 6px; }
  .pf-track { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 12px; background: var(--bg-elevated); }
  .pf-track img { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
  .pf-track-info { flex: 1; min-width: 0; }
  .pf-track-title { font-size: 14px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pf-track-artist { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pf-play { width: 34px; height: 34px; border-radius: 50%; border: none; background: var(--accent); color: #fff; cursor: pointer; flex-shrink: 0; }
  .pf-play:hover { filter: brightness(1.1); }

  .pf-av { border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700; flex-shrink: 0; background: var(--bg-elevated); }
  .pf-av img { width: 100%; height: 100%; object-fit: cover; }

  .pf-btn { padding: 8px 16px; border-radius: 100px; border: 1px solid var(--border-hover, rgba(255,255,255,.15)); background: transparent;
    color: var(--text-primary); font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .pf-btn:hover { background: var(--bg-elevated); }
  .pf-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .pf-btn.primary:hover { filter: brightness(1.1); }
  .pf-btn.danger { color: #e05574; border-color: rgba(224,85,116,.5); }
  .pf-btn.danger:hover { background: rgba(224,85,116,.12); }
  .pf-btn:disabled { opacity: .5; cursor: default; }
  .pf-pill { font-size: 12px; color: var(--text-muted); padding: 8px 12px; }

  #friends-main { max-width: 760px; }
  .pf-block { margin-top: 22px; }
  .pf-block-title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px; }
  .pf-count { font-size: 12px; font-weight: 600; color: var(--text-muted); margin-left: 4px; }
  .pf-empty { padding: 18px; text-align: center; color: var(--text-muted); font-size: 13px; line-height: 1.5;
    background: var(--bg-card); border: 1px dashed var(--border); border-radius: 12px; }
  .pf-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; margin-bottom: 6px;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; }
  .pf-row-main { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; cursor: pointer; }
  .pf-row-info { min-width: 0; }
  .pf-row-name { font-size: 15px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pf-row-sub { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pf-row-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; align-items: center; }
  #friends-search { width: 100%; max-width: 760px; box-sizing: border-box; }
  #msg-chat-avatar, #msg-chat-name { cursor: pointer; }
  #friends-guest { flex-direction: column; align-items: center; text-align: center; padding: 60px 20px; gap: 10px; }

  @media (max-width: 600px) {
    .pf-row { flex-direction: column; align-items: stretch; }
    .pf-row-actions { justify-content: flex-start; }
    .pf-head { flex-direction: column; align-items: flex-start; }
    .pf-actions { justify-content: flex-start; }
  }`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
})();
