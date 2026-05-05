/* =====================================================================
 * Service Worker - 离线缓存 + Push 推送接收
 * ===================================================================== */

const CACHE_VERSION = 'amanda-tasks-v3.0-notes-trip';
const CORE_FILES = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './firebase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(CORE_FILES).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // 仅缓存 GET 请求
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(net => {
        if (net && net.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = net.clone();
          caches.open(CACHE_VERSION).then(c => c.put(event.request, copy));
        }
        return net;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

/* ---- Push 推送接收(由后端发送)---- */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: '任务提醒', body: event.data?.text() || '' }; }
  const title = data.title || '任务指挥台';
  const options = {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag || 'amanda-tasks',
    data: data.url || './index.html',
    requireInteraction: data.urgent === true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data || './index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) {
        if (c.url.endsWith(url) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
