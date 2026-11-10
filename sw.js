// sw.js —— BOUNCE 离线缓存 + 可安装为独立 App（PWA / Progressive Web App）
// 策略：同域 GET 全部缓存。带 ?v= 版本戳的资源 URL 天然唯一 → 发新版自动命中新文件，不会脏缓存；
// HTML 走 network-first（保证你改完重新部署，页面能立刻更新），其余资源 cache-first（秒开）。
const CACHE = 'bounce-v33';

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  // GitHub Pages 项目站点的根地址是 /BOUNCE/ 这种「带子路径、以斜杠结尾」的形式，不是 '/'。
  // 目录根也必须走 network-first，否则浏览器会直接吐缓存里的旧首页，push 完看不到更新。
  var path = u.pathname;
  var wantsHtml = (e.request.headers.get('accept') || '').indexOf('text/html') >= 0;
  var isHtml = wantsHtml || path.endsWith('.html') || path.endsWith('/') || path === '';
  if (isHtml) {
    e.respondWith(
      fetch(e.request).then(function (r) {
        var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, cp); }); return r;
      }).catch(function () { return caches.match(e.request); })
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(function (m) {
        if (m) return m;
        return fetch(e.request).then(function (r) {
          var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, cp); }); return r;
        });
      })
    );
  }
});
