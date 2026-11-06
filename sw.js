// Offline support: precache the app, then serve from cache and refresh in the background.
const VERSION = 'knightly-v10';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/board.js', 'js/engine.js', 'js/bots.js', 'js/play.js', 'js/review.js',
  'js/puzzles.js', 'js/themes.js', 'js/learn.js', 'js/lessons.js', 'js/courses.js', 'js/openings.js', 'js/tips.js', 'js/explain.js',
  'vendor/chess.js', 'vendor/stockfish/stockfish.wasm.js', 'vendor/stockfish/stockfish.wasm', 'vendor/stockfish/stockfish.js',
  'data/openings.json', 'data/puzzles.json',
  'assets/icons/icon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  ...['w', 'b'].flatMap(c => ['K', 'Q', 'R', 'B', 'N', 'P'].map(p => `assets/pieces/${c}${p}.svg`)),
];

self.addEventListener('install', e => {
  // Skip the HTTP cache, or a new version could be stored with old files.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
