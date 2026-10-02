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
});

// ===== SESSION =====
async function checkSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    const u = session.user;
    const userData = {
      email: u.email,
      name: u.user_metadata?.name || 'Користувач',
      avatarIdx: u.user_metadata?.avatarIdx || 0,
      customAvatar: u.user_metadata?.customAvatar || null
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
    email: u.email,
    name: u.user_metadata?.name || 'Користувач',
    avatarIdx: u.user_metadata?.avatarIdx || 0,
    customAvatar: u.user_metadata?.customAvatar || null
  };

  showSuccess('form-login', `З поверненням! 🎵`);
  setTimeout(() => {
    loginSuccess(userData, true);
  }, 1200);
}

// ===== LOGIN SUCCESS =====
async function loginSuccess(user, showNotif = true) {
  currentUser = user;
  localStorage.setItem('sw_last_email', user.email);
  closeAuth();
  updateTopbarLoggedIn(user);

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

function openProfileEdit() {
  closeDropdown();
  if (!currentUser) return;
  
  const nameInput = document.getElementById('profile-name-input');
  const avatarEl = document.getElementById('profile-edit-avatar');
  
  if (nameInput) nameInput.value = currentUser.name;
  
  tempAvatarBase64 = currentUser.customAvatar || null;
  updateProfileModalAvatar();
  
  document.getElementById('profile-edit-overlay').classList.add('open');
}

function closeProfileEdit() {
  document.getElementById('profile-edit-overlay').classList.remove('open');
  tempAvatarBase64 = null;
  document.getElementById('profile-avatar-file').value = '';
}

function handleAvatarUpload(input) {
  const file = input.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    tempAvatarBase64 = e.target.result;
    updateProfileModalAvatar();
  };
  reader.readAsDataURL(file);
}

function updateProfileModalAvatar() {
  const avatarEl = document.getElementById('profile-edit-avatar');
  if (!avatarEl) return;
  
  if (tempAvatarBase64) {
    avatarEl.innerHTML = `<img src="${tempAvatarBase64}" style="width:100%; height:100%; object-fit:cover;" />`;
    avatarEl.style.background = 'transparent';
  } else {
    const initials = currentUser.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    avatarEl.innerHTML = initials;
    avatarEl.style.background = AVATAR_GRADIENTS[currentUser.avatarIdx || 0];
  }
}

async function saveProfileEdit() {
  if (!currentUser) return;
  
  const nameInput = document.getElementById('profile-name-input');
  const newName = nameInput.value.trim();
  
  if (newName.length < 2) {
    nameInput.style.borderColor = '#e05574';
    setTimeout(() => nameInput.style.borderColor = '', 1500);
    return;
  }
  
  const { data, error } = await supabaseClient.auth.updateUser({
    data: {
      name: newName,
      customAvatar: tempAvatarBase64
    }
  });

  if (!error) {
    currentUser.name = newName;
    currentUser.customAvatar = tempAvatarBase64;
    updateTopbarLoggedIn(currentUser);
    if (typeof showNotification === 'function') {
      showNotification(`✅ Профіль оновлено`);
    }
  }
  
  closeProfileEdit();
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
