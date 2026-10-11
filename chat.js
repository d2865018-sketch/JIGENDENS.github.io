/* ========================================
   SoundWave — Загальний чат (General Chat)
   Підтримує відкриті та анонімні пости,
   видалення автором та адміністратором (пароль 1230984576admin)
   ======================================== */

const GC = {
  messages: [],
  channel: null,
  pollTimer: null,
  sending: false,
  setupError: false,
  localCacheKey: 'soundwave_general_chat_cache',
  lastScrollBottom: true
};

function gcEsc(str) {
  if (typeof escapeHtml === 'function') return escapeHtml(String(str == null ? '' : str));
  return String(str == null ? '' : str)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function gcFormatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return timeStr;
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Вчора, ${timeStr}`;
  return `${d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })}, ${timeStr}`;
}

function gcAutoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function gcInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    gcSendMessage();
  }
}

function gcOnAnonToggleChange(isAnon) {
  const hint = document.getElementById('gc-sender-hint');
  const guestBox = document.getElementById('gc-guest-name-box');
  const isLogged = typeof currentUser !== 'undefined' && !!currentUser;

  if (isAnon) {
    if (hint) hint.innerHTML = '<span style="color:#f093fb">👻 Режим анонімності активний</span>';
    if (guestBox) guestBox.style.display = 'none';
  } else {
    if (isLogged) {
      if (hint) hint.textContent = `Від: ${currentUser.name || 'Користувач'}`;
      if (guestBox) guestBox.style.display = 'none';
    } else {
      if (hint) hint.textContent = 'Від свого імені';
      if (guestBox) guestBox.style.display = 'flex';
    }
  }
}

function gcUpdateAdminState() {
  const isAdmin = (typeof isUserAdmin === 'function') && isUserAdmin();
  const pill = document.getElementById('gc-admin-pill');
  if (pill) pill.style.display = isAdmin ? 'inline-flex' : 'none';
  gcRenderThread();
}

async function gcOnSectionOpen() {
  gcUpdateSenderStatus();
  gcUpdateAdminState();
  await gcLoadMessages();
  gcSubscribeRealtime();

  if (GC.pollTimer) clearInterval(GC.pollTimer);
  GC.pollTimer = setInterval(() => {
    if (typeof currentSection !== 'undefined' && currentSection === 'general-chat') {
      gcLoadMessages(true);
    }
  }, 4000);

  setTimeout(gcScrollToBottom, 100);
}

function gcUpdateSenderStatus() {
  const anonToggle = document.getElementById('gc-anon-toggle');
  gcOnAnonToggleChange(anonToggle ? anonToggle.checked : false);
}

function gcSubscribeRealtime() {
  if (typeof supabaseClient === 'undefined' || GC.channel) return;
  try {
    GC.channel = supabaseClient
      .channel('public:general_chat')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'general_chat' }, () => {
        gcLoadMessages(true);
      })
      .subscribe();
  } catch (e) {
    console.warn('[GeneralChat] realtime error:', e);
  }
}

async function gcLoadMessages(silent = false) {
  try {
    let loaded = [];
    let isFromDb = false;

    if (typeof supabaseClient !== 'undefined') {
      const { data, error } = await supabaseClient
        .from('general_chat')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(200);

      if (error) {
        if (/relation|does not exist|schema cache/i.test(error.message)) {
          GC.setupError = true;
          const notice = document.getElementById('gc-setup-notice');
          if (notice) notice.style.display = 'flex';
        }
      } else {
        GC.setupError = false;
        const notice = document.getElementById('gc-setup-notice');
        if (notice) notice.style.display = 'none';
        loaded = data || [];
        isFromDb = true;
        localStorage.setItem(GC.localCacheKey, JSON.stringify(loaded));
      }
    }

    if (!isFromDb) {
      try {
        const cached = localStorage.getItem(GC.localCacheKey);
        if (cached) loaded = JSON.parse(cached);
      } catch (e) {}
    }

    const prevCount = GC.messages.length;
    GC.messages = loaded;
    gcRenderThread();

    if (!silent || loaded.length > prevCount) {
      gcScrollToBottom();
    }
  } catch (err) {
    console.error('[GeneralChat] load error:', err);
  }
}

function gcReloadMessages() {
  const btn = document.querySelector('.gc-action-btn');
  if (btn) btn.classList.add('loading');
  gcLoadMessages().then(() => {
    if (btn) btn.classList.remove('loading');
    if (typeof showNotification === 'function') showNotification('🔄 Чат оновлено');
  });
}

function gcScrollToBottom() {
  const thread = document.getElementById('gc-thread');
  if (thread) {
    thread.scrollTop = thread.scrollHeight;
  }
}

async function gcSendMessage() {
  if (GC.sending) return;

  const input = document.getElementById('gc-input');
  if (!input) return;
  const text = (input.value || '').trim();
  if (!text) {
    if (typeof showNotification === 'function') showNotification('⚠️ Введіть текст повідомлення');
    input.focus();
    return;
  }

  const isAnon = document.getElementById('gc-anon-toggle')?.checked || false;
  const isLogged = typeof currentUser !== 'undefined' && !!currentUser;

  let userName = 'Анонім';
  let userId = null;
  let avatarUrl = null;

  if (isAnon) {
    userName = 'Анонім';
    userId = null;
    avatarUrl = null;
  } else {
    if (isLogged) {
      userName = currentUser.name || 'Користувач';
      userId = currentUser.id || null;
      avatarUrl = currentUser.customAvatar || null;
    } else {
      const guestNameInput = document.getElementById('gc-guest-name-input');
      const gName = (guestNameInput?.value || '').trim();
      if (!gName) {
        if (typeof showNotification === 'function') {
          showNotification('⚠️ Вкажіть ваше ім\'я або оберіть «Анонімно 👻»');
        }
        if (guestNameInput) guestNameInput.focus();
        return;
      }
      userName = gName;
    }
  }

  const btn = document.getElementById('gc-send-btn');
  if (btn) btn.disabled = true;
  GC.sending = true;

  const newRow = {
    user_id: userId,
    user_name: userName,
    is_anonymous: isAnon,
    avatar_url: avatarUrl,
    message: text,
    created_at: new Date().toISOString()
  };

  try {
    let saved = false;

    if (typeof supabaseClient !== 'undefined') {
      const { data, error } = await supabaseClient
        .from('general_chat')
        .insert(newRow)
        .select();

      if (!error && data && data.length) {
        saved = true;
      } else if (error && /relation|does not exist|schema cache/i.test(error.message)) {
        GC.setupError = true;
        const notice = document.getElementById('gc-setup-notice');
        if (notice) notice.style.display = 'flex';
      }
    }

    if (!saved) {
      // Local fallback
      newRow.id = 'loc_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      GC.messages.push(newRow);
      localStorage.setItem(GC.localCacheKey, JSON.stringify(GC.messages));
      gcRenderThread();
      gcScrollToBottom();
    } else {
      await gcLoadMessages(true);
      gcScrollToBottom();
    }

    input.value = '';
    gcAutoGrow(input);
  } catch (err) {
    console.error('[GeneralChat] send failed:', err);
    if (typeof showNotification === 'function') showNotification('❌ Помилка надсилання повідомлення');
  } finally {
    GC.sending = false;
    if (btn) btn.disabled = false;
    input.focus();
  }
}

async function gcDeleteMessage(id) {
  const item = GC.messages.find(m => String(m.id) === String(id));
  if (!item) return;

  const session = (typeof swGetSession === 'function') ? await swGetSession() : null;
  const myId = session ? session.user.id : (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null);
  const isAdmin = (typeof isUserAdmin === 'function') && isUserAdmin();
  const isMine = myId && item.user_id && String(item.user_id) === String(myId);

  if (!isAdmin && !isMine) {
    if (typeof showNotification === 'function') showNotification('❌ У вас немає прав для видалення цього повідомлення');
    return;
  }

  const authorName = item.is_anonymous ? 'Анонім' : (item.user_name || 'Користувач');
  const confirmPrompt = (isAdmin && !isMine)
    ? `Ви дійсно хочете видалити повідомлення від "${authorName}" як адміністратор?`
    : 'Видалити це повідомлення?';

  if (!confirm(confirmPrompt)) return;

  try {
    if (typeof supabaseClient !== 'undefined' && !String(id).startsWith('loc_')) {
      const { error } = await supabaseClient.from('general_chat').delete().eq('id', id);
      if (error) {
        console.warn('[GeneralChat] DB delete failed:', error.message);
      }
    }

    GC.messages = GC.messages.filter(m => String(m.id) !== String(id));
    localStorage.setItem(GC.localCacheKey, JSON.stringify(GC.messages));
    gcRenderThread();

    if (typeof showNotification === 'function') {
      showNotification(isAdmin && !isMine ? '🛡️ Повідомлення видалено адміністратором' : '🗑️ Повідомлення видалено');
    }
  } catch (err) {
    console.error('[GeneralChat] delete failed:', err);
    if (typeof showNotification === 'function') showNotification('❌ Не вдалося видалити повідомлення');
  }
}

function gcRenderThread() {
  const thread = document.getElementById('gc-thread');
  if (!thread) return;

  if (GC.messages.length === 0) {
    thread.innerHTML = `
      <div class="empty-state" style="padding:60px 20px; color:var(--text-muted);">
        <div style="font-size:42px; margin-bottom:12px;">💬</div>
        <h3 style="color:var(--text-primary); font-size:17px; margin-bottom:6px;">Загальний чат порожній</h3>
        <p style="font-size:14px; max-width:340px; margin:0 auto;">Будь першим, хто напише повідомлення! Ти можеш написати від свого імені або повністю анонімно 👻.</p>
      </div>`;
    return;
  }

  const session = (typeof swGetSession === 'function') ? (typeof supabaseClient !== 'undefined' && supabaseClient.auth?.getSession ? null : null) : null;
  const myId = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  const isAdmin = (typeof isUserAdmin === 'function') && isUserAdmin();

  let html = '';
  let lastDateStr = '';

  GC.messages.forEach(m => {
    const d = new Date(m.created_at || Date.now());
    const dateStr = d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
    if (dateStr !== lastDateStr) {
      lastDateStr = dateStr;
      html += `<div class="gc-date-divider"><span>${gcEsc(dateStr)}</span></div>`;
    }

    const isAnon = m.is_anonymous || m.user_name === 'Анонім';
    const isMine = myId && m.user_id && String(m.user_id) === String(myId);
    const canDelete = isMine || isAdmin;

    let avatarHTML = '';
    if (isAnon) {
      avatarHTML = `<div class="gc-msg-avatar gc-msg-avatar--anon" title="Анонімний користувач">👻</div>`;
    } else if (m.avatar_url && /^https?:/i.test(m.avatar_url)) {
      avatarHTML = `<div class="gc-msg-avatar"><img src="${gcEsc(m.avatar_url)}" data-nofb="1" alt="" /></div>`;
    } else {
      const initials = (m.user_name || 'К').slice(0, 2).toUpperCase();
      avatarHTML = `<div class="gc-msg-avatar gc-msg-avatar--user">${gcEsc(initials)}</div>`;
    }

    const authorDisplay = isAnon
      ? `<span class="gc-author-anon">👻 Анонім</span> <span class="gc-tag-anon">Анонімно</span>`
      : (m.user_id && typeof msgOwnerLink === 'function')
        ? `<span class="gc-author-user">${msgOwnerLink(m.user_id, m.user_name)}</span>`
        : `<span class="gc-author-user">👤 ${gcEsc(m.user_name || 'Користувач')}</span>`;

    const deleteBtn = canDelete ? `
      <button class="gc-del-btn ${!isMine && isAdmin ? 'gc-del-btn--admin' : ''}" 
              onclick="gcDeleteMessage('${m.id}')"
              title="${!isMine && isAdmin ? 'Видалити повідомлення як адміністратор' : 'Видалити власне повідомлення'}">
        ${!isMine && isAdmin ? '🛡️ Видалити' : '🗑️'}
      </button>
    ` : '';

    html += `
      <div class="gc-msg-card ${isAnon ? 'gc-msg-card--anon' : ''} ${isMine ? 'gc-msg-card--mine' : ''}">
        ${avatarHTML}
        <div class="gc-msg-body">
          <div class="gc-msg-head">
            <div class="gc-msg-author-row">
              ${authorDisplay}
            </div>
            <div class="gc-msg-meta-row">
              <span class="gc-msg-time">${gcFormatTime(m.created_at)}</span>
              ${deleteBtn}
            </div>
          </div>
          <div class="gc-msg-text">${gcEsc(m.message)}</div>
        </div>
      </div>
    `;
  });

  thread.innerHTML = html;
}

// Автоматична ініціалізація при завантаженні сторінки
document.addEventListener('DOMContentLoaded', () => {
  gcUpdateSenderStatus();
});
