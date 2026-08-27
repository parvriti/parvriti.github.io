/* =====================================================================
   settings.js - the control panel.

   Reads/writes a single flat doc, settings/app. Parv (admin) edits everything;
   Riti gets a restricted view - only HER own notification + visibility cells,
   Parv's shown greyed + read-only, and the admin-only cards (got-home logic,
   cycle, mute) hidden. The push-worker reads the hs and n_ keys; periods.js
   reads the cy keys. This is a curtain; the real boundary is the Firestore rules
   (settings write = parv() or Riti's own cells) + the Worker's service account.
   ===================================================================== */
(function () {
  'use strict';

  var VERSION = 'v100';
  var DEFAULTS = {
    hsRule: 'apart', hsOnePerDay: true, hsAfterHour: 18, hsTogetherHrs: 6,
    hsHomeRitiNoida: true, hsHomeRitiGurugram: true, hsHomeParvRohtak: true, hsHomeParvGurugram: true,
    // notifications matrix (n_<type>_<recipient>) + master mute
    n_openwhen_riti: true, n_openwhen_parv: true, n_read_riti: true, n_read_parv: true, n_board_riti: true, n_board_parv: true,
    n_doodle_riti: true, n_doodle_parv: true, n_heart_riti: true, n_heart_parv: true,
    n_home_riti: true, n_home_parv: true, n_away_riti: true, n_away_parv: true,
    muteAll: false,
    // visibility matrix (v_<page>_<user>) - defaults mirror today's reality
    v_openwhen_riti: true, v_openwhen_parv: true,
    v_board_riti: true, v_board_parv: true, v_doodles_riti: true, v_doodles_parv: true,
    v_periods_riti: false, v_periods_parv: true, v_settings_riti: false, v_settings_parv: true,
    cyLen: 31, cyFlagAt: 50, cyDefaultLen: 4,
    // cycle reminders (per person, OFF by default; each gated on their own Periods visibility)
    cyNotifPeriod_riti: false, cyNotifPeriod_parv: false,
    cyNotifPhase_riti: false, cyNotifPhase_parv: false,
    cyNotifLead: 2
  };
  var SWITCHES = {
    stOnePerDay: 'hsOnePerDay',
    stHomeRitiNoida: 'hsHomeRitiNoida', stHomeRitiGurugram: 'hsHomeRitiGurugram',
    stHomeParvRohtak: 'hsHomeParvRohtak', stHomeParvGurugram: 'hsHomeParvGurugram'
  };
  var STEPPERS = { stTogether: 'hsTogetherHrs', stAfterHour: 'hsAfterHour', stCyLen: 'cyLen', stCyFlag: 'cyFlagAt', stCyDef: 'cyDefaultLen', stCyLead: 'cyNotifLead' };

  var db = null, DOC = null, cfg = {}, saveTimer = null, isAdmin = false;

  /* Parv edits everything. Riti edits only HER own columns (n_*_riti / v_*_riti),
     never Parv's, and not her own Settings-visibility (that would let her lock
     herself out). Parv's cells show greyed + read-only for her. */
  function editableByMe(key) {
    if (isAdmin) return true;
    if (key === 'v_settings_riti') return false;
    return /_riti$/.test(key);
  }

  function $(id) { return document.getElementById(id); }

  function boot() {
    if (boot._on) return; boot._on = true;
    var u = window.__parvritiUser;
    if (!u) { location.replace('index.html'); return; }
    try { db = firebase.firestore(); } catch (e) { toast("couldn't load, try again"); return; }
    DOC = db.collection('settings').doc('app');
    var start = function () {
      isAdmin = (u.person === 'parv');
      // Visibility curtain: Parv always; Riti only if the matrix grants it.
      if (!isAdmin && cfg.v_settings_riti !== true) { location.replace('index.html'); return; }
      if (!isAdmin) document.querySelectorAll('.admin-only').forEach(function (el) { el.style.display = 'none'; });
      var em = $('stEmail'); if (em) em.textContent = u.email || '';
      var ve = $('stVer'); if (ve) ve.textContent = VERSION;
      bind();
    };
    DOC.get().then(function (s) {
      cfg = merge(DEFAULTS, s.exists ? s.data() : {}); start();
    }).catch(function () {
      if (u.person !== 'parv') { location.replace('index.html'); return; }   // safe default on read failure
      cfg = merge(DEFAULTS, {}); start();
    });
  }

  function merge(base, over) {
    var out = {}; for (var k in base) out[k] = (over && k in over) ? over[k] : base[k]; return out;
  }

  /* ── persist (debounced, and batched so a flurry of taps is one write) ── */
  function save(patch) {
    for (var k in patch) cfg[k] = patch[k];
    save._pending = Object.assign(save._pending || {}, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (!DOC) return;
      var p = save._pending; save._pending = null;
      DOC.set(p, { merge: true }).then(function () { toast('saved'); }).catch(function () {
        toast("couldn't save, try again");
        // a failed write must not leave an optimistic toggle showing as saved: resync to server truth
        DOC.get().then(function (s) { if (s && s.exists) { cfg = merge(DEFAULTS, s.data()); bind(); } }).catch(function () {});
      });
    }, 260);
  }

  /* ── render current values into the controls ── */
  function bind() {
    var id;
    for (id in SWITCHES) setSwitch($(id), cfg[SWITCHES[id]] !== false);
    for (id in STEPPERS) drawStep($(id), cfg[STEPPERS[id]]);
    setSeg(cfg.hsRule);
    bindMatrix();
    gateCycle();
    conditional();
    wire();
  }

  /* Cycle-reminder cells + the shared "days before" row grey out (self-muted) for
     each person until THEIR Periods tab is on. Riti's un-grey when v_periods_riti is
     on; Parv's (and the shared lead) when v_periods_parv is on. Still tappable so a
     tap can explain why. Re-run whenever a Periods visibility cell changes. */
  function gateCycle() {
    var cells = document.querySelectorAll('.mx-cell.cy-cell[data-key]');
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i], k = c.getAttribute('data-key');
      var who = /_riti$/.test(k) ? 'riti' : 'parv';
      var visOn = who === 'parv' ? (cfg.v_periods_parv !== false) : (cfg.v_periods_riti === true);
      c.classList.toggle('gated', !visOn);
    }
    var lead = $('rowCyLead');   // shared lead is Parv's, gated on his Periods
    if (lead) lead.classList.toggle('gated', cfg.v_periods_parv === false);
  }

  /* the two matrices (notifications + visibility) - plain aria-checked cells */
  function bindMatrix() {
    var cells = document.querySelectorAll('.mx-cell[data-key]');
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (c.classList.contains('locked')) { c.setAttribute('aria-checked', 'true'); continue; }
      var k = c.getAttribute('data-key');
      c.setAttribute('aria-checked', cfg[k] === true ? 'true' : 'false');
      c.classList.toggle('ro', !editableByMe(k));   // Parv's columns show greyed + read-only for Riti
    }
    updateMute();
  }
  function updateMute() {
    var mute = $('stMuteAll'); if (!mute) return;
    var on = cfg.muteAll === true;
    mute.setAttribute('aria-checked', on ? 'true' : 'false');
    var card = document.getElementById('notifCard');
    if (card) card.classList.toggle('muted', on);
  }

  function setSwitch(el, on) { if (el) el.setAttribute('aria-checked', on ? 'true' : 'false'); }
  function isOn(el) { return el.getAttribute('aria-checked') === 'true'; }

  function setSeg(val) {
    var seg = $('stRule'); if (!seg) return;
    var b = seg.getElementsByTagName('button');
    for (var i = 0; i < b.length; i++) b[i].classList.toggle('on', b[i].getAttribute('data-v') === val);
  }

  function fmt(unit, v) {
    if (unit === 'hour') {
      var h = ((v % 12) === 0) ? 12 : (v % 12), ap = v < 12 ? 'AM' : 'PM';
      if (v === 0) return '12 AM'; if (v === 12) return '12 noon';
      return h + ' ' + ap;
    }
    if (unit === 'hrs') return v + 'h';
    return v + ' ' + (v === 1 ? unit.replace(/s$/, '') : unit);   // "31 days" / "1 day"
  }
  function drawStep(el, v) {
    if (!el) return;
    var min = +el.getAttribute('data-min'), max = +el.getAttribute('data-max');
    v = Math.max(min, Math.min(max, v | 0));
    el.querySelector('.ss-val').textContent = fmt(el.getAttribute('data-unit'), v);
    el.dataset.val = v;
  }

  /* ── conditional rows: together-window only for "apart", cutoff only for "evening" ── */
  function conditional() {
    var r = cfg.hsRule;
    $('rowTogether').classList.toggle('hide', r !== 'apart');
    $('rowAfter').classList.toggle('hide', r !== 'evening');
  }

  /* ── attach listeners once ── */
  function wire() {
    if (wire._on) return; wire._on = true;

    Object.keys(SWITCHES).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('click', function () {
        var on = !isOn(el); setSwitch(el, on); tick(); save(kv(SWITCHES[id], on));
      });
    });

    var seg = $('stRule');
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]'); if (!b) return;
      var v = b.getAttribute('data-v'); setSeg(v); tick(); save({ hsRule: v }); cfg.hsRule = v; conditional();
    });

    Object.keys(STEPPERS).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('click', function (e) {
        var up = e.target.closest('.ss-up'), dn = e.target.closest('.ss-dn');
        if (!up && !dn) return;
        var grow = el.closest('.set-row');
        if (grow && grow.classList.contains('gated')) { toast('turn on the Periods tab first'); return; }
        var step = +el.getAttribute('data-step') || 1;
        var v = (+el.dataset.val || 0) + (up ? step : -step);
        drawStep(el, v); tick(); save(kv(STEPPERS[id], +el.dataset.val));
      });
    });

    document.querySelectorAll('.mx-cell[data-key]').forEach(function (cell) {
      cell.addEventListener('click', function () {
        if (cell.classList.contains('locked')) { toast('you can’t hide your own Settings'); return; }
        if (cell.classList.contains('ro')) { toast('only Parv can change this'); return; }
        if (cell.classList.contains('gated')) { toast('turn on the Periods tab first'); return; }
        var k = cell.getAttribute('data-key');
        var on = cell.getAttribute('aria-checked') !== 'true';
        cell.setAttribute('aria-checked', on ? 'true' : 'false');
        cfg[k] = on; tick(); save(kv(k, on));
        if (k.indexOf('v_periods') === 0) gateCycle();   // toggling a Periods tab re-grades the reminder cells
      });
    });
    var mute = $('stMuteAll');
    if (mute) mute.addEventListener('click', function () {
      cfg.muteAll = !(cfg.muteAll === true); updateMute(); tick(); save(kv('muteAll', cfg.muteAll));
    });

    $('stTestRiti').addEventListener('click', function () { testPing('riti'); });
    $('stTestMe').addEventListener('click', function () { testPing('parv'); });
    $('stRefresh').addEventListener('click', forceRefresh);
    $('stSignout').addEventListener('click', signOut);
  }

  function kv(k, v) { var o = {}; o[k] = v; return o; }
  function tick() { if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} } }

  function testPing(to) {
    if (!window.parvritiNotify) { toast('push not ready'); return; }
    var who = to === 'riti' ? 'Riti' : 'you';
    toast('sending a test to ' + who + '…');
    var r = window.parvritiNotify(to, 'Test ping 🌸', 'from Settings · everything works', 'https://parvriti.github.io/index.html');
    if (r && r.then) r.then(function (ok) { toast(ok ? 'sent a test to ' + who : "couldn't send the test, try again"); });
    else toast('sent a test to ' + who);
  }

  function forceRefresh() {
    toast('refreshing…');
    var done = function () { location.reload(); };
    try {
      var jobs = [];
      if ('serviceWorker' in navigator) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
      if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
      Promise.all(jobs).then(done, done);
      setTimeout(done, 1500);
    } catch (e) { done(); }
  }

  function signOut() {
    try {
      sessionStorage.removeItem('riti_open');
      try { localStorage.removeItem('parvritiReturning'); } catch (e) {}   // show the gate again next visit
      firebase.auth().signOut().then(function () { location.replace('index.html'); }).catch(function () { location.replace('index.html'); });
    } catch (e) { location.replace('index.html'); }
  }

  var toastT = null;
  function toast(m) {
    var t = $('setToast'); if (!t) return;
    t.textContent = m; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 1600);
  }

  /* back arrow = native back, so it returns to wherever Settings was opened
     from (the tab, or Home), not always Home. Falls back to Home if there is
     no history to go back to. Wired on load, independent of sign-in. */
  (function () {
    var back = document.querySelector('.set-back');
    if (!back) return;
    back.addEventListener('click', function (e) {
      e.preventDefault();
      if (history.length > 1) history.back();
      else location.href = 'index.html';
    });
  })();

  if (window.__parvritiAuthed) boot();
  else window.addEventListener('parvriti-authed', boot);
})();
