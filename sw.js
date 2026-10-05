/* ========================================
   SoundWave — Service Worker
   - файли сайту: спершу мережа (завжди свіжа версія), без інтернету — кеш
   - бібліотеки та шрифти: з кешу + тихе оновлення
   - Supabase, аудіо та відео: НЕ кешуються
   ======================================== */

const CACHE = 'soundwave-v3';

// Мінімум для запуску; решту додаємо в кеш під час користування
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// Зовнішні статичні ресурси, які безпечно кешувати
const CDN_HOSTS = [
  'unpkg.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Тільки прості GET-запити; потокове аудіо/відео (Range) не чіпаємо
  if (req.method !== 'GET' || req.headers.has('range')) return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Свій сайт: мережа → кеш
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, url));
    return;
  }

  // Бібліотеки й шрифти: кеш → оновлення у фоні
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Усе інше (Supabase, iTunes, аудіо, картинки з інтернету) — напряму з мережі
});

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache: браузер перевіряє, чи змінився файл, і не віддає застарілу копію
    const fresh = await fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
    if (fresh && fresh.ok && fresh.type === 'basic') {
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: false })
      || await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // Відкриття сторінки без інтернету — віддаємо головну
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html') || await cache.match('./');
      if (shell) return shell;
    }
    return new Response('Немає з’єднання з інтернетом', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}
