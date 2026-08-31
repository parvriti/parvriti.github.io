/* =====================================================================
   flight.js — the flight feature, an isolated fail-open leaf on the Home.

   Off-by-default per person (settings v_flights_<person>). When on for THIS
   viewer: a faint corner plane opens a tiny entry (flight number + P/R/PR),
   which POSTs to the Worker's /flight/add; the Worker resolves it via
   AeroDataBox and writes flightActive/now, which this file renders as the
   woven-in Home tracker. Nothing here can break the Home: every path is
   guarded, and if this file is deleted the Home works unchanged.
   (The keepsake log sidebar is added in a later pass.)
   ===================================================================== */
(function () {
  'use strict';
  if (document.body.getAttribute('data-page') !== 'home') return;   // Home only

  var WORKER = 'https://parvriti-push.parvbajaj2000.workers.dev';
  var fdb = null, me = null, mount = null, started = false;

  function boot() {
    if (started) return;
    var u = window.__parvritiUser; if (!u) return;
    started = true; me = u.person;
    try { fdb = firebase.firestore(); } catch (e) { return; }
    mount = document.querySelector('[data-flight]');
    // gate on THIS viewer's flag (off by default). Read once; the feature is a
    // deliberate opt-in, so we don't need a live listener on the flag itself.
    fdb.collection('settings').doc('app').get().then(function (s) {
      var d = s.exists ? (s.data() || {}) : {};
      if (d['v_flights_' + me] !== true) return;   // off for me -> stay completely invisible
      buildEntry();
      watchActive();
    }).catch(function () {});
  }

  /* ── live tracker: render flightActive/now into [data-flight] ── */
  function watchActive() {
    if (!fdb || !mount) return;
    try {
      fdb.collection('flightActive').doc('now').onSnapshot(function (snap) {
        var f = snap.exists ? (snap.data() || null) : null;
        renderTracker(f);
      }, function () { renderTracker(null); });
    } catch (e) { renderTracker(null); }
  }

  function renderTracker(f) {
    if (!mount) return;
    var active = f && f.number && (f.phase === 'boarding' || f.phase === 'air' || f.phase === 'landed');
    if (!active) {
      mount.innerHTML = ''; mount.style.display = 'none';
      setHomeOverride(null);
      document.body.classList.remove('flight-on');
      return;
    }
    document.body.classList.add('flight-on');   // hides the corner entry while a flight shows
    var prog = progress(f);
    var pt = arcPoint(prog), ang = arcAngle(prog);
    var flown = Math.round(prog * 100);
    var meta = fmtTime(f.depSchedUtc, f.depTz) + '<span class="fl-ar">→</span>' +
      fmtTime((f.phase === 'landed' ? f.arrEstUtc : f.arrSchedUtc), f.arrTz) +
      (f.delayMin >= 15 && f.phase !== 'landed' ? ' <span class="fl-late">· ' + f.delayMin + 'm late</span>' : '') +
      ' · ' + esc(f.number);
    mount.style.display = '';
    mount.innerHTML =
      '<div class="fl-route">' +
        '<div class="fl-ap"><span class="fl-code">' + esc(f.from) + '</span><span class="fl-city">' + esc(f.fromCity) + '</span></div>' +
        '<svg class="fl-arc" viewBox="0 0 200 56" preserveAspectRatio="none" aria-hidden="true">' +
          '<path class="fl-rail" d="M6 42 Q100 6 194 42"/>' +
          '<path class="fl-flown" d="M6 42 Q100 6 194 42" pathLength="100" stroke-dasharray="100" stroke-dashoffset="' + (100 - flown) + '"/>' +
          '<circle class="fl-dot" cx="6" cy="42" r="2.4"/><circle class="fl-dot" cx="194" cy="42" r="2.4"/>' +
          '<g class="fl-plane" transform="translate(' + pt.x.toFixed(1) + ',' + pt.y.toFixed(1) + ') rotate(' + ang.toFixed(0) + ')">' +
            '<path transform="scale(.6) translate(-12,-12)" d="M12 2 L13.4 9 L22 13.2 L22 15 L13.4 12.4 L13.4 18 L16.4 20 L16.4 21.4 L12 20 L7.6 21.4 L7.6 20 L10.6 18 L10.6 12.4 L2 15 L2 13.2 L10.6 9 Z"/>' +
          '</g>' +
        '</svg>' +
        '<div class="fl-ap"><span class="fl-code">' + esc(f.to) + '</span><span class="fl-city">' + esc(f.toCity) + '</span></div>' +
      '</div>' +
      '<div class="fl-meta">' + meta + '</div>';
    setHomeOverride(f);
  }

  /* the home/away line becomes "travelling / landed" while a flight is on. We take
     over [data-homestate] and set window.__flightActive so common.js yields to us. */
  function setHomeOverride(f) {
    var el = document.querySelector('[data-homestate]');
    if (!f) {
      window.__flightActive = false;
      if (window.parvritiRenderHomeState) { try { window.parvritiRenderHomeState(); } catch (e) {} }
      return;
    }
    window.__flightActive = true;
    if (!el) return;
    var line;
    if (f.who === 'PR') line = f.phase === 'landed' ? 'You’ve landed' : 'Flying together';
    else {
      var nm = (f.who === 'R') ? 'Riti' : 'Parv';
      line = f.phase === 'landed' ? (nm + ' has landed') : (nm + ' is travelling');
    }
    var ic = f.phase === 'landed' ? '🛬' : '✈';
    el.style.display = '';
    el.innerHTML = '<span class="hs-heart">' + ic + '</span>' + esc(line);
  }

  /* ── progress + arc geometry (quadratic Q6 42 100 6 194 42) ── */
  function progress(f) {
    if (f.phase === 'landed') return 1;
    if (f.phase !== 'air') return 0;
    var d = ms(f.depEstUtc || f.depSchedUtc), a = ms(f.arrEstUtc || f.arrSchedUtc), n = Date.now();
    if (!d || !a || a <= d) return 0.5;
    return Math.max(0.02, Math.min(0.98, (n - d) / (a - d)));
  }
  function arcPoint(t) {
    var P0 = { x: 6, y: 42 }, P1 = { x: 100, y: 6 }, P2 = { x: 194, y: 42 }, u = 1 - t;
    return { x: u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x, y: u * u * P0.y + 2 * u * t * P1.y + t * t * P2.y };
  }
  function arcAngle(t) {
    var dx = 2 * (1 - t) * (100 - 6) + 2 * t * (194 - 100);
    var dy = 2 * (1 - t) * (6 - 42) + 2 * t * (42 - 6);
    return Math.atan2(dy, dx) * 180 / Math.PI + 90;   // plane nose points up; +90 to face travel
  }

  /* ── entry: faint corner plane -> tiny pill (number + P/R/PR + ✓) ── */
  function buildEntry() {
    if (document.getElementById('flEntry')) return;
    var wrap = document.createElement('div'); wrap.id = 'flEntry'; wrap.className = 'fl-entry';
    wrap.innerHTML =
      '<button class="fl-ico" id="flIco" type="button" aria-label="Add a flight">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M21 15.4v-1.5l-7.4-4.3V4.6c0-.9-.7-2.1-1.6-2.1s-1.6 1.2-1.6 2.1v5L3 13.9v1.5l7.4-2.1v4.2l-1.9 1.4v1.2L12 19.5l2.5.6v-1.2l-1.9-1.4v-4.2z"/></svg>' +
      '</button>' +
      '<div class="fl-form" id="flForm">' +
        '<span class="fl-fp">✈</span>' +
        '<input class="fl-in" id="flNum" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="6E 1471" maxlength="8">' +
        '<button class="fl-who" id="flWho" type="button" aria-label="Who is flying">PR</button>' +
        '<button class="fl-ok" id="flOk" type="button" aria-label="Track this flight">✓</button>' +
      '</div>';
    document.body.appendChild(wrap);

    var ico = wrap.querySelector('#flIco'), form = wrap.querySelector('#flForm'),
        num = wrap.querySelector('#flNum'), whoBtn = wrap.querySelector('#flWho'), ok = wrap.querySelector('#flOk');
    var WHO = ['PR', 'P', 'R'], wi = 0;
    ico.addEventListener('click', function () { wrap.classList.toggle('open'); if (wrap.classList.contains('open')) num.focus(); });
    whoBtn.addEventListener('click', function () { wi = (wi + 1) % 3; whoBtn.textContent = WHO[wi]; });
    ok.addEventListener('click', submit);
    num.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

    function submit() {
      var raw = (num.value || '').replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(raw)) { toast('check the flight number'); num.focus(); return; }
      var today = new Date(), date = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
      ok.classList.add('busy'); toast('finding your flight…');
      var user = firebase.auth().currentUser;
      if (!user) { ok.classList.remove('busy'); toast('sign-in needed'); return; }
      user.getIdToken().then(function (idt) {
        return fetch(WORKER + '/flight/add', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idt },
          body: JSON.stringify({ number: raw, date: date, who: WHO[wi] })
        });
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (res) {
        ok.classList.remove('busy');
        if (res.ok && res.j && res.j.ok) { wrap.classList.remove('open'); num.value = ''; toast('tracking ✈'); }
        else if (res.j && res.j.error === 'not-found') toast("couldn't find that flight for today");
        else toast("couldn't add it, check your connection");
      }).catch(function () { ok.classList.remove('busy'); toast("couldn't add it, check your connection"); });
    }
  }

  /* ── tiny helpers ── */
  function ms(u) { if (!u) return NaN; var m = String(u).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?Z?$/); return m ? Date.parse(m[1] + 'T' + m[2] + ':' + (m[3] || '00') + 'Z') : Date.parse(u); }
  function fmtTime(u, tz) {
    var t = ms(u); if (!t) return '';
    try { return new Intl.DateTimeFormat('en-IN', { timeZone: tz || 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(t)).replace(' ', ' '); }
    catch (e) { return ''; }
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(m) {
    var t = document.getElementById('flToast');
    if (!t) { t = document.createElement('div'); t.id = 'flToast'; t.className = 'fl-toast'; document.body.appendChild(t); }
    t.textContent = m; t.classList.add('on'); clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }

  /* boot once auth resolves — common.js fires 'parvriti-authed' on window + sets __parvritiUser */
  window.addEventListener('parvriti-authed', boot);
  if (window.__parvritiUser) boot();
})();
