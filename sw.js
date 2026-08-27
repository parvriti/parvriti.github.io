/* =====================================================================
   sw.js - service worker for the "For Toti" app

   Strategy (own origin): navigations + versioned ?v= assets are CACHE-FIRST
   for an instant paint. The precache is filled atomically at install with
   cache:'reload' (bypassing the HTTP cache, which could otherwise hand back
   a max-age-fresh STALE copy). manifest/icons stay network-first. Cross-origin
   (fonts, Firebase SDK) are cache-first; Firebase auth/Firestore is never
   touched. A deploy bumps CACHE; activate purges the old one, so the next
   navigation is fresh - one stale nav right after a deploy, by design.
   ===================================================================== */
var CACHE = 'parvriti-v100';
var CORE = [
  'index.html', 'open-when.html', 'board.html', 'doodles.html', 'periods.html', 'settings.html', 'dev.html',
  'css/styles.css?v=100', 'css/theme.css?v=100',
  'js/common.js?v=100', 'js/open-when.js?v=100', 'js/board.js?v=100', 'js/doodle.js?v=100',
  'js/periods.js?v=100', 'js/settings.js?v=100', 'js/dev.js?v=100', 'js/native.js?v=100',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.json'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  // Atomic precache with cache:'reload': fetch each entry from ORIGIN (not the HTTP cache, which
  // under max-age could return a stale copy) and store it. No per-entry catch - any miss rejects the
  // whole install, so the new SW never activates and the old SW keeps its intact cache; the browser
  // retries on the next update check. (Explicit fetch loop rather than cache.addAll, so the reload
  // cache mode can't be dropped by an addAll that re-creates the request internally.)
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(CORE.map(function (u) {
      return fetch(new Request(u, { cache: 'reload' })).then(function (res) {
        if (!res || !res.ok) throw new Error('precache ' + u + ' ' + (res && res.status));
        return c.put(u, res.clone());
      });
    }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Navigations: serve the precached shell instantly. The shell is query-independent, so match the
// bare document by pathname (ignoring ?open/?moment/?n/?celebrate, which the page reads at runtime).
function shellFirst(url) {
  var path = url.pathname; if (path === '/' || path === '') path = '/index.html';   // start_url is index.html
  var shellKey = new Request(url.origin + path);
  return caches.open(CACHE).then(function (cache) {
    return cache.match(shellKey, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(new Request(shellKey, { cache: 'reload' })).then(function (res) {   // cold cache (rare): fresh
        if (res && res.ok) cache.put(shellKey, res.clone());
        return res;
      });
    });
  });
}
// Versioned ?v= assets: immutable per deploy (a new deploy is a fresh key), so cache-first.
function assetFirst(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }); });   // offline: any cached version
  });
}
// Unversioned own-origin (manifest, icons): network-first, cache as fallback.
function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () { return caches.match(req, { ignoreSearch: true }); });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var host = url.host;

  // Never touch Firebase auth / Firestore traffic - it must always be live and uncached.
  var isFirebaseApi = (/googleapis\.com$/.test(host) && host.indexOf('fonts.') !== 0) ||
    /firebaseio\.com$/.test(host) || /firebaseapp\.com$/.test(host) || host === 'accounts.google.com' ||
    host === 'apis.google.com' || host === 'www.google.com';
  if (isFirebaseApi) return;

  if (url.origin === self.location.origin) {
    // 1) navigations -> cache-first from the precached shell (instant paint)
    if (req.mode === 'navigate') { e.respondWith(shellFirst(url)); return; }
    // 2) versioned ?v= assets -> cache-first
    if (url.searchParams.has('v')) { e.respondWith(assetFirst(req)); return; }
    // 3) everything else own-origin (manifest, icons) -> network-first
    e.respondWith(networkFirst(req));
  } else {
    // fonts / Firebase SDK: cache first, refresh in the background
    e.respondWith(
      caches.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      })
    );
  }
});
