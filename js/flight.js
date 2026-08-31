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
  var fdb = null, me = null, mount = null, started = false, activeFlight = null;

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
    activeFlight = active ? f : null;
    if (!active) {
      mount.innerHTML = ''; mount.style.display = 'none';
      setHomeOverride(null);
      return;
    }
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
      '<button class="fl-ico" id="flIco" type="button" aria-label="Add a flight (hold for the flight log)">' +
        '<svg class="fl-ico-plane" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M21 15.4v-1.5l-7.4-4.3V4.6c0-.9-.7-2.1-1.6-2.1s-1.6 1.2-1.6 2.1v5L3 13.9v1.5l7.4-2.1v4.2l-1.9 1.4v1.2L12 19.5l2.5.6v-1.2l-1.9-1.4v-4.2z"/></svg>' +
        '<svg class="fl-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18"/></svg>' +
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

    /* the corner icon does double duty: a TAP opens the add-a-flight pill; a
       PRESS-AND-HOLD fills the ring, then slides the keepsake log in from the right. */
    var holdT = null, held = false, downXY = null, suppressTap = false;
    function endHold() { clearTimeout(holdT); ico.classList.remove('holding'); }
    ico.addEventListener('pointerdown', function (e) {
      held = false; suppressTap = false; downXY = [e.clientX, e.clientY];
      if (wrap.classList.contains('open')) return;   // pill already open -> no hold-to-log
      ico.classList.add('holding');
      // hold when a flight is on Home -> clear it (free the screen); otherwise -> open the log
      holdT = setTimeout(function () { held = true; suppressTap = true; endHold(); if (activeFlight) clearActive(); else openLog(); }, 550);
    });
    ico.addEventListener('pointermove', function (e) {
      if (downXY && (Math.abs(e.clientX - downXY[0]) > 8 || Math.abs(e.clientY - downXY[1]) > 8)) endHold();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { ico.addEventListener(ev, endHold); });
    ico.addEventListener('click', function () {
      if (suppressTap) { suppressTap = false; return; }   // a hold just opened the log -> swallow the click
      wrap.classList.toggle('open'); if (wrap.classList.contains('open')) num.focus();
    });
    whoBtn.addEventListener('click', function () { wi = (wi + 1) % 3; whoBtn.textContent = WHO[wi]; });
    ok.addEventListener('click', submit);
    num.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

    function submit() {
      var raw = (num.value || '').replace(/\s+/g, '').toUpperCase();
      if (!raw) { wrap.classList.remove('open'); num.value = ''; return; }   // tick on empty = just close, no fuss
      // real flight-number shape only: a 2-3 char airline code that CONTAINS a letter
      // (IATA 6E / AI / U2, ICAO UAL) + a 1-4 digit number + an optional suffix letter.
      // Rejects pure-digit or junk input so we never spend an API call on a non-flight.
      if (!/^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])\d{1,4}[A-Z]?$/.test(raw)) { toast('check the flight number'); num.focus(); return; }
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
        if (res.ok && res.j && res.j.ok) {
          wrap.classList.remove('open'); num.value = '';
          var ph = res.j.flight && res.j.flight.phase;
          if (ph === 'landed') toast('already landed · saved to your log');
          else if (ph === 'cancelled') toast('that flight was cancelled');
          else if (ph === 'diverted') toast('that flight was diverted · saved to your log');
          else toast('tracking ✈');
        }
        else if (res.j && res.j.error === 'not-found') toast("couldn't find that flight for today");
        else toast("couldn't add it, check your connection");
      }).catch(function () { ok.classList.remove('busy'); toast("couldn't add it, check your connection"); });
    }
  }

  /* ═══════════ keepsake log: a right-slide sidebar of every kept flight ═══════════
     Opened by pressing-and-holding the corner icon while NO flight is live (when one
     IS live, the same press-hold clears it from Home instead). Reads the flights
     collection, groups by year, with search + press-and-hold edit/delete (soft-delete
     + 5s undo, so a mis-tap on a years-old record is always recoverable and no client
     'create' rule is needed). Self-contained: delete this file and the log goes with it. */
  var FLIGHTS = null, flSub = null, logBuilt = false, editId = null, edWho = 'PR';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function whoLabel(w) { return w === 'PR' ? 'us' : (w === 'R' ? 'Riti' : 'Parv'); }
  function whoCls(w) { return w === 'PR' ? 'pr' : (w === 'R' ? 'r' : 'p'); }
  function dParts(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? { y: +m[1], mi: +m[2] - 1, d: +m[3] } : null; }
  function ival(v) { return typeof v === 'number' ? v : (parseInt(v, 10) || 0); }
  function findFlight(id) { if (!FLIGHTS) return null; for (var i = 0; i < FLIGHTS.length; i++) if (FLIGHTS[i].id === id) return FLIGHTS[i]; return null; }
  var PLANE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M21 15.4v-1.5l-7.4-4.3V4.6c0-.9-.7-2.1-1.6-2.1s-1.6 1.2-1.6 2.1v5L3 13.9v1.5l7.4-2.1v4.2l-1.9 1.4v1.2L12 19.5l2.5.6v-1.2l-1.9-1.4v-4.2z"/></svg>';

  function buildLog() {
    if (logBuilt) return; logBuilt = true;
    var sc = document.createElement('div'); sc.id = 'flScrim'; sc.className = 'fl-scrim';
    var dr = document.createElement('aside'); dr.id = 'flDrawer'; dr.className = 'fl-drawer';
    dr.innerHTML =
      '<header class="fl-dr-head">' +
        '<div class="fl-dr-ttl"><h2>Flights</h2><p id="flDrSub"></p></div>' +
        '<button class="fl-dr-x" id="flDrX" type="button" aria-label="Close">✕</button>' +
      '</header>' +
      '<div class="fl-dr-srch"><input id="flDrQ" type="text" autocomplete="off" spellcheck="false" placeholder="Search a place, year, flight…"></div>' +
      '<div class="fl-dr-list" id="flDrList"></div>' +
      '<div class="fl-edit" id="flEdit"><div class="fl-ed-card">' +
        '<div class="fl-ed-h"><span>Edit flight</span><button class="fl-ed-x" id="flEdX" type="button" aria-label="Close">✕</button></div>' +
        '<label class="fl-ed-l">Flight<input id="flEdNo" class="fl-ed-in" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>' +
        '<div class="fl-ed-row">' +
          '<label class="fl-ed-l">From<input id="flEdFrom" class="fl-ed-in fl-ed-code" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>' +
          '<label class="fl-ed-l">To<input id="flEdTo" class="fl-ed-in fl-ed-code" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>' +
        '</div>' +
        '<div class="fl-ed-row">' +
          '<label class="fl-ed-l">From city<input id="flEdFromCity" class="fl-ed-in" autocomplete="off" spellcheck="false"></label>' +
          '<label class="fl-ed-l">To city<input id="flEdToCity" class="fl-ed-in" autocomplete="off" spellcheck="false"></label>' +
        '</div>' +
        '<label class="fl-ed-l">Date<input id="flEdDate" class="fl-ed-in" type="date"></label>' +
        '<label class="fl-ed-l">Who<span class="fl-ed-who"><button type="button" data-w="PR">us</button><button type="button" data-w="P">Parv</button><button type="button" data-w="R">Riti</button></span></label>' +
        '<div class="fl-ed-btns"><button class="fl-ed-del" id="flEdDel" type="button">Delete</button><button class="fl-ed-save" id="flEdSave" type="button">Save</button></div>' +
      '</div></div>';
    document.body.appendChild(sc); document.body.appendChild(dr);
    sc.addEventListener('click', closeLog);
    dr.querySelector('#flDrX').addEventListener('click', closeLog);
    dr.querySelector('#flDrQ').addEventListener('input', function () { renderLog(this.value); });
    wireEdit(dr);
    wireRowHold(dr.querySelector('#flDrList'));
  }

  function isLogOpen() { var d = document.getElementById('flDrawer'); return !!(d && d.classList.contains('open')); }
  function qval() { var q = document.getElementById('flDrQ'); return q ? q.value : ''; }

  function openLog() {
    buildLog(); ensureLogData(); renderLog(qval());
    document.getElementById('flDrawer').classList.add('open');
    document.getElementById('flScrim').classList.add('open');
    document.body.classList.add('fl-locked');
  }
  function closeLog() {
    var d = document.getElementById('flDrawer'); if (!d) return;
    closeEdit();
    d.classList.remove('open');
    document.getElementById('flScrim').classList.remove('open');
    document.body.classList.remove('fl-locked');
  }

  function ensureLogData() {
    if (flSub || !fdb) return;
    try {
      flSub = fdb.collection('flights').onSnapshot(function (snap) {
        var arr = []; snap.forEach(function (doc) { var d = doc.data() || {}; d.id = doc.id; arr.push(d); });
        arr.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')) || (ival(b.addedAt) - ival(a.addedAt)); });
        FLIGHTS = arr;
        if (isLogOpen()) renderLog(qval());
        if (editId && !findFlight(editId)) closeEdit();   // removed elsewhere -> don't leave a stale sheet
      }, function () { flSub = null; if (FLIGHTS == null) FLIGHTS = []; if (isLogOpen()) renderLog(qval()); });   // permission-denied (rules not published yet) terminates the listener; drop the handle so the next openLog retries
    } catch (e) { FLIGHTS = []; }
  }

  function hayFor(f) {
    var p = dParts(f.date);
    return [f.number, f.from, f.to, f.fromCity, f.toCity, f.routeText, (p ? p.y : ''), (p ? MON[p.mi] : ''), f.date, whoLabel(f.who)].join(' ').toLowerCase();
  }

  function renderLog(q) {
    var list = document.getElementById('flDrList'), sub = document.getElementById('flDrSub');
    if (!list) return;
    if (FLIGHTS == null) { list.innerHTML = '<div class="fl-dr-none">loading…</div>'; if (sub) sub.textContent = ''; return; }
    var live = FLIGHTS.filter(function (f) { return !f.deleted; });
    var toks = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    var rows = live.filter(function (f) { var h = hayFor(f); for (var t = 0; t < toks.length; t++) if (h.indexOf(toks[t]) === -1) return false; return true; });
    if (sub) {
      if (!live.length) sub.textContent = 'no flights yet';
      else {
        var ys = {}; live.forEach(function (f) { var p = dParts(f.date); if (p) ys[p.y] = 1; });
        var ks = Object.keys(ys).sort();
        sub.textContent = live.length + ' flight' + (live.length === 1 ? '' : 's') + (ks.length ? ' · ' + ks[0] + (ks.length > 1 ? '–' + ks[ks.length - 1] : '') : '');
      }
    }
    if (!rows.length) { list.innerHTML = '<div class="fl-dr-none">' + (live.length ? 'nothing matches that' : 'press the ✈ to add your first flight') + '</div>'; return; }
    // per-year counts (of the filtered rows)
    var counts = {}; rows.forEach(function (f) { var p = dParts(f.date); var y = p ? p.y : '—'; counts[y] = (counts[y] || 0) + 1; });
    var html = '', yr = null, n = 0;
    rows.forEach(function (f) {
      var p = dParts(f.date), y = p ? p.y : '—';
      if (y !== yr) { yr = y; html += '<div class="fl-yr">' + y + '<span>' + counts[y] + '</span></div>'; }
      var dstr = p ? (p.d + ' ' + MON[p.mi]) : esc(f.date || '');
      var city = f.routeText || ((f.fromCity || '') + (f.toCity ? ' to ' + f.toCity : ''));
      html += '<div class="fl-lrow" data-id="' + esc(f.id) + '" style="animation-delay:' + (n * 22) + 'ms">' +
          '<span class="fl-lp">' + PLANE + '</span>' +
          '<div class="fl-lmain">' +
            '<div class="fl-lroute"><b>' + esc(f.from || '—') + '</b><i>→</i><b>' + esc(f.to || '—') + '</b>' + (f.number ? '<span class="fl-lno">' + esc(f.number) + '</span>' : '') + '</div>' +
            (city ? '<div class="fl-lcity">' + esc(city) + '</div>' : '') +
          '</div>' +
          '<div class="fl-lmeta"><span class="fl-ldate">' + esc(dstr) + '</span><span class="fl-lwho w-' + whoCls(f.who) + '">' + whoLabel(f.who) + '</span></div>' +
        '</div>';
      n++;
    });
    html += '<div class="fl-dr-foot">Press and hold a flight to edit or remove it.</div>';
    list.innerHTML = html;
  }

  /* press and hold a row -> edit. Delegated so it survives every re-render. */
  function wireRowHold(list) {
    var pT = null, pRow = null, pY = 0;
    function cancel() { clearTimeout(pT); if (pRow) { pRow.classList.remove('pressing'); pRow = null; } }
    list.addEventListener('pointerdown', function (e) {
      var row = e.target.closest('.fl-lrow'); if (!row) return;
      pRow = row; pY = e.clientY; row.classList.add('pressing');
      pT = setTimeout(function () { var id = row.dataset.id; cancel(); openEdit(id); }, 450);
    });
    list.addEventListener('pointermove', function (e) { if (pRow && Math.abs(e.clientY - pY) > 8) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { list.addEventListener(ev, cancel); });
    list.addEventListener('scroll', cancel);
  }

  /* ── edit sheet ── */
  function wireEdit(dr) {
    dr.querySelector('#flEdX').addEventListener('click', closeEdit);
    dr.querySelector('#flEdit').addEventListener('click', function (e) { if (e.target === this) closeEdit(); });
    var whoWrap = dr.querySelector('.fl-ed-who');
    whoWrap.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; edWho = b.dataset.w; paintWho(whoWrap); });
    dr.querySelector('#flEdSave').addEventListener('click', saveEdit);
    dr.querySelector('#flEdDel').addEventListener('click', delEdit);
  }
  function paintWho(wrap) { [].forEach.call(wrap.querySelectorAll('button'), function (b) { b.classList.toggle('on', b.dataset.w === edWho); }); }
  function openEdit(id) {
    var f = findFlight(id); if (!f) return;
    editId = id; edWho = f.who || 'PR';
    var g = function (x) { return document.getElementById(x); };
    g('flEdNo').value = f.number || '';
    g('flEdFrom').value = f.from || ''; g('flEdTo').value = f.to || '';
    g('flEdFromCity').value = f.fromCity || ''; g('flEdToCity').value = f.toCity || '';
    g('flEdDate').value = (dParts(f.date) ? String(f.date).slice(0, 10) : '');
    paintWho(document.querySelector('.fl-ed-who'));
    g('flEdit').classList.add('on');
  }
  function closeEdit() { var e = document.getElementById('flEdit'); if (e) e.classList.remove('on'); editId = null; }
  function saveEdit() {
    var id = editId; if (!id) return;
    var g = function (x) { return (document.getElementById(x).value || ''); };
    var no = g('flEdNo').replace(/\s+/g, '').toUpperCase();
    var from = g('flEdFrom').replace(/\s+/g, '').toUpperCase();
    var to = g('flEdTo').replace(/\s+/g, '').toUpperCase();
    var fc = g('flEdFromCity').trim(), tc = g('flEdToCity').trim();
    var date = g('flEdDate').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('pick a date'); return; }
    patchFlight(id, {
      number: no, from: from, to: to, fromCity: fc, toCity: tc,
      routeText: (fc && tc) ? (fc + ' to ' + tc) : (fc || tc || ''), date: date, who: edWho
    }).then(function () { toast('saved'); closeEdit(); }).catch(function () { toast("couldn't save, try again"); });
  }
  function delEdit() {
    var id = editId, f = findFlight(id); if (!f) return;
    deleteFlight(id).then(function () {
      closeEdit();
      toastUndo('Flight removed', function () {
        patchFlight(id, { deleted: false }).then(function () { toast('brought it back'); }).catch(function () { toast("couldn't undo, try again"); });
      });
    }).catch(function () { toast("couldn't remove it, try again"); });
  }

  /* ── firestore ops (rules allow either of us to update/delete a flights row; create
     is worker/seed only, so delete is a soft flag we can always undo) ── */
  function patchFlight(id, fields) {
    fields = fields || {};
    try { fields.editedAt = firebase.firestore.FieldValue.serverTimestamp(); } catch (e) {}
    return fdb.collection('flights').doc(id).set(fields, { merge: true });
  }
  function deleteFlight(id) { return patchFlight(id, { deleted: true }); }

  /* ── clear the live Home tracker (press-hold the corner ✈ while a flight is on).
     flightActive/now is worker-only, so we ask /flight/clear; the log row stays. ── */
  function clearActive() {
    var f = activeFlight; if (!f) return;
    var user = firebase.auth().currentUser;
    if (!user) { toast('sign-in needed'); return; }
    user.getIdToken().then(function (idt) {
      return fetch(WORKER + '/flight/clear', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idt } });
    }).then(function (r) {
      if (r.ok) toastUndo('Cleared from Home', function () { readdFlight(f); });   // still in your log; Undo re-pins it
      else toast("couldn't clear it, try again");
    }).catch(function () { toast("couldn't clear it, try again"); });
  }
  function readdFlight(f) {
    var user = firebase.auth().currentUser; if (!user) { toast('sign-in needed'); return; }
    user.getIdToken().then(function (idt) {
      return fetch(WORKER + '/flight/add', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idt },
        body: JSON.stringify({ number: f.number, date: f.date, who: f.who || 'PR' }) });
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j || !res.j.ok) { toast("couldn't undo, try again"); return; }
        var ph = res.j.flight && res.j.flight.phase;
        // a flight that has since landed/cancelled/diverted is NOT re-pinned to Home (worker skips it) - say so honestly
        toast((ph === 'landed' || ph === 'cancelled' || ph === 'diverted') ? "it's still in your log" : 'back on Home');
      }).catch(function () { toast("couldn't undo, try again"); });
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
  function toastEl() {
    var t = document.getElementById('flToast');
    if (!t) { t = document.createElement('div'); t.id = 'flToast'; t.className = 'fl-toast'; document.body.appendChild(t); }
    return t;
  }
  function toast(m) {
    var t = toastEl();
    clearTimeout(toastUndo._t); t.classList.remove('has-undo');
    t.textContent = m; t.classList.add('on'); clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }
  /* like toast(), but with a 5-second Undo, so a mis-tap delete of a years-old keepsake is recoverable */
  function toastUndo(m, undoFn) {
    var t = toastEl();
    clearTimeout(toast._t); clearTimeout(toastUndo._t); t.classList.remove('has-undo');
    t.innerHTML = '<span class="flt-msg"></span><button type="button" class="flt-undo">Undo</button>';
    t.querySelector('.flt-msg').textContent = m;
    t.classList.add('on', 'has-undo');
    t.querySelector('.flt-undo').onclick = function () { clearTimeout(toastUndo._t); t.classList.remove('on', 'has-undo'); if (undoFn) undoFn(); };
    toastUndo._t = setTimeout(function () { t.classList.remove('on', 'has-undo'); }, 5000);
  }

  /* boot once auth resolves — common.js fires 'parvriti-authed' on window + sets __parvritiUser */
  window.addEventListener('parvriti-authed', boot);
  if (window.__parvritiUser) boot();
})();
