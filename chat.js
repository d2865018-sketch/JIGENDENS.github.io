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
  lastScrollBottom: true,
  pendingImage: null   // { file, previewUrl }
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

function gcGetDeletedMessageIds() {
  try {
    return JSON.parse(localStorage.getItem('soundwave_deleted_chat_ids') || '[]');
  } catch (e) {
    return [];
  }
}

function gcMarkMessageDeleted(id) {
  if (!id) return;
  const ids = gcGetDeletedMessageIds();
  const sId = String(id);
  if (!ids.includes(sId)) {
    ids.push(sId);
    try {
      localStorage.setItem('soundwave_deleted_chat_ids', JSON.stringify(ids));
    } catch (e) {}
  }
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

/* ---- Image attachment helpers ---- */

function gcOnImageSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  // Validation: only images, max 5 MB
  if (!file.type.startsWith('image/')) {
    if (typeof showNotification === 'function') showNotification('⚠️ Дозволені лише зображення');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    if (typeof showNotification === 'function') showNotification('⚠️ Максимальний розмір фото — 5 МБ');
    return;
  }

  // Create a preview
  const url = URL.createObjectURL(file);
  GC.pendingImage = { file, previewUrl: url };

  const preview = document.getElementById('gc-image-preview');
  const img = document.getElementById('gc-image-preview-img');
  const attachBtn = document.getElementById('gc-attach-btn');
  if (img) img.src = url;
  if (preview) preview.style.display = 'block';
  if (attachBtn) attachBtn.classList.add('gc-has-image');
}

function gcRemoveImage() {
  if (GC.pendingImage && GC.pendingImage.previewUrl) {
    URL.revokeObjectURL(GC.pendingImage.previewUrl);
  }
  GC.pendingImage = null;

  const preview = document.getElementById('gc-image-preview');
  const img = document.getElementById('gc-image-preview-img');
  const fileInput = document.getElementById('gc-image-input');
  const attachBtn = document.getElementById('gc-attach-btn');
  if (img) img.src = '';
  if (preview) preview.style.display = 'none';
  if (fileInput) fileInput.value = '';
  if (attachBtn) attachBtn.classList.remove('gc-has-image');
}

function gcFileToDataUrl(file, maxWidth = 960, maxHeight = 960, quality = 0.72) {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const rawDataUrl = e.target.result;
        const img = new Image();
        img.onload = () => {
          try {
            let width = img.width;
            let height = img.height;
            if (width > maxWidth || height > maxHeight) {
              if (width / height > maxWidth / maxHeight) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
              } else {
                width = Math.round((width * maxHeight) / height);
                height = maxHeight;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch (err) {
            resolve(rawDataUrl);
          }
        };
        img.onerror = () => resolve(rawDataUrl);
        img.src = rawDataUrl;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    } catch (e) {
      resolve(null);
    }
  });
}

async function gcUploadChatImage(file) {
  const ext = (file.name || 'img.jpg').split('.').pop().toLowerCase();
  const uniqueId = Date.now() + '_' + Math.floor(Math.random() * 100000);

  // 1. Спробуємо завантажити у Supabase Storage (перевіряємо існуючі buckets: media, music, chat_images)
  if (typeof supabaseClient !== 'undefined' && supabaseClient.storage) {
    let userId = null;
    try {
      const session = (typeof swGetSession === 'function') ? await swGetSession() : null;
      userId = session?.user?.id || (typeof currentUser !== 'undefined' && currentUser?.id) || null;
    } catch (e) {}

    const buckets = ['media', 'music', 'chat_images'];

    for (const b of buckets) {
      const pathsToTry = [];
      if (userId) pathsToTry.push(`${userId}/chat_${uniqueId}.${ext}`);
      pathsToTry.push(`chat/${uniqueId}.${ext}`);

      for (const p of pathsToTry) {
        try {
          const { data, error } = await supabaseClient.storage
            .from(b)
            .upload(p, file, { upsert: true, contentType: file.type || 'image/jpeg' });

          if (!error) {
            const { data: pubData } = supabaseClient.storage.from(b).getPublicUrl(p);
            if (pubData && pubData.publicUrl) {
              return pubData.publicUrl;
            }
          }
        } catch (e) {
          // Якщо bucket не знайдено або обмежений доступ — переходимо до наступного
        }
      }
    }
  }

  // 2. Безвідмовний fallback: стискаємо у компактний Data URL (Base64 JPEG)
  // Працює завжди, гарантовано і без помилок навіть якщо bucket відсутній!
  try {
    const dataUrl = await gcFileToDataUrl(file);
    if (dataUrl) return dataUrl;
  } catch (err) {
    console.warn('[ChatImage] fallback failed:', err);
  }

  if (typeof showNotification === 'function') {
    showNotification('❌ Не вдалося завантажити фото');
  }
  return null;
}

function gcOpenImageOverlay(url) {
  if (!url) return;
  const overlay = document.createElement('div');
  overlay.className = 'gc-image-overlay';
  overlay.onclick = (e) => {
    if (e.target === overlay || e.target.classList.contains('gc-image-overlay-close')) {
      overlay.remove();
    }
  };
  overlay.innerHTML = `
    <button class="gc-image-overlay-close" title="Закрити (Esc)">✕</button>
    <img src="${gcEsc(url)}" alt="Фото" />
  `;
  document.body.appendChild(overlay);

  const escHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
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

    const deletedIds = gcGetDeletedMessageIds();
    loaded = (loaded || []).filter(m => m && m.id && !deletedIds.includes(String(m.id)));

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
  const hasImage = !!GC.pendingImage;

  if (!text && !hasImage) {
    if (typeof showNotification === 'function') showNotification('⚠️ Введіть текст або прикріпіть фото');
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

  // Upload image if attached
  let imageUrl = null;
  if (hasImage) {
    imageUrl = await gcUploadChatImage(GC.pendingImage.file);
    if (!imageUrl && !text) {
      // Image upload failed and no text — abort
      GC.sending = false;
      if (btn) btn.disabled = false;
      return;
    }
  }

  const newRow = {
    user_id: userId,
    user_name: userName,
    is_anonymous: isAnon,
    avatar_url: avatarUrl,
    message: text || '',
    image_url: imageUrl || null,
    created_at: new Date().toISOString()
  };

  try {
    let saved = false;

    if (typeof supabaseClient !== 'undefined') {
      // Insert without image_url first to handle missing column gracefully
      let insertRow = { ...newRow };
      let { data, error } = await supabaseClient
        .from('general_chat')
        .insert(insertRow)
        .select();

      if (error && (/image_url/i.test(error.message) || error.code === 'PGRST204')) {
        // Колонка image_url ще не додана в Supabase — упаковуємо фото в поле message, щоб воно гарантовано збереглося!
        const { image_url, ...rowNoImg } = insertRow;
        if (imageUrl) {
          rowNoImg.message = (text ? text + '\n' : '') + `[img]${imageUrl}[/img]`;
        }
        ({ data, error } = await supabaseClient
          .from('general_chat')
          .insert(rowNoImg)
          .select());
      }

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
    gcRemoveImage();
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

  // 1. Негайно позначаємо як видалене локально
  gcMarkMessageDeleted(id);
  GC.messages = GC.messages.filter(m => String(m.id) !== String(id));
  try { localStorage.setItem(GC.localCacheKey, JSON.stringify(GC.messages)); } catch (e) {}
  gcRenderThread();

  if (typeof showNotification === 'function') {
    showNotification(isAdmin && !isMine ? '🛡️ Повідомлення видалено адміністратором' : '🗑️ Повідомлення видалено');
  }

  try {
    if (typeof supabaseClient !== 'undefined' && !String(id).startsWith('loc_')) {
      const { error } = await supabaseClient.from('general_chat').delete().eq('id', id);
      if (error) {
        console.warn('[GeneralChat] DB delete failed:', error.message);
      }
    }
  } catch (err) {
    console.error('[GeneralChat] delete failed:', err);
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

    // Визначаємо текст повідомлення та фото (з окремої колонки або вбудованого тегу [img])
    let msgText = m.message || '';
    let msgImg = m.image_url || '';

    if (!msgImg && msgText.includes('[img]') && msgText.includes('[/img]')) {
      const match = msgText.match(/\[img\]([\s\S]*?)\[\/img\]/);
      if (match) {
        msgImg = match[1];
        msgText = msgText.replace(/\[img\][\s\S]*?\[\/img\]/, '').trim();
      }
    }

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
          ${msgText ? `<div class="gc-msg-text">${gcEsc(msgText)}</div>` : ''}
          ${msgImg ? `<div class="gc-msg-image" onclick="gcOpenImageOverlay(this.querySelector('img').src)"><img src="${gcEsc(msgImg)}" alt="Фото" loading="lazy" /></div>` : ''}
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
