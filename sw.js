/* =====================================================================
   sw.js - service worker for the "For Toti" app

   Strategy: network-first for our own files (so a fresh deploy always
   wins and the ?v= cache-busting keeps working), with the cached copy
   used only when the network is unavailable (offline / no signal).
   Cross-origin things (fonts, Firebase SDK) are cache-first so they're
   there offline once they've loaded at least once.
   ===================================================================== */
var CACHE = 'parvriti-v36';
var CORE = [
  'index.html', 'open-when.html', 'board.html', 'doodles.html', 'periods.html',
  'css/styles.css?v=36',
  'js/common.js?v=36', 'js/open-when.js?v=36', 'js/board.js?v=36', 'js/doodle.js?v=36',
  'js/periods.js?v=36',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.json'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(CORE.map(function (u) {
      return c.add(u).catch(function () {});   // never let one miss break install
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

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var host = url.host;

  // Never touch Firebase auth / Firestore traffic - it must always be live and uncached.
  var isFirebaseApi = (/googleapis\.com$/.test(host) && host.indexOf('fonts.') !== 0) ||
    /firebaseio\.com$/.test(host) || host === 'accounts.google.com' ||
    host === 'apis.google.com' || host === 'www.google.com';
  if (isFirebaseApi) return;

  if (url.origin === self.location.origin) {
    // our files: network first, fall back to cache when offline
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () { return caches.match(req); })
    );
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
