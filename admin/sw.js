/* Service worker administrace: aplikace jde přidat na plochu a otevře se i při slabém signálu.
   Data (Supabase) se nikdy neukládají do mezipaměti. */
var CACHE = 'mp-admin-v3';
var SHELL = ['./', './index.html', './admin.css', './admin.js', '../config.js', '../db.js', './icon-192.png', './icon-512.png', '../favicon.svg'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x !== CACHE; }).map(function (x) { return caches.delete(x); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return; // Supabase, fonty apod. jdou vždy přímo
  e.respondWith(fetch(r).then(function (res) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }); return res; })
    .catch(function () { return caches.match(r).then(function (m) { return m || caches.match('./index.html'); }); }));
});
