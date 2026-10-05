/* ========================================
   SoundWave — Auth JavaScript
   ======================================== */

// ===== CONSTANTS =====
const SUPABASE_URL = 'https://mdadbmwwnjukjtqdpyba.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oOr3E-QWA_R5orAPnTu-Fg_bIj0UWff';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Avatar gradient colors per user index
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #ff6b35, #f7931e)',
  'linear-gradient(135deg, #667eea, #764ba2)',
  'linear-gradient(135deg, #f093fb, #f5576c)',
  'linear-gradient(135deg, #4facfe, #00f2fe)',
  'linear-gradient(135deg, #43e97b, #38f9d7)',
  'linear-gradient(135deg, #fa709a, #fee140)',
];

// ===== STATE =====
let currentUser = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  checkSession();
  setupPasswordStrength();
  setupOverlayClose();
  
  // Profile Modal Tabs Logic
  document.querySelectorAll('.profile-sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.profile-sidebar-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
  });

  document.querySelectorAll('.profile-widget-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.profile-widget-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
});

// ===== SESSION =====
async function checkSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    const u = session.user;
    const userData = {
      id: u.id,
      email: u.email,
      name: u.user_metadata?.name || 'Користувач',
      avatarIdx: u.user_metadata?.avatarIdx || 0,
      customAvatar: u.user_metadata?.customAvatar || null,
      customBanner: u.user_metadata?.customBanner || null,
      bio: u.user_metadata?.bio || '',
      favGenre: u.user_metadata?.favGenre || '',
      topTrack: u.user_metadata?.topTrack || '',
      created_at: u.created_at
    };
    loginSuccess(userData, false);
  } else {
    setTimeout(openAuth, 500);
    updateTopbarGuest();
  }

  // Listen for auth state changes
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      handleLogoutLocal();
    } else if (event === 'PASSWORD_RECOVERY') {
      switchTab('new-password');
      document.getElementById('auth-overlay').classList.add('open');
    }
  });
}

// ===== MODAL OPEN/CLOSE =====
function openAuth(tab = 'login') {
  switchTab(tab);
  document.getElementById('auth-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeAuth() {
  document.getElementById('auth-overlay').classList.remove('open');
  document.body.style.overflow = '';
  clearErrors();
}

function setupOverlayClose() {
  const overlay = document.getElementById('auth-overlay');
  overlay.addEventListener('click', e => {
    if (e.target === overlay && currentUser) closeAuth();
  });
}

// ===== TABS =====
function switchTab(tab) {
  const isLogin = tab === 'login';
  const isRegister = tab === 'register';
  const isVerify = tab === 'verify';
  const isForgot = tab === 'forgot';
  const isForgotVerify = tab === 'forgot-verify';
  const isNewPassword = tab === 'new-password';

  document.getElementById('tab-login').classList.toggle('active', isLogin || isForgot || isForgotVerify || isNewPassword);
  document.getElementById('tab-register').classList.toggle('active', isRegister || isVerify); // Keep register tab active visually during verify
  
  document.getElementById('form-login').classList.toggle('active', isLogin);
  document.getElementById('form-register').classList.toggle('active', isRegister);
  
  const formVerify = document.getElementById('form-verify');
  if (formVerify) formVerify.classList.toggle('active', isVerify);

  const formForgot = document.getElementById('form-forgot');
  if (formForgot) formForgot.classList.toggle('active', isForgot);

  const formForgotVerify = document.getElementById('form-forgot-verify');
  if (formForgotVerify) formForgotVerify.classList.toggle('active', isForgotVerify);

  const formNewPassword = document.getElementById('form-new-password');
  if (formNewPassword) formNewPassword.classList.toggle('active', isNewPassword);

  clearErrors();

  // Focus first input
  setTimeout(() => {
    let input = null;
    if (isLogin) {
      const emailInput = document.getElementById('login-email');
      const lastEmail = localStorage.getItem('sw_last_email');
      if (lastEmail) {
        emailInput.value = lastEmail;
        input = document.getElementById('login-password');
      } else {
        input = emailInput;
      }
    }
    else if (isRegister) input = document.getElementById('reg-name');
    else if (isVerify) input = document.getElementById('reg-code');
    else if (isForgot) input = document.getElementById('forgot-email');
    else if (isForgotVerify) input = document.getElementById('forgot-code');
    else if (isNewPassword) input = document.getElementById('new-password');
    if (input) input.focus();
  }, 100);
}

async function handleRegister(e) {
  e.preventDefault();
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim().toLowerCase();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;
  const errEl    = document.getElementById('reg-error');
  const btn      = document.getElementById('reg-submit');

  clearErrors();

  if (name.length < 2) return showError(errEl, "Ім'я повинно містити мінімум 2 символи");
  if (!isValidEmail(email)) return showError(errEl, 'Введи коректний email');
  if (password.length < 6) return showError(errEl, 'Пароль повинен містити мінімум 6 символів');
  if (password !== password2) return showError(errEl, 'Паролі не співпадають');

  btn.classList.add('loading');
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: name,
        avatarIdx: Math.floor(Math.random() * AVATAR_GRADIENTS.length)
      }
    }
  });
  btn.classList.remove('loading');

  if (error) {
    return showError(errEl, `Помилка: ${error.message}`);
  }

  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return showError(errEl, 'Цей email вже зареєстровано.');
  }

  showSuccess('form-register', `Акаунт створено! 🎉`);
  setTimeout(() => {
    checkSession();
  }, 1400);
}

function verifyRegistrationCode(e) {
  e.preventDefault();
}

async function handleForgot(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim().toLowerCase();
  const errEl = document.getElementById('forgot-error');
  const btn = document.getElementById('forgot-submit');

  clearErrors();
  if (!isValidEmail(email)) return showError(errEl, 'Введи коректний email');

  btn.classList.add('loading');
  const { data, error } = await supabaseClient.auth.resetPasswordForEmail(email);
  btn.classList.remove('loading');

  if (error) {
    return showError(errEl, `Помилка: ${error.message}`);
  }

  showSuccess('form-forgot', `Посилання на відновлення відправлено на пошту!`);
  setTimeout(() => {
    openAuth('login');
  }, 2500);
}

function verifyForgotCode(e) {
  e.preventDefault();
}

async function handleNewPassword(e) {
  e.preventDefault();
  const newPass = document.getElementById('new-password').value;
  const errEl = document.getElementById('new-password-error');
  const btn = document.getElementById('new-password-submit');

  clearErrors();
  if (newPass.length < 6) return showError(errEl, 'Пароль повинен містити мінімум 6 символів');

  btn.classList.add('loading');
  const { data, error } = await supabaseClient.auth.updateUser({ password: newPass });
  btn.classList.remove('loading');

  if (error) {
    return showError(errEl, `Помилка: ${error.message}`);
  }

  showSuccess('form-new-password', 'Пароль успішно змінено! 🎉');
  setTimeout(() => {
    openAuth('login');
  }, 1500);
}

// ===== LOGIN =====
async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-submit');

  clearErrors();
  if (!email || !password) return showError(errEl, 'Заповни всі поля');

  btn.classList.add('loading');
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });
  btn.classList.remove('loading');

  if (error) {
    showError(errEl, 'Неправильний email або пароль');
    shakeModal();
    return;
  }

  const u = data.user;
  const userData = {
    id: u.id,
    email: u.email,
    name: u.user_metadata?.name || 'Користувач',
    avatarIdx: u.user_metadata?.avatarIdx || 0,
    customAvatar: u.user_metadata?.customAvatar || null,
    customBanner: u.user_metadata?.customBanner || null,
    bio: u.user_metadata?.bio || '',
    favGenre: u.user_metadata?.favGenre || '',
    topTrack: u.user_metadata?.topTrack || '',
    created_at: u.created_at
  };

  showSuccess('form-login', `З поверненням! 🎵`);
  setTimeout(() => {
    loginSuccess(userData, true);
  }, 1200);
}

// ===== LEGACY AVATAR MIGRATION =====
// Раніше аватар зберігався в метаданих акаунта як величезний base64.
// Він потрапляв у JWT і викликав ERR_CONNECTION_RESET. Тепер зберігаємо лише URL.
async function migrateLegacyAvatar(user) {
  try {
    if (!user || !user.customAvatar || !user.customAvatar.startsWith('data:')) return;
    const url = await uploadAvatarToStorage(user.customAvatar);
    if (!url) throw new Error('avatar upload failed');
    const { error } = await supabaseClient.auth.updateUser({ data: { customAvatar: url } });
    if (error) throw error;
    await supabaseClient.auth.refreshSession();   // новий, малий токен
    user.customAvatar = url;
    updateTopbarLoggedIn(user);
    console.info('[Avatar] перенесено в Storage');
  } catch (e) {
    console.warn('[Avatar] міграція не вдалась', e);
    if (typeof showNotification === 'function') {
      showNotification('⚠️ Не вдалося оновити аватар — завантаж його заново в профілі');
    }
  }
}

// ===== LOGIN SUCCESS =====
async function loginSuccess(user, showNotif = true) {
  currentUser = user;
  localStorage.setItem('sw_last_email', user.email);
  closeAuth();
  updateTopbarLoggedIn(user);

  // Старий аватар у base64 роздуває токен і ламає запити — переносимо його в Storage
  migrateLegacyAvatar(user);

  // Особисті повідомлення: профіль, розмови, realtime
  if (typeof msgInit === 'function') msgInit(user);

  // Restore liked tracks saved for this account
  if (typeof loadLiked === 'function') {
    loadLiked(user.email);
  }

  // Restore playlists saved for this account
  if (typeof loadPlaylists === 'function') {
    loadPlaylists(user.email);
  }

  // Restore user-uploaded tracks from IndexedDB
  if (typeof swLoadTracks === 'function') {
    const restored = await swLoadTracks(user.email);
    if (restored.length > 0) {
      userTracks = restored;
      // Re-load likes so user tracks get their heart state
      if (typeof loadLiked === 'function') loadLiked(user.email);
      if (typeof renderLibraryList  === 'function') renderLibraryList();
      if (typeof updateQueueList    === 'function') updateQueueList();
      if (typeof renderTrendingGrid === 'function') renderTrendingGrid();
    }
  }

  if (showNotif && typeof showNotification === 'function') {
    showNotification(`👋 Привіт, ${user.name}!`);
  }
  // Update greeting
  const h1 = document.querySelector('#section-home .section-header h1');
  if (h1) h1.textContent = `Привіт, ${user.name}! 👋`;
}

// ===== LOGOUT =====
async function handleLogout() {
  await supabaseClient.auth.signOut();
  handleLogoutLocal();
}

function handleLogoutLocal() {
  // Stop music and clear queue
  if (typeof audio !== 'undefined' && audio) {
    audio.pause();
    queue = [];
    currentTrackIndex = -1;
    const pt = document.getElementById('player-title');
    if (pt) pt.textContent = 'Трек не вибрано';
    const pa = document.getElementById('player-artist');
    if (pa) pa.textContent = 'Виконавець';
    const pc = document.getElementById('player-cover');
    if (pc) pc.src = 'https://ui-avatars.com/api/?name=Music&background=2a2a35&color=fff&size=120';
    const pb = document.getElementById('play-btn');
    if (pb) pb.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M5 3l14 9-14 9V3z"/></svg>`;
  }

  // Revoke blob URLs and clear user tracks
  if (typeof userTracks !== 'undefined') {
    userTracks.forEach(t => { if (t.src && t.src.startsWith('blob:')) URL.revokeObjectURL(t.src); });
    userTracks = [];
    if (typeof renderLibraryList === 'function') renderLibraryList();
    if (typeof updateQueueList   === 'function') updateQueueList();
  }

  if (typeof msgTeardown === 'function') msgTeardown();

  currentUser = null;
  closeDropdown();

  // Clear liked state for guest
  if (typeof loadLiked === 'function') loadLiked(null);
  // Reset playlists to guest
  if (typeof loadPlaylists === 'function') loadPlaylists(null);


  updateTopbarGuest();
  const h1 = document.querySelector('#section-home .section-header h1');
  if (h1) h1.textContent = 'Привіт! 👋';
  if (typeof showNotification === 'function') {
    showNotification('👋 До побачення!');
  }
  setTimeout(() => openAuth('login'), 800);
}

// ===== TOPBAR UPDATE =====
function updateTopbarLoggedIn(user) {
  const av = document.getElementById('user-avatar');
  if (!av) return;
  const initials = user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  
  if (user.customAvatar) {
    av.innerHTML = `<img src="${user.customAvatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" />`;
    av.style.background = 'transparent';
  } else {
    av.innerHTML = initials;
    av.style.background = AVATAR_GRADIENTS[user.avatarIdx || 0];
  }
  
  av.classList.add('logged-in');
  av.onclick = toggleDropdown;
  av.title = user.name;

  // Remove guest login button if present
  const loginBtn = document.getElementById('guest-login-btn');
  if (loginBtn) loginBtn.remove();

  // Update dropdown header
  const header = document.getElementById('dropdown-header');
  if (header) {
    let avatarHTML = '';
    if (user.customAvatar) {
      avatarHTML = `<div class="dropdown-avatar" style="background:transparent"><img src="${user.customAvatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" /></div>`;
    } else {
      avatarHTML = `<div class="dropdown-avatar" style="background:${AVATAR_GRADIENTS[user.avatarIdx || 0]}">${initials}</div>`;
    }
    
    header.innerHTML = `
      ${avatarHTML}
      <div class="dropdown-user-info">
        <div class="dropdown-name">${escapeHtmlAuth(user.name)}</div>
        <div class="dropdown-email">${escapeHtmlAuth(user.email)}</div>
      </div>
    `;
  }
}

function updateTopbarGuest() {
  const av = document.getElementById('user-avatar');
  if (!av) return;
  av.textContent = '?';
  av.style.background = 'var(--bg-elevated)';
  av.classList.remove('logged-in');
  av.onclick = () => openAuth('login');
  av.title = 'Увійти';

  // Add guest login button
  let btn = document.getElementById('guest-login-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'guest-login-btn';
    btn.className = 'login-btn';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
        <polyline points="10 17 15 12 10 7"/>
        <line x1="15" y1="12" x2="3" y2="12"/>
      </svg>
      Увійти
    `;
    btn.onclick = () => openAuth('login');
    const topbarRight = document.querySelector('.topbar-right');
    if (topbarRight) topbarRight.insertBefore(btn, av);
  }
}

// ===== DROPDOWN =====
function toggleDropdown() {
  if (!currentUser) { openAuth('login'); return; }
  document.getElementById('user-dropdown').classList.toggle('open');
}

function closeDropdown() {
  document.getElementById('user-dropdown').classList.remove('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  const dropdown = document.getElementById('user-dropdown');
  const avatar = document.getElementById('user-avatar');
  if (dropdown && !dropdown.contains(e.target) && avatar && !avatar.contains(e.target)) {
    closeDropdown();
  }
});

// ===== PROFILE EDIT =====
let tempAvatarBase64 = null;
let tempBannerBase64 = null;

function openProfileEdit() {
  closeDropdown();
  if (!currentUser) return;
  
  const nameInput = document.getElementById('profile-name-input');
  if (nameInput) nameInput.value = currentUser.name || '';
  
  const bioInput = document.getElementById('profile-bio-input');
  if (bioInput) bioInput.value = currentUser.bio || '';
  
  const favGenreInput = document.getElementById('profile-fav-genre-input');
  if (favGenreInput) favGenreInput.value = currentUser.favGenre || '';
  
  const topTrackSelect = document.getElementById('profile-top-track-select');
  if (topTrackSelect) {
    topTrackSelect.innerHTML = '<option value="">Не вибрано</option>';
    if (typeof getAllTracks === 'function' && typeof likedIds !== 'undefined') {
      const all = getAllTracks();
      const liked = all.filter(t => likedIds.has(t.id) || likedIds.has(String(t.id)) || likedIds.has(Number(t.id)));
      liked.forEach(t => {
        const opt = document.createElement('option');
        opt.value = String(t.id);
        opt.textContent = `${t.artist} - ${t.title}`;
        if (currentUser.topTrack === String(t.id)) opt.selected = true;
        topTrackSelect.appendChild(opt);
      });
    }
    if (typeof updateProfileTopTrackPreview === 'function') {
      updateProfileTopTrackPreview();
    }
  }
  
  const joinedEl = document.getElementById('profile-joined-date');
  if (joinedEl && currentUser.created_at) {
    const d = new Date(currentUser.created_at);
    joinedEl.textContent = `У числі учасників з ${d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  
  tempAvatarBase64 = currentUser.customAvatar || null;
  tempBannerBase64 = currentUser.customBanner || null;
  
  updateProfileModalAvatar();
  updateProfileModalBanner();
  
  document.getElementById('profile-edit-overlay').classList.add('open');
}

function closeProfileEdit() {
  document.getElementById('profile-edit-overlay').classList.remove('open');
  tempAvatarBase64 = null;
  tempBannerBase64 = null;
  document.getElementById('profile-avatar-file').value = '';
  document.getElementById('profile-banner-file').value = '';
}

function handleAvatarUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      tempAvatarBase64 = canvas.toDataURL('image/jpeg', 0.85);
      updateProfileModalAvatar();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function handleBannerUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 280;
      const ctx = canvas.getContext('2d');
      const ratio = Math.max(800 / img.width, 280 / img.height);
      const w = img.width * ratio, h = img.height * ratio;
      ctx.drawImage(img, (800 - w) / 2, (280 - h) / 2, w, h);
      tempBannerBase64 = canvas.toDataURL('image/jpeg', 0.85);
      updateProfileModalBanner();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function uploadImageToStorage(dataUrl, filename) {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${session.user.id}/${filename}`;
    const { error } = await supabaseClient.storage
      .from('music')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (error) return null;
    const { data } = supabaseClient.storage.from('music').getPublicUrl(path);
    return data.publicUrl + '?v=' + Date.now();
  } catch (e) {
    return null;
  }
}

async function uploadAvatarToStorage(dataUrl) {
  return uploadImageToStorage(dataUrl, 'avatar.jpg');
}

async function uploadBannerToStorage(dataUrl) {
  return uploadImageToStorage(dataUrl, 'banner.jpg');
}

function updateProfileModalAvatar() {
  const avatarEl = document.getElementById('profile-edit-avatar');
  if (!avatarEl) return;
  
  if (tempAvatarBase64) {
    avatarEl.innerHTML = ``;
    avatarEl.style.backgroundImage = `url('${tempAvatarBase64}')`;
    avatarEl.style.backgroundColor = 'transparent';
  } else {
    const initials = currentUser.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    avatarEl.innerHTML = initials;
    avatarEl.style.backgroundImage = 'none';
    avatarEl.style.backgroundColor = AVATAR_GRADIENTS[currentUser.avatarIdx || 0];
  }
}

function updateProfileModalBanner() {
  const bannerEl = document.getElementById('profile-card-banner');
  if (!bannerEl) return;
  if (tempBannerBase64) {
    bannerEl.style.backgroundImage = `url('${tempBannerBase64}')`;
  } else {
    bannerEl.style.backgroundImage = 'none';
  }
}

async function saveProfileEdit() {
  if (!currentUser) return;
  
  const nameInput = document.getElementById('profile-name-input');
  const bioInput = document.getElementById('profile-bio-input');
  const favGenreInput = document.getElementById('profile-fav-genre-input');
  const topTrackInput = document.getElementById('profile-top-track-select');
  
  const newName = nameInput.value.trim();
  const newBio = bioInput ? bioInput.value.trim() : '';
  const newFavGenre = favGenreInput ? favGenreInput.value.trim() : '';
  const newTopTrack = topTrackInput ? topTrackInput.value.trim() : '';
  
  if (newName.length < 2) {
    nameInput.style.borderColor = '#e05574';
    setTimeout(() => nameInput.style.borderColor = '', 1500);
    return;
  }
  
  const btn = document.querySelector('.profile-save-btn');
  if (btn) btn.textContent = 'Збереження...';
  
  let avatarValue = tempAvatarBase64;
  if (avatarValue && avatarValue.startsWith('data:')) {
    avatarValue = await uploadAvatarToStorage(avatarValue);
  }
  
  let bannerValue = tempBannerBase64;
  if (bannerValue && bannerValue.startsWith('data:')) {
    bannerValue = await uploadBannerToStorage(bannerValue);
  }

  const { data, error } = await supabaseClient.auth.updateUser({
    data: {
      name: newName,
      bio: newBio,
      favGenre: newFavGenre,
      topTrack: newTopTrack,
      customAvatar: avatarValue,
      customBanner: bannerValue
    }
  });

  if (!error) {
    currentUser.name = newName;
    currentUser.bio = newBio;
    currentUser.favGenre = newFavGenre;
    currentUser.topTrack = newTopTrack;
    currentUser.customAvatar = avatarValue;
    currentUser.customBanner = bannerValue;
    if (typeof msgUpsertProfile === 'function') msgUpsertProfile(currentUser);
    updateTopbarLoggedIn(currentUser);
    if (typeof showNotification === 'function') {
      showNotification(`✅ Профіль оновлено`);
    }
  }
  
  if (btn) btn.textContent = 'Зберегти зміни';
  closeProfileEdit();
}

function playProfileTopTrack() {
  const select = document.getElementById('profile-top-track-select');
  if (!select || !select.value) return;
  const trackId = select.value;
  if (typeof getAllTracks === 'function') {
    const all = getAllTracks();
    const idx = all.findIndex(t => String(t.id) === trackId);
    if (idx !== -1) {
      if (typeof currentTrackIndex !== 'undefined' && currentTrackIndex === idx) {
        if (typeof togglePlay === 'function') togglePlay();
      } else if (typeof playTrackByGlobalIndex === 'function') {
        playTrackByGlobalIndex(idx);
        // Turn on repeat so the track loops
        const repeatBtn = document.getElementById('repeat-btn');
        if (repeatBtn && !repeatBtn.classList.contains('active')) {
          if (typeof toggleRepeat === 'function') toggleRepeat();
        }
      }
    }
  }
}

function updateProfileTopTrackPreview() {
  const select = document.getElementById('profile-top-track-select');
  const preview = document.getElementById('profile-top-track-preview');
  const img = document.getElementById('profile-top-track-img');
  const title = document.getElementById('profile-top-track-title');
  const artist = document.getElementById('profile-top-track-artist');
  
  if (!select || !preview) return;
  
  const trackId = select.value;
  if (!trackId) {
    preview.style.display = 'none';
    return;
  }
  
  if (typeof getAllTracks === 'function') {
    const track = getAllTracks().find(t => String(t.id) === trackId);
    if (track) {
      preview.style.display = 'flex';
      img.src = track.cover || 'assets/default-cover.png';
      title.textContent = track.title || 'Невідомий трек';
      artist.textContent = track.artist || 'Невідомий виконавець';
    } else {
      preview.style.display = 'none';
    }
  }
}

// ===== PASSWORD VISIBILITY =====
function togglePassVis(inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.innerHTML = isHidden
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
      </svg>`;
}

// ===== PASSWORD STRENGTH =====
function setupPasswordStrength() {
  const input = document.getElementById('reg-password');
  if (!input) return;
  input.addEventListener('input', () => {
    const val = input.value;
    const { score, label, color } = getPasswordStrength(val);
    const bar = document.getElementById('pass-strength-bar');
    const lbl = document.getElementById('pass-strength-label');
    if (bar) {
      bar.style.width = (score * 25) + '%';
      bar.style.background = color;
    }
    if (lbl) {
      lbl.textContent = val.length > 0 ? label : '';
      lbl.style.color = color;
    }
  });
}

function getPasswordStrength(pass) {
  let score = 0;
  if (pass.length >= 6)  score++;
  if (pass.length >= 10) score++;
  if (/[A-Z]/.test(pass)) score++;
  if (/[0-9]/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;

  const levels = [
    { score: 0, label: '',           color: 'transparent' },
    { score: 1, label: 'Слабкий',    color: '#e05574' },
    { score: 2, label: 'Слабкий',    color: '#e05574' },
    { score: 3, label: 'Середній',   color: '#f7931e' },
    { score: 4, label: 'Сильний',    color: '#43e97b' },
    { score: 5, label: 'Дуже сильний', color: '#43e97b' },
  ];
  return levels[Math.min(score, 5)];
}

// ===== SUCCESS ANIMATION =====
function showSuccess(formId, message) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.innerHTML = `
    <div class="auth-success">
      <div class="auth-success-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" width="28" height="28">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <h3>${message}</h3>
      <p>Зачекай секунду...</p>
    </div>
  `;
}

// ===== ERRORS =====
function showError(el, msg) {
  el.textContent = msg;
  el.classList.add('show');
}

function clearErrors() {
  document.querySelectorAll('.auth-error').forEach(el => {
    el.classList.remove('show');
    el.textContent = '';
  });
}

function shakeModal() {
  const modal = document.getElementById('auth-modal');
  modal.style.animation = 'none';
  modal.offsetHeight; // reflow
  modal.style.animation = 'modalShake 0.4s ease';
  setTimeout(() => modal.style.animation = '', 400);
}

// ===== UTILS =====
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Very simple hash for demo (NOT secure for production!) */
function hashPassword(pass) {
  let hash = 0;
  for (let i = 0; i < pass.length; i++) {
    const chr = pass.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return 'sw_' + Math.abs(hash).toString(36) + '_' + pass.length;
}

function escapeHtmlAuth(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== EXTRA MODAL ANIMATION =====
const styleEl = document.createElement('style');
styleEl.textContent = `
  @keyframes modalShake {
    0%,100% { transform: translateX(0); }
    20%     { transform: translateX(-8px); }
    40%     { transform: translateX(8px); }
    60%     { transform: translateX(-5px); }
    80%     { transform: translateX(5px); }
  }
`;
document.head.appendChild(styleEl);

// ===== SHAKE TO ADD FRIENDS =====
let shakeHandler = null;
let shakePollInterval = null;
let shakeFallbackTimer = null;
let shakeBusy = false;
let shakeMyRowId = null;

function shakeEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function startShakeForFriend() {
  if (!currentUser) return showNotification('Спочатку увійдіть в акаунт');
  if (typeof supabaseClient === 'undefined') return showNotification('Немає зв’язку з сервером');

  // iOS вимагає дозвіл на датчики руху (тільки HTTPS)
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission !== 'granted') return showNotification('Немає доступу до сенсора руху');
    } catch (e) {
      console.warn(e);
      return showNotification('Помилка доступу до сенсора (потрібен HTTPS)');
    }
  }

  cancelShake(true); // скинути попередній стан, якщо був
  shakeBusy = false;

  let overlay = document.getElementById('shake-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'shake-overlay';
    overlay.innerHTML = `
      <div style="position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; backdrop-filter:blur(5px);">
        <div id="shake-radar" style="width:120px; height:120px; border-radius:50%; border:3px dashed var(--accent); display:flex; align-items:center; justify-content:center; animation:spin 4s linear infinite; margin-bottom:20px;">
          <div style="font-size:50px; animation:phoneShake 0.5s infinite;">📱</div>
        </div>
        <h2 id="shake-title" style="margin:0 0 10px; font-weight:600;">Трясіть телефон!</h2>
        <div id="shake-subtitle" style="color:var(--text-muted); text-align:center; max-width:300px; font-size:14px; line-height:1.5;">Потрясіть телефон одночасно з іншою людиною.</div>
        <button id="shake-manual-btn" style="display:none; margin-top:20px; padding:12px 24px; background:var(--accent); color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600;">Шукати без тряски</button>
        <button id="shake-cancel-btn" style="margin-top:20px; padding:12px 24px; background:var(--bg-elevated); color:white; border:none; border-radius:8px; cursor:pointer; font-weight:500;">Скасувати</button>
      </div>
      <style>
        @keyframes spin { 100% { transform: rotate(360deg); } }
        @keyframes phoneShake { 0%, 100% { transform: rotate(-10deg); } 50% { transform: rotate(10deg); } }
      </style>
    `;
    document.body.appendChild(overlay);
    document.getElementById('shake-cancel-btn').addEventListener('click', () => cancelShake());
    document.getElementById('shake-manual-btn').addEventListener('click', () => handleShakeDetected());
  }
  overlay.style.display = 'block';
  document.getElementById('shake-title').textContent = 'Трясіть телефон!';
  document.getElementById('shake-subtitle').textContent = 'Потрясіть телефон одночасно з іншою людиною.';
  document.getElementById('shake-radar').style.animation = 'spin 4s linear infinite';
  document.getElementById('shake-manual-btn').style.display = 'none';

  // Якщо за 4 секунди не прийшло жодної події руху (ПК, заборонено) — даємо кнопку
  let gotMotion = false;
  shakeFallbackTimer = setTimeout(() => {
    if (!gotMotion) {
      const b = document.getElementById('shake-manual-btn');
      if (b) b.style.display = 'inline-block';
    }
  }, 4000);

  let lastTime = 0;
  let lastMag = null;
  let hits = 0;
  let firstHit = 0;

  shakeHandler = (e) => {
    const acc = e.accelerationIncludingGravity;
    if (!acc || acc.x == null) return;
    gotMotion = true;
    const now = Date.now();
    if (now - lastTime < 50) return;
    lastTime = now;
    const mag = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
    if (lastMag !== null && Math.abs(mag - lastMag) > 12) {
      // потрібно кілька різких рухів за ~1.5 сек, щоб не спрацьовувало від випадкового поштовху
      if (!hits || now - firstHit > 1500) { hits = 0; firstHit = now; }
      hits++;
      if (hits >= 3) {
        hits = 0;
        handleShakeDetected();
      }
    }
    lastMag = mag;
  };
  window.addEventListener('devicemotion', shakeHandler);
}

async function shakeRemoveMyRows() {
  try {
    if (currentUser && typeof supabaseClient !== 'undefined') {
      await supabaseClient.from('shakes').delete().eq('user_id', currentUser.id);
    }
  } catch (e) { /* не критично */ }
  shakeMyRowId = null;
}

function cancelShake(silent) {
  if (shakeHandler) {
    window.removeEventListener('devicemotion', shakeHandler);
    shakeHandler = null;
  }
  if (shakePollInterval) { clearInterval(shakePollInterval); shakePollInterval = null; }
  if (shakeFallbackTimer) { clearTimeout(shakeFallbackTimer); shakeFallbackTimer = null; }
  const overlay = document.getElementById('shake-overlay');
  if (overlay) overlay.style.display = 'none';
  shakeRemoveMyRows();
}

async function handleShakeDetected() {
  if (shakeBusy) return;
  shakeBusy = true;
  if (shakeHandler) { window.removeEventListener('devicemotion', shakeHandler); shakeHandler = null; }
  if (shakeFallbackTimer) { clearTimeout(shakeFallbackTimer); shakeFallbackTimer = null; }

  const title = document.getElementById('shake-title');
  const sub = document.getElementById('shake-subtitle');
  document.getElementById('shake-manual-btn').style.display = 'none';
  title.textContent = 'Шукаємо збіги...';
  sub.textContent = 'Зачекайте кілька секунд';

  try {
    // Прибираємо старі рядки і створюємо новий; час беремо з сервера (created_at),
    // тому різниця годинників на телефонах не впливає.
    await supabaseClient.from('shakes').delete().eq('user_id', currentUser.id);
    const ins = await supabaseClient.from('shakes').insert({
      user_id: currentUser.id,
      user_name: currentUser.name || 'Користувач'
    }).select().single();

    if (ins.error || !ins.data) throw (ins.error || new Error('insert failed'));
    const mine = ins.data;
    shakeMyRowId = mine.id;
    const myTime = new Date(mine.created_at).getTime();

    let attempts = 0;
    let checking = false;
    shakePollInterval = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        attempts++;
        if (attempts > 12) { // ~18 сек
          cancelShake();
          showNotification('Нікого не знайдено 😔 Спробуйте ще раз.');
          return;
        }

        const since = new Date(myTime - 12000).toISOString();
        const { data, error } = await supabaseClient
          .from('shakes')
          .select('*')
          .neq('user_id', currentUser.id)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(20);
        if (error) throw error;

        if (data && data.length) {
          // найближчий за часом до мого потрясання
          data.sort((a, b) => Math.abs(new Date(a.created_at) - myTime) - Math.abs(new Date(b.created_at) - myTime));
          const match = data[0];
          clearInterval(shakePollInterval);
          shakePollInterval = null;

          title.textContent = 'Знайдено!';
          sub.innerHTML = `Ви знайшли <b>${shakeEsc(match.user_name || 'Користувача')}</b>!<br><br>
            <button id="shake-friend-btn" style="padding:12px 24px; background:var(--accent); color:white; border:none; border-radius:8px; cursor:pointer; width:100%; font-weight:600; font-size:15px; margin-bottom:8px;">➕ Додати в друзі</button>
            <button id="shake-profile-btn" style="padding:12px 24px; background:var(--bg-elevated); color:white; border:none; border-radius:8px; cursor:pointer; width:100%; font-weight:600; font-size:15px; margin-bottom:8px;">👤 Профіль</button>
            <button id="shake-chat-btn" style="padding:12px 24px; background:var(--bg-elevated); color:white; border:none; border-radius:8px; cursor:pointer; width:100%; font-weight:600; font-size:15px;">✉️ Написати повідомлення</button>`;
          document.getElementById('shake-radar').style.animation = 'none';
          const fb = document.getElementById('shake-friend-btn');
          fb.addEventListener('click', async () => {
            if (typeof pfSendRequest !== 'function') return;
            fb.disabled = true;
            if (typeof pfLoad === 'function') await pfLoad();
            const ok = await pfSendRequest(match.user_id);
            fb.textContent = ok ? '✅ Готово' : '➕ Додати в друзі';
            fb.disabled = !!ok;
          });
          document.getElementById('shake-profile-btn').addEventListener('click', () => {
            const uid = match.user_id, nm = match.user_name;
            cancelShake();
            if (typeof openUserProfile === 'function') openUserProfile(uid, nm);
          });
          document.getElementById('shake-chat-btn').addEventListener('click', () => {
            const uid = match.user_id, nm = match.user_name;
            cancelShake();
            if (typeof msgOpenChat === 'function') msgOpenChat(uid, nm);
          });
          // свій рядок можна прибрати, але трохи згодом — щоб інший встиг побачити нас
          setTimeout(shakeRemoveMyRows, 4000);
        }
      } catch (e) {
        console.error('[Shake] poll error', e);
        cancelShake();
        showNotification('Помилка пошуку. Перевірте, що таблицю shakes створено в Supabase (див. shakes.sql).');
      } finally {
        checking = false;
      }
    }, 1500);
  } catch (e) {
    console.error('[Shake]', e);
    cancelShake();
    showNotification('Помилка сервера. Створіть таблицю shakes у Supabase (файл shakes.sql).');
  }
}
