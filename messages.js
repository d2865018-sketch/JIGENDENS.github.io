/* ========================================
   SoundWave — Особисті повідомлення
   Потребує: supabaseClient (auth.js), swGetSession (storage.js),
             escapeHtml / showSection / showNotification (app.js)
   ======================================== */

const MSG = {
  me: null,            // { id, name }
  profiles: {},        // userId -> { id, name, avatar_url }
  convs: {},           // userId -> { id, last, unread }
  activeId: null,      // з ким відкритий чат
  thread: [],          // повідомлення відкритого чату
  channel: null,       // realtime-канал
  pollTimer: null,     // резервне опитування, якщо realtime не працює
  searchTimer: null,
  query: '',
  results: [],
  sending: false,
  setupError: false,   // таблиці ще не створені
};

const MSG_GRADIENTS = [
  'linear-gradient(135deg,#ff6b35,#f7931e)',
  'linear-gradient(135deg,#667eea,#764ba2)',
  'linear-gradient(135deg,#f093fb,#f5576c)',
  'linear-gradient(135deg,#4facfe,#00c6fb)',
  'linear-gradient(135deg,#43e97b,#2bc4a8)',
  'linear-gradient(135deg,#fa709a,#f6b73c)',
];

/* ---------- Допоміжні ---------- */

function msgEsc(v) {
  return (typeof escapeHtml === 'function')
    ? escapeHtml(String(v == null ? '' : v))
    : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function msgEl(id) { return document.getElementById(id); }

function msgGradient(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h + ch.charCodeAt(0)) % 9973;
  return MSG_GRADIENTS[h % MSG_GRADIENTS.length];
}

function msgAvatarHTML(profile, cls = '') {
  const name = (profile && profile.name) || '?';
  const id = (profile && profile.id) || name;
  if (profile && profile.avatar_url && /^https?:/i.test(profile.avatar_url)) {
    return `<div class="msg-avatar ${cls}"><img src="${msgEsc(profile.avatar_url)}" data-nofb="1" alt="" /></div>`;
  }
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  return `<div class="msg-avatar ${cls}" style="background:${msgGradient(id)}">${msgEsc(initials)}</div>`;
}

function msgFormatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

function msgDayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Сьогодні';
  if (d.toDateString() === yesterday.toDateString()) return 'Вчора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function msgPreview(m) {
  const text = (m.body || '').replace(/\s+/g, ' ').trim();
  const short = text.length > 60 ? text.slice(0, 60) + '…' : text;
  return (MSG.me && m.sender_id === MSG.me.id ? 'Ви: ' : '') + short;
}

/* ---------- Кнопки "Написати" для інших розділів ---------- */

// Ім'я автора як посилання (для рядків треків)
function msgOwnerLink(uid, name) {
  const label = `👤 ${msgEsc(name || 'Користувач')}`;
  if (!uid || (MSG.me && MSG.me.id === uid)) return label;
  return `<span class="owner-link" title="Написати повідомлення" data-uid="${msgEsc(uid)}" data-name="${msgEsc(name || '')}" onclick="event.stopPropagation(); msgOpenChatFromBtn(this)">${label}</span>`;
}

// Кнопка "✉️ Написати" (не показується для власних публікацій)
function msgWriteButton(uid, name, cls = 'msg-write-btn') {
  if (!uid || (MSG.me && MSG.me.id === uid)) return '';
  return `<button class="${cls}" data-uid="${msgEsc(uid)}" data-name="${msgEsc(name || '')}" onclick="event.stopPropagation(); msgOpenChatFromBtn(this)">✉️ Написати</button>`;
}

function msgOpenChatFromBtn(btn) {
  msgOpenChat(btn.dataset.uid, btn.dataset.name);
}

/* ---------- Ініціалізація / вихід ---------- */

async function msgUpsertProfile(user) {
  try {
    const session = await swGetSession();
    if (!session || !user) return;
    const avatar = user.customAvatar && /^https?:/i.test(user.customAvatar) ? user.customAvatar : null;
    await supabaseClient.from('profiles').upsert({
      id: session.user.id,
      name: user.name || 'Користувач',
      avatar_url: avatar,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
  } catch (e) {
    console.warn('[Msg] profile upsert failed', e);
  }
}

async function msgInit(user) {
  try {
    const session = await swGetSession();
    if (!session) return;
    msgTeardown();
    MSG.me = { id: session.user.id, name: user.name };
    await msgUpsertProfile(user);
    await msgLoadConversations();
    msgSubscribe();
    MSG.pollTimer = setInterval(msgPoll, 15000);
  } catch (e) {
    console.warn('[Msg] init failed', e);
  }
}

function msgTeardown() {
  if (MSG.channel) {
    try { supabaseClient.removeChannel(MSG.channel); } catch (e) {}
    MSG.channel = null;
  }
  if (MSG.pollTimer) clearInterval(MSG.pollTimer);
  MSG.pollTimer = null;
  MSG.me = null;
  MSG.profiles = {};
  MSG.convs = {};
  MSG.activeId = null;
  MSG.thread = [];
  MSG.query = '';
  MSG.results = [];
  MSG.setupError = false;
  msgUpdateBadge();
  const layout = msgEl('msg-layout');
  if (layout) layout.classList.remove('chat-open');
  const inner = msgEl('msg-chat-inner');
  if (inner) inner.style.display = 'none';
  const empty = msgEl('msg-empty');
  if (empty) empty.style.display = '';
  msgRenderList();
}

function msgSubscribe() {
  if (!MSG.me) return;
  try {
    MSG.channel = supabaseClient
      .channel('dm-' + MSG.me.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${MSG.me.id}` },
        (payload) => msgOnIncoming(payload.new))
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `sender_id=eq.${MSG.me.id}` },
        (payload) => msgOnReadUpdate(payload.new))
      .subscribe();
  } catch (e) {
    console.warn('[Msg] realtime unavailable, using polling', e);
  }
}

// Резервне оновлення (на випадок, якщо realtime недоступний)
async function msgPoll() {
  if (!MSG.me || document.visibilityState !== 'visible') return;
  await msgLoadConversations();
  if (MSG.activeId && typeof currentSection !== 'undefined' && currentSection === 'messages') {
    const before = MSG.thread.length ? MSG.thread[MSG.thread.length - 1].id : null;
    await msgLoadThread(true);
    const after = MSG.thread.length ? MSG.thread[MSG.thread.length - 1].id : null;
    if (before !== after) msgMarkRead(MSG.activeId);
  }
}

/* ---------- Завантаження даних ---------- */

async function msgFetchProfiles(ids) {
  const missing = ids.filter(id => id && !MSG.profiles[id]);
  if (missing.length === 0) return;
  try {
    const { data } = await supabaseClient
      .from('profiles').select('id,name,avatar_url').in('id', missing);
    (data || []).forEach(p => { MSG.profiles[p.id] = p; });
  } catch (e) {
    console.warn('[Msg] profiles load failed', e);
  }
}

async function msgEnsureProfile(id, hint) {
  await msgFetchProfiles([id]);
  if (!MSG.profiles[id]) MSG.profiles[id] = { id, name: hint || 'Користувач', avatar_url: null };
  return MSG.profiles[id];
}

async function msgLoadConversations() {
  if (!MSG.me) return;
  try {
    const me = MSG.me.id;
    const { data, error } = await supabaseClient
      .from('messages')
      .select('id,sender_id,recipient_id,body,created_at,read_at')
      .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      MSG.setupError = /relation|does not exist|schema cache/i.test(error.message);
      console.warn('[Msg] conversations load failed:', error.message);
      msgRenderList();
      return;
    }
    MSG.setupError = false;

    const convs = {};
    for (const m of data) {
      const other = m.sender_id === me ? m.recipient_id : m.sender_id;
      const c = convs[other] || (convs[other] = { id: other, last: m, unread: 0 });
      if (m.recipient_id === me && !m.read_at) c.unread++;
    }
    MSG.convs = convs;
    await msgFetchProfiles(Object.keys(convs));
    msgUpdateBadge();
    msgRenderList();
  } catch (e) {
    console.warn('[Msg] conversations load failed', e);
  }
}

async function msgLoadThread(silent = false) {
  if (!MSG.me || !MSG.activeId) return;
  const me = MSG.me.id, other = MSG.activeId;
  try {
    const { data, error } = await supabaseClient
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${me},recipient_id.eq.${other}),and(sender_id.eq.${other},recipient_id.eq.${me})`)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) { console.warn('[Msg] thread load failed:', error.message); return; }
    if (MSG.activeId !== other) return;   // користувач уже відкрив інший чат
    MSG.thread = (data || []).reverse();
    msgRenderThread(!silent);
  } catch (e) {
    console.warn('[Msg] thread load failed', e);
  }
}

/* ---------- Відкриття / закриття чату ---------- */

async function msgOpenChat(userId, nameHint) {
  if (!MSG.me) {
    if (typeof showNotification === 'function') showNotification('⚠️ Увійди в акаунт, щоб писати повідомлення');
    if (typeof openAuth === 'function') openAuth('login');
    return;
  }
  if (!userId) return;
  if (userId === MSG.me.id) {
    if (typeof showNotification === 'function') showNotification('Це ти 🙂');
    return;
  }

  MSG.activeId = userId;
  MSG.thread = [];
  const profile = await msgEnsureProfile(userId, nameHint);

  showSection('messages', msgEl('nav-messages'));

  msgEl('msg-layout').classList.add('chat-open');
  msgEl('msg-empty').style.display = 'none';
  msgEl('msg-chat-inner').style.display = 'flex';
  msgEl('msg-chat-name').textContent = profile.name;
  msgEl('msg-chat-avatar').innerHTML = msgAvatarHTML(profile);
  msgEl('msg-thread').innerHTML = '<div class="msg-thread-hint">Завантаження...</div>';

  await msgLoadThread();
  await msgMarkRead(userId);
  msgRenderList();

  const input = msgEl('msg-input');
  if (input) input.focus();
}

function msgCloseChat() {
  MSG.activeId = null;
  msgEl('msg-layout').classList.remove('chat-open');
  msgEl('msg-chat-inner').style.display = 'none';
  msgEl('msg-empty').style.display = '';
  msgRenderList();
}

// Викликається з showSection('messages')
function msgOnSectionOpen() {
  const guest = msgEl('msg-guest');
  const layout = msgEl('msg-layout');
  if (!guest || !layout) return;
  if (!MSG.me) {
    guest.style.display = 'flex';
    layout.style.display = 'none';
    return;
  }
  guest.style.display = 'none';
  layout.style.display = '';
  msgLoadConversations();
  if (MSG.activeId) {
    msgLoadThread();
    msgMarkRead(MSG.activeId);
  }
}

/* ---------- Надсилання ---------- */

async function msgSend() {
  if (MSG.sending || !MSG.me || !MSG.activeId) return;
  const input = msgEl('msg-input');
  const body = input.value.trim();
  if (!body) return;

  MSG.sending = true;
  const btn = msgEl('msg-send-btn');
  if (btn) btn.disabled = true;

  try {
    const { data, error } = await supabaseClient
      .from('messages')
      .insert({ sender_id: MSG.me.id, recipient_id: MSG.activeId, body })
      .select()
      .single();

    if (error) {
      if (typeof showNotification === 'function') showNotification('❌ Не вдалося надіслати: ' + error.message);
      return;
    }

    input.value = '';
    msgAutoGrow(input);
    if (!MSG.thread.some(x => x.id === data.id)) MSG.thread.push(data);
    MSG.convs[MSG.activeId] = { id: MSG.activeId, last: data, unread: 0 };
    msgRenderThread(true);
    msgRenderList();
  } catch (e) {
    console.warn('[Msg] send failed', e);
    if (typeof showNotification === 'function') showNotification('❌ Немає зв’язку з сервером');
  } finally {
    MSG.sending = false;
    if (btn) btn.disabled = false;
    input.focus();
  }
}

function msgInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    msgSend();
  }
}

function msgAutoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

/* ---------- Вхідні події ---------- */

async function msgOnIncoming(m) {
  if (!MSG.me || !m || m.recipient_id !== MSG.me.id) return;
  const other = m.sender_id;
  const profile = await msgEnsureProfile(other);

  const conv = MSG.convs[other] || (MSG.convs[other] = { id: other, last: m, unread: 0 });
  conv.last = m;

  if (MSG.activeId === other) {
    if (!MSG.thread.some(x => x.id === m.id)) MSG.thread.push(m);
    msgRenderThread(true);
  }

  const viewing = MSG.activeId === other
    && typeof currentSection !== 'undefined' && currentSection === 'messages'
    && document.visibilityState === 'visible';

  if (viewing) {
    msgMarkRead(other);
  } else {
    conv.unread++;
    if (typeof showNotification === 'function') {
      showNotification(`💬 ${profile.name}: ${msgPreview(m).slice(0, 50)}`);
    }
  }
  msgUpdateBadge();
  msgRenderList();
}

function msgOnReadUpdate(m) {
  if (!m) return;
  const t = MSG.thread.find(x => x.id === m.id);
  if (t) {
    t.read_at = m.read_at;
    msgRenderThread(false);
  }
}

async function msgMarkRead(otherId) {
  if (!MSG.me) return;
  const me = MSG.me.id;
  const conv = MSG.convs[otherId];
  const hadUnread = (conv && conv.unread > 0)
    || MSG.thread.some(m => m.recipient_id === me && m.sender_id === otherId && !m.read_at);
  if (!hadUnread) return;

  const now = new Date().toISOString();
  if (conv) conv.unread = 0;
  MSG.thread.forEach(m => { if (m.recipient_id === me && m.sender_id === otherId && !m.read_at) m.read_at = now; });
  msgUpdateBadge();
  msgRenderList();

  try {
    await supabaseClient.from('messages')
      .update({ read_at: now })
      .eq('recipient_id', me).eq('sender_id', otherId).is('read_at', null);
  } catch (e) {
    console.warn('[Msg] mark read failed', e);
  }
}

/* ---------- Пошук користувачів ---------- */

function msgOnSearch(value) {
  MSG.query = (value || '').trim();
  clearTimeout(MSG.searchTimer);
  if (MSG.query.length < 2) {
    MSG.results = [];
    msgRenderList();
    return;
  }
  MSG.searchTimer = setTimeout(async () => {
    if (!MSG.me) return;
    const q = MSG.query.replace(/[%_,()]/g, '');
    try {
      const { data } = await supabaseClient
        .from('profiles').select('id,name,avatar_url')
        .ilike('name', `%${q}%`)
        .neq('id', MSG.me.id)
        .limit(15);
      MSG.results = data || [];
      (data || []).forEach(p => { MSG.profiles[p.id] = p; });
    } catch (e) {
      MSG.results = [];
    }
    msgRenderList();
  }, 300);
}

function msgPickResult(id) {
  const p = MSG.profiles[id];
  const input = msgEl('msg-search');
  if (input) input.value = '';
  MSG.query = '';
  MSG.results = [];
  msgOpenChat(id, p && p.name);
}

/* ---------- Відображення ---------- */

function msgUpdateBadge() {
  const total = Object.values(MSG.convs).reduce((s, c) => s + (c.unread || 0), 0);
  const badge = msgEl('msg-badge');
  if (!badge) return;
  badge.textContent = total > 99 ? '99+' : String(total);
  badge.style.display = total > 0 ? 'inline-flex' : 'none';
}

function msgRenderList() {
  const el = msgEl('msg-conv-list');
  if (!el) return;

  if (!MSG.me) { el.innerHTML = ''; return; }

  if (MSG.setupError) {
    el.innerHTML = `<div class="msg-list-hint">⚠️ Чат ще не налаштований у базі даних.<br>Виконай <b>supabase_messages.sql</b> у Supabase.</div>`;
    return;
  }

  // Режим пошуку
  if (MSG.query.length >= 2) {
    if (MSG.results.length === 0) {
      el.innerHTML = `<div class="msg-list-hint">Нікого не знайдено</div>`;
      return;
    }
    el.innerHTML = MSG.results.map(p => `
      <div class="msg-conv" onclick="msgPickResult('${msgEsc(p.id)}')">
        ${msgAvatarHTML(p)}
        <div class="msg-conv-body">
          <div class="msg-conv-name">${msgEsc(p.name)}</div>
          <div class="msg-conv-last">Почати розмову</div>
        </div>
      </div>`).join('');
    return;
  }

  const list = Object.values(MSG.convs)
    .sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));

  if (list.length === 0) {
    el.innerHTML = `<div class="msg-list-hint">Поки що немає розмов.<br>Знайди користувача за іменем або натисни «✉️ Написати» у розділі «Спільнота».</div>`;
    return;
  }

  el.innerHTML = list.map(c => {
    const p = MSG.profiles[c.id] || { id: c.id, name: 'Користувач' };
    return `
      <div class="msg-conv ${MSG.activeId === c.id ? 'active' : ''}" onclick="msgOpenChat('${msgEsc(c.id)}', '${msgEsc(p.name).replace(/'/g, '&#39;')}')">
        ${msgAvatarHTML(p)}
        <div class="msg-conv-body">
          <div class="msg-conv-top">
            <span class="msg-conv-name">${msgEsc(p.name)}</span>
            <span class="msg-conv-time">${msgFormatTime(c.last.created_at)}</span>
          </div>
          <div class="msg-conv-bottom">
            <span class="msg-conv-last">${msgEsc(msgPreview(c.last))}</span>
            ${c.unread > 0 ? `<span class="msg-unread">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

function msgRenderThread(scrollBottom = true) {
  const el = msgEl('msg-thread');
  if (!el || !MSG.me) return;

  if (MSG.thread.length === 0) {
    el.innerHTML = '<div class="msg-thread-hint">Напиши перше повідомлення 👋</div>';
    return;
  }

  const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  let html = '';
  let lastDay = '';
  for (const m of MSG.thread) {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) {
      html += `<div class="msg-day">${msgDayLabel(m.created_at)}</div>`;
      lastDay = day;
    }
    const mine = m.sender_id === MSG.me.id;
    const time = new Date(m.created_at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    html += `
      <div class="msg-row ${mine ? 'mine' : 'theirs'}">
        <div class="msg-bubble">
          <div class="msg-text">${msgEsc(m.body)}</div>
          <div class="msg-meta">${time}${mine ? `<span class="msg-tick ${m.read_at ? 'read' : ''}">${m.read_at ? '✓✓' : '✓'}</span>` : ''}</div>
        </div>
      </div>`;
  }
  el.innerHTML = html;
  if (scrollBottom || wasNearBottom) el.scrollTop = el.scrollHeight;
}

// Повернувся на вкладку з відкритим чатом — позначаємо повідомлення прочитаними
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (MSG.me && MSG.activeId && typeof currentSection !== 'undefined' && currentSection === 'messages') {
    msgMarkRead(MSG.activeId);
  }
});
