// 오프라인 지원: 앱 파일을 캐시하고, 온라인이면 백그라운드에서 최신본으로 갱신
// 앱 파일을 수정해 배포할 때 VERSION 을 올리면 이전 캐시가 정리됨
const VERSION = 'wodlog-v0.6.0';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/parser.js',
  'js/movements.js',
  'js/metrics.js',
  'js/recommend.js',
  'js/benchmarks.js',
  'js/features.js',
  'js/share.js',
  'js/ui.js',
  'js/db.js',
  'js/chart.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const FONT_CACHE = 'wodlog-fonts';

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Pretendard 글꼴(CDN): 한 번 받으면 캐시에서 (오프라인에서도 같은 글꼴)
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('pretendard')) {
    e.respondWith(
      caches.open(FONT_CACHE).then(async cache => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
        return res;
      }).catch(() => fetch(e.request)),
    );
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request)
        .then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
