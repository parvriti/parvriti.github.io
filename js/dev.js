/* =====================================================================
   dev.js - the admin-only Developer panel (dev.html).

   A vitals dashboard for the builder (Parv). Everything is computed ON OPEN
   with a single read-only crawl of the collections - no continuous tracking,
   no `usage` collection, no cron, nothing running on any other page. Storage
   is MEASURED; egress + daily ops are honest, clearly-labelled ESTIMATES
   (byte counts are JSON-length proxies, ~±20% vs Firestore's real wire size).

   Cheap by design: one .get() per collection when you open it (or tap Refresh),
   and nothing else. A quota monitor that burns quota would be a bug.
   ===================================================================== */
(function () {
  'use strict';

  var GiB = 1073741824;             // storage cap unit
  var EGRESS_CAP = 10 * GiB;        // 10 GiB / month
  var WRITE_CAP = 20000, READ_CAP = 50000;   // per day
  var DOC_LIMIT = 1048576;          // Firestore hard 1 MiB per-document ceiling

  // blob field per collection (the base64/geometry payload that dominates size)
  var COLS = [
    { id: 'notes',         label: 'Open When notes', ic: '💌', blob: 'voice' },
    { id: 'roomItems',     label: 'Board items',     ic: '📌', blob: 'img' },
    { id: 'canvasStrokes', label: 'Doodle strokes',  ic: '✏️', blob: ['pts', 'png'] },
    { id: 'cycle',         label: 'Cycle logs',      ic: '🌸', blob: null }
  ];
  // the caps the app enforces today (mirrored from open-when.js / board.js)
  var CAPS = [
    { name: 'Voice note', ic: '🎙', cap: 900000, src: 'open-when.js' },
    { name: 'Board photo', ic: '🖼', cap: 980000, src: 'board.js' }
  ];

  var db = null, DATA = null, loads = 20;

  function $(id) { return document.getElementById(id); }
  function status(t) { var e = $('devStatus'); if (e) e.textContent = t || ''; }

  /* ── formatting ── */
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < GiB) return (n / (1024 * 1024)).toFixed(2) + ' MB';
    return (n / GiB).toFixed(2) + ' GB';
  }
  function fmtPct(p) {
    if (p <= 0) return '0%';
    if (p < 0.1) return '<0.1%';
    if (p < 10) return p.toFixed(1) + '%';
    return Math.round(p) + '%';
  }
  function fmtNum(n) { return Math.round(n).toLocaleString('en-US'); }

  /* ── health colour: lots of headroom = green, filling = amber, tight = red ── */
  function tone(pct) { return pct >= 85 ? 'hot' : pct >= 55 ? 'warn' : 'ok'; }
  function toneCap(pct) { return pct >= 90 ? 'hot' : pct >= 75 ? 'warn' : 'ok'; }

  /* animate a bar from 0 → pct with its health colour */
  function setBar(el, pct, t) {
    if (!el) return;
    el.className = t || tone(pct);
    el.style.width = '0%';
    var w = Math.max(pct <= 0 ? 0 : 1.5, Math.min(100, pct));   // always show a sliver if non-zero
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.style.width = w + '%'; }); });
  }

  /* ── reset clocks (Firestore daily quotas reset at midnight US Pacific, not IST) ── */
  function ptResetIn() {
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
      var h = 0, m = 0;
      parts.forEach(function (x) { if (x.type === 'hour') h = +x.value; if (x.type === 'minute') m = +x.value; });
      if (h === 24) h = 0;
      var mins = 24 * 60 - (h * 60 + m);
      return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
    } catch (e) { return '·'; }
  }
  function monthResetIn() {
    var now = new Date(), end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    var d = Math.ceil((end - now) / 86400000);
    return d + (d === 1 ? ' day' : ' days');
  }

  /* ── the crawl: one .get() per collection, aggregate sizes ── */
  function crawl() {
    if (!db) return;
    status('reading your data…');
    var refresh = $('devRefresh'); if (refresh) refresh.disabled = true;
    var out = {};
    var jobs = COLS.map(function (c) {
      return db.collection(c.id).get().then(function (snap) {
        var count = 0, bytes = 0, blob = 0, largest = 0;
        snap.forEach(function (doc) {
          var data = doc.data() || {}, b = 0;
          try { b = JSON.stringify(data).length; } catch (e) {}
          bytes += b; count++; if (b > largest) largest = b;
          if (c.blob) {
            var fields = (typeof c.blob === 'string') ? [c.blob] : c.blob;   // a collection can have >1 blob field (doodles: pts + png fills)
            for (var fi = 0; fi < fields.length; fi++) {
              var v = data[fields[fi]];
              if (typeof v === 'string') blob += v.length;
              else if (v != null) { try { blob += JSON.stringify(v).length; } catch (e) {} }
            }
          }
        });
        out[c.id] = { count: count, bytes: bytes, blob: blob, largest: largest };
      }).catch(function () { out[c.id] = { count: 0, bytes: 0, blob: 0, largest: 0, err: true }; });
    });
    Promise.all(jobs).then(function () {
      DATA = out; render();
      status('updated just now · read ' + totalDocs() + ' docs');
      if (refresh) refresh.disabled = false;
    });
  }
  function totalDocs() { var n = 0; for (var k in DATA) n += DATA[k].count; return n; }

  /* ── render everything ── */
  function render() {
    if (!DATA) return;
    var total = 0, maxCol = 1;
    COLS.forEach(function (c) { var d = DATA[c.id] || {}; total += (d.bytes || 0); if ((d.bytes || 0) > maxCol) maxCol = d.bytes; });

    // Storage (measured)
    var stoPct = total / GiB * 100;
    $('stoUsed').textContent = fmtBytes(total);
    $('stoPct').textContent = fmtPct(stoPct);
    setBar($('stoBar'), stoPct, tone(stoPct));

    var rows = '';
    COLS.forEach(function (c) {
      var d = DATA[c.id] || { count: 0, bytes: 0, blob: 0, largest: 0 };
      var share = maxCol ? (d.bytes / maxCol * 100) : 0;
      var blobPct = d.bytes ? Math.round(d.blob / d.bytes * 100) : 0;
      rows += '<div class="dev-col">' +
        '<div class="dev-col-top"><span class="dev-col-l">' + c.ic + ' ' + c.label + '</span>' +
        '<span class="dev-col-r"><b>' + d.count + '</b> · ' + fmtBytes(d.bytes) + (d.err ? ' ⚠︎' : '') + '</span></div>' +
        '<div class="dev-bar tiny"><i class="rose" style="width:' + Math.max(d.bytes ? 2 : 0, share) + '%"></i></div>' +
        '<div class="dev-col-sub">' + (d.blob ? blobPct + '% blob · ' : '') + 'largest ' + fmtBytes(d.largest) + '</div>' +
        '</div>';
    });
    $('stoTable').innerHTML = rows;

    renderEstimates();
    renderLimits();
  }

  /* egress + ops both scale with the loads/day model */
  function renderEstimates() {
    var n = DATA.notes || {}, r = DATA.roomItems || {}, s = DATA.canvasStrokes || {}, cy = DATA.cycle || {};
    // egress: blob-heavy pages re-pull their whole collection on each open
    var perLoad = (n.bytes || 0) + (r.bytes || 0) + (s.bytes || 0);
    var monthly = perLoad * loads * 30;
    var egrPct = monthly / EGRESS_CAP * 100;
    $('egrUsed').textContent = fmtBytes(monthly) + ' / mo';
    $('egrPct').textContent = fmtPct(egrPct);
    setBar($('egrBar'), egrPct, tone(egrPct));
    $('egrReset').textContent = monthResetIn();

    // ops: presence heartbeat dominates; page loads add doc reads
    var writes = 1150 + loads * 2;
    var reads = 1150 + loads * ((n.count || 0) + (r.count || 0) + (cy.count || 0) + 3);
    var wrPct = writes / WRITE_CAP * 100, rdPct = reads / READ_CAP * 100;
    $('wrNum').textContent = '~' + fmtNum(writes);
    $('rdNum').textContent = '~' + fmtNum(reads);
    setBar($('wrBar'), wrPct, tone(wrPct));
    setBar($('rdBar'), rdPct, tone(rdPct));
    $('opReset').textContent = ptResetIn();
  }

  /* limits & nudges: each cap as a gauge vs the 1 MiB doc ceiling */
  function renderLimits() {
    var html = '';
    CAPS.forEach(function (c) {
      var pct = c.cap / DOC_LIMIT * 100, t = toneCap(pct);
      var nudge = pct >= 90
        ? 'Within a hair of the 1 MiB doc limit; body + metadata could tip a write over. Lower to ~700 KB for headroom.'
        : (pct >= 75 ? 'Comfortable, but not much spare room above the payload.' : 'Plenty of headroom.');
      html += '<div class="dev-lim">' +
        '<div class="dev-col-top"><span class="dev-col-l">' + c.ic + ' ' + c.name + ' cap</span>' +
        '<span class="dev-col-r dev-num">' + fmtBytes(c.cap) + ' · ' + Math.round(pct) + '%</span></div>' +
        '<div class="dev-bar sm"><i class="' + t + '" style="width:' + Math.min(100, pct) + '%"></i></div>' +
        '<div class="dev-col-sub ' + (t === 'hot' ? 'hot-t' : '') + '">' + nudge + ' <span class="dev-src">' + c.src + '</span></div>' +
        '</div>';
    });
    // doodle strokes: a doc-COUNT concern, not bytes
    var sc = (DATA.canvasStrokes || {}).count || 0, sPct = sc / 300 * 100;
    html += '<div class="dev-lim">' +
      '<div class="dev-col-top"><span class="dev-col-l">✏️ Doodle strokes</span>' +
      '<span class="dev-col-r dev-num">' + sc + ' / ~300</span></div>' +
      '<div class="dev-bar sm"><i class="' + tone(sPct) + '" style="width:' + Math.min(100, sPct) + '%"></i></div>' +
      '<div class="dev-col-sub">' + (sc > 300 ? 'Heavy pad; consider flattening old strokes.' : 'Well under a heavy pad. Every stroke is its own doc.') + '</div>' +
      '</div>';
    $('devLimits').innerHTML = html;
    // animate the gauge fills
    requestAnimationFrame(function () {
      var bars = $('devLimits').querySelectorAll('.dev-bar > i');
      for (var i = 0; i < bars.length; i++) { var w = bars[i].style.width; bars[i].style.width = '0%'; (function (el, ww) { requestAnimationFrame(function () { el.style.width = ww; }); })(bars[i], w); }
    });
  }

  /* ── loads/day stepper (re-models egress + ops, no re-crawl) ── */
  function wireLoads() {
    var el = $('devLoads'); if (!el) return;
    var min = +el.getAttribute('data-min'), max = +el.getAttribute('data-max'), step = +el.getAttribute('data-step');
    el.addEventListener('click', function (e) {
      var up = e.target.closest('.ss-up'), dn = e.target.closest('.ss-dn');
      if (!up && !dn) return;
      loads = Math.max(min, Math.min(max, loads + (up ? step : -step)));
      el.querySelector('.ss-val').textContent = loads;
      if (navigator.vibrate) { try { navigator.vibrate(6); } catch (e2) {} }
      if (DATA) renderEstimates();
    });
  }

  /* ── boot (admin only, gated exactly like settings.js) ── */
  function boot() {
    if (boot._on) return; boot._on = true;
    var u = window.__parvritiUser;
    if (!u || u.person !== 'parv') { location.replace('index.html'); return; }
    try { db = firebase.firestore(); } catch (e) { status('Firestore did not load.'); return; }
    wireLoads();
    var rb = $('devRefresh'); if (rb) rb.addEventListener('click', crawl);
    crawl();
  }
  /* back arrow → native back, so it returns to the Settings entry this was
     opened from instead of PUSHING a new one. A plain href here pushed a fresh
     settings entry, and settings' own back is history.back(), so the two
     ping-ponged dev↔settings forever. Falls back to settings.html. */
  (function () {
    var back = document.querySelector('.set-back');
    if (!back) return;
    back.addEventListener('click', function (e) {
      e.preventDefault();
      if (history.length > 1) history.back();
      else location.href = 'settings.html';
    });
  })();

  if (window.__parvritiAuthed) boot();
  else window.addEventListener('parvriti-authed', boot);
})();
