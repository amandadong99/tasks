/* =====================================================================
 * Service Worker - 离线缓存 + Push 推送接收
 * ===================================================================== */

const CACHE_VERSION = 'amanda-tasks-v4.6-auto-update';
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
    // 不再自动 skipWaiting — 等页面收到"立即更新"指令再切
  );
});

// 接收页面发来的"立即激活新版本"指令
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

/* ---- Push 推送接收(由 Cloud Function 发送)---- */

/** 从 IndexedDB 读出加密钥(CryptoKey 对象,可直接用于 subtle.decrypt)*/
function _swGetCryptoKey() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('amanda-tasks-crypto', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('crypto', 'readonly');
      const get = tx.objectStore('crypto').get('currentKey');
      get.onsuccess = () => { db.close(); resolve(get.result || null); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      // 没建过库 → 没密钥
      const db = req.result;
      if (!db.objectStoreNames.contains('crypto')) db.createObjectStore('crypto');
    };
  });
}

function _swB64ToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function _swDecrypt(cryptoKey, { iv, ct }) {
  const ivBytes = _swB64ToBytes(iv);
  const ctBytes = _swB64ToBytes(ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, cryptoKey, ctBytes);
  return new TextDecoder().decode(pt);
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch { data = { title: '任务提醒', body: event.data?.text() || '' }; }

    let title = data.title || '📋 任务即将到期';
    let body  = data.body  || '打开 App 查看详情';

    // 如果 payload 里有加密标题,本地解密后展示真实任务名
    if (data.titleEnc && data.titleEnc.iv && data.titleEnc.ct) {
      try {
        const key = await _swGetCryptoKey();
        if (key) {
          const decrypted = await _swDecrypt(key, data.titleEnc);
          // dueTime 是服务端附带的可读时间字符串,如 "15:00"
          const tm = data.dueTime ? `${data.dueTime} · ` : '';
          title = `📋 ${tm}${decrypted}`;
          body  = '点击打开任务详情';
        }
      } catch (e) {
        console.warn('[SW] 标题解密失败,降级用通用文案:', e);
      }
    }

    const options = {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: data.tag || 'amanda-task',
      data: data.url || './index.html',
      requireInteraction: data.urgent === true,
      vibrate: [200, 100, 200],
    };
    await self.registration.showNotification(title, options);
  })());
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
