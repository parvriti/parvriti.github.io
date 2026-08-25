/* =====================================================================
   periods.js: the "Periods" tab. PARV ONLY.

   A support dashboard, not a tracker: where she probably is in her cycle,
   what that usually means, and what he can do about it today.

   DESIGN RULES baked in here, do not quietly undo them:
     · Predictions are RANGES, never a single confident date.
     · The three levels are generic cycle tendencies, not readings of her.
       Never add a "mood" row and never attribute a feeling to her cycle.
     · Fertility is a loose calendar estimate, explicitly not medical advice.
     · NO push notifications from this tab, ever.
     · NO personal data in this file. Her history lives in Firestore behind
       the auth rules. Static files here are publicly fetchable.

   DATA: Firestore collection `cycle`, one doc per period, doc id = the
   start date as YYYY-MM-DD (so a repeat write is idempotent):
       { start:'YYYY-MM-DD', len:4, longOk:false, by:'parv',
         createdAt:<ts>, editedAt:<ts> }
   Everything else (cycle day, phase, predictions, flags) is DERIVED on
   read, never stored, so fixing one wrong date corrects all of history.
   ===================================================================== */
(function () {
  'use strict';

  /* ── the model ─────────────────────────────────────────────────────── */
  var DEFAULT_LEN = 4;   // true for every one of her logged periods so far
  var RANGE       = 2;   // plus or minus 2 days, so a 5 day window
  var EXPECT      = 31;  // her typical cycle. FLAT, set deliberately.
  var RING_DAYS   = 40;  // visual span of the dial
  var FLAG_AT     = 50;  /* a gap this long is probably a missed period. FIXED
                            on purpose: deriving it from her longest cycle
                            meant confirming one long gap silently un-flagged
                            every other suspicious gap. */

  var LOGS = [];         // [{id, start:Date, len:int, longOk:bool}]
  var LONGEST = EXPECT, SHORTEST = EXPECT, LONGEST_EVER = EXPECT, lastStart = null;
  var db = null, ready = false, canEdit = false;   // canEdit becomes true for whoever can see the tab (Parv always; Riti once she enables Periods)

  /* ── dates. All local, so the day never flips at 05:30 IST ─────────── */
  function d(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addD(t, n) { var x = new Date(t.getTime()); x.setDate(x.getDate() + n); return x; }
  function diffD(a, b) { return Math.round((a - b) / 86400000); }
  function iso(t) { return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }
  function fmt(t) { return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function today() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var SHORTM = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOWL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  function longDate(t) { return ord(t.getDate()) + ' ' + MONTHS[t.getMonth()] + ' ' + t.getFullYear(); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function byStart(a, b) { return a.start - b.start; }
  function cycleLen(i) { return (i < LOGS.length - 1) ? diffD(LOGS[i + 1].start, LOGS[i].start) : null; }
  function curLen() { return LOGS.length ? LOGS[LOGS.length - 1].len : DEFAULT_LEN; }

  /* recomputed after EVERY change, so nothing can go stale */
  function recompute() {
    LOGS.sort(byStart);
    var usable = [];
    for (var i = 0; i < LOGS.length - 1; i++) {
      var c = cycleLen(i);
      if (c < FLAG_AT || LOGS[i].longOk) usable.push(c);
    }
    if (!usable.length) usable = [EXPECT];
    var recent = usable.slice(-10);
    LONGEST = Math.max.apply(null, recent);
    SHORTEST = Math.min.apply(null, usable);
    LONGEST_EVER = Math.max.apply(null, usable);
    lastStart = LOGS.length ? LOGS[LOGS.length - 1].start : null;
  }

  /* ── the phase model. Boundaries DERIVE from EXPECT so they stay
        coherent if it is ever retuned. With EXPECT=31:
        1-4 period · 5-13 follicular · 14-20 fertile · 21-26 luteal
        27-28 pms · 29-33 due · 34-LONGEST late · beyond that overdue ── */
  function phaseFor(day, len) {
    len = len || curLen();
    var open = EXPECT - RANGE, close = EXPECT + RANGE;
    var ov = EXPECT - 14;                       // luteal phase is the fixed ~14 days
    var fFrom = Math.max(len + 1, ov - 3), fTo = Math.max(fFrom, ov + 3);
    if (day <= len) return 'menstrual';
    if (day < fFrom) return 'follicular';
    if (day <= fTo) return 'fertile';
    if (day < open - 2) return 'luteal';
    if (day < open) return 'pms';
    if (day <= close) return 'due';
    if (day <= LONGEST) return 'late';
    return 'overdue';
  }
  var PHNAME = {
    menstrual: 'menstruation', follicular: 'follicular', fertile: 'ovulation',
    luteal: 'luteal', pms: 'pre-menstrual', due: 'period due',
    late: 'running late', overdue: 'missed period?', none: 'no data'
  };

  /* ── the three levels. -1 unknown, 0 none, 1 low, 2 medium, 3 high, 4 highest.
        `closeness` is how much physical affection she may want, NOT a
        prediction of desire, and never a prompt to initiate. ─────────── */
  var THIRD = { m12: 2, m3: 2, m4: 2, follicular: 3, fertile: 4, luteal: 2, pms: 1, due: 1, late: 1 };
  function thirdFor(ph, day) {
    if (ph === 'menstrual') return day <= 2 ? THIRD.m12 : (day === 3 ? THIRD.m3 : THIRD.m4);
    return (THIRD[ph] === undefined) ? -1 : THIRD[ph];
  }
  function levelsFor(ph, day) {
    var t = thirdFor(ph, day);
    if (ph === 'menstrual') {
      if (day <= 2) return { energy: 1, third: t, pain: 4 };
      if (day === 3) return { energy: 1, third: t, pain: 2 };
      return { energy: 2, third: t, pain: 1 };
    }
    if (ph === 'follicular') return { energy: 3, third: t, pain: 0 };
    if (ph === 'fertile') return { energy: 4, third: t, pain: 0 };
    if (ph === 'luteal') return { energy: 2, third: t, pain: 1 };
    if (ph === 'pms' || ph === 'due' || ph === 'late') return { energy: 1, third: t, pain: 2 };
    return { energy: -1, third: -1, pain: -1 };
  }
  var WORD = { '-1': 'unknown', 0: 'none', 1: 'low', 2: 'medium', 3: 'high', 4: 'highest' };
  var MIC = {
    energy: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>',
    third: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-8-4.7-8-10.2A4.8 4.8 0 0 1 12 7.6 4.8 4.8 0 0 1 20 10.8C20 16.3 12 21 12 21Z"/></svg>',
    pain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l2.5-7 4 14L15 12h7"/></svg>'
  };
  var ROWS = [
    { k: 'energy', label: 'energy', c: 'var(--cy-energy)' },
    { k: 'third', label: 'closeness', c: 'var(--cy-close)' },
    { k: 'pain', label: 'pain', c: 'var(--cy-pain)' }
  ];

  /* ── what he can actually do. Action first, never a diagnosis of her ── */
  var HINT = {
    menstrual: 'Heat, and take things off her plate. Days one and two are the worst of them.',
    follicular: 'Easy stretch. Good week to make plans and say yes to things.',
    fertile: 'Good window for the fun stuff. Ask her out properly.',
    luteal: 'Smaller, softer plans. Start restocking what she will want.',
    pms: 'Be the steady one. Supplies stocked, nothing heavy scheduled.',
    due: 'Could be any day now. Keep everything within reach.',
    late: 'Running long is normal for her. Nothing to do differently.',
    overdue: 'Longer than she has ever run. Most likely one went unlogged, so hold the drop to add it.',
    none: 'Nothing logged yet. Tap the drop when her period begins.'
  };

  /* ── colour per phase: [accent, softTint, deep, washTop, washBottom].
        LIGHT theme: softTint is the pale fill (ring track, "days away" pill,
        logged days), deep is the dark text that sits ON that pale fill. ─── */
  var LOOK = {
    menstrual: ['#f4525f', '#ffe0e3', '#b82d39', 'rgba(244,82,95,.16)', 'rgba(244,82,95,.05)'],
    follicular: ['#ef6f9b', '#ffe2ec', '#b23a68', 'rgba(239,111,155,.15)', 'rgba(239,111,155,.05)'],
    fertile: ['#ef9a3a', '#ffeeda', '#a55f0c', 'rgba(239,154,58,.16)', 'rgba(239,154,58,.05)'],
    luteal: ['#9d63d4', '#f0e4fb', '#6a2fa0', 'rgba(157,99,212,.15)', 'rgba(157,99,212,.05)'],
    pms: ['#7268e8', '#e6e4fd', '#4038a8', 'rgba(114,104,232,.15)', 'rgba(114,104,232,.05)'],
    due: ['#f43c62', '#ffdde3', '#b3163a', 'rgba(244,60,98,.18)', 'rgba(244,60,98,.06)'],
    late: ['#8f86c4', '#eceaf7', '#5d548f', 'rgba(143,134,196,.14)', 'rgba(143,134,196,.05)'],
    overdue: ['#98a0b5', '#eceef3', '#5c6478', 'rgba(152,160,181,.14)', 'rgba(152,160,181,.05)'],
    none: ['#b0b6c6', '#f1f3f7', '#6f7686', 'rgba(176,182,198,.1)', 'rgba(176,182,198,.04)']
  };

  /* ── one animated icon per phase ─────────────────────────────────────── */
  var ICON = {
    menstrual: '<svg viewBox="0 0 48 48" fill="currentColor">'
      + '<circle class="cyi-rip" cx="24" cy="31" r="10" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".5"/>'
      + '<path class="cyi-drop" d="M24 6 C31.5 19 34 23.5 34 29.5 a10 10 0 0 1-20 0 C14 23.5 16.5 19 24 6Z"/></svg>',
    follicular: '<svg viewBox="0 0 48 48" fill="currentColor"><g class="cyi-sway">'
      + '<path d="M22.6 42 V19 h2.8 V42Z"/>'
      + '<path d="M24 24 C16 22 12.5 16.5 14 10.5 C21 11 24 16.5 24 24Z"/>'
      + '<path d="M24 28 C32 26 35.5 20.5 34 14.5 C27 15 24 20.5 24 28Z" opacity=".6"/></g></svg>',
    fertile: '<svg viewBox="0 0 48 48" fill="currentColor"><g class="cyi-rays">'
      + [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) {
        return '<ellipse cx="24" cy="9" rx="3.4" ry="7.6" opacity=".55" transform="rotate(' + a + ' 24 24)"/>';
      }).join('') + '</g><circle class="cyi-pulse" cx="24" cy="24" r="7"/></svg>',
    luteal: '<svg viewBox="0 0 48 48" fill="currentColor"><g class="cyi-tilt">'
      + '<path d="M31 7 a18 18 0 1 0 0 34 A22 22 0 0 1 31 7Z"/></g></svg>',
    pms: '<svg viewBox="0 0 48 48" fill="currentColor">'
      + '<circle cx="24" cy="11" r="5.6" opacity=".5"/>'
      + '<ellipse class="cyi-fall" cx="15" cy="26" rx="3.6" ry="5.8"/>'
      + '<ellipse class="cyi-fall" cx="24" cy="30" rx="3.6" ry="5.8" style="animation-delay:1.5s"/>'
      + '<ellipse class="cyi-fall" cx="33" cy="26" rx="3.6" ry="5.8" style="animation-delay:3s"/></svg>',
    due: '<svg viewBox="0 0 48 48" fill="currentColor">'
      + '<circle class="cyi-pulse" cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".35"/>'
      + '<circle class="cyi-pulse" cx="24" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="2" opacity=".6" style="animation-delay:.45s"/>'
      + '<circle class="cyi-pulse" cx="24" cy="24" r="5.4" style="animation-delay:.9s"/></svg>',
    late: '<svg viewBox="0 0 48 48" fill="currentColor">'
      + '<circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="2" opacity=".3"/>'
      + '<g class="cyi-tick"><path d="M23 24 V12 h2 V24Z"/></g>'
      + '<circle cx="24" cy="24" r="2.6"/></svg>',
    overdue: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor"><g class="cyi-pulse">'
      + '<path d="M17.5 17 a6.5 6.5 0 1 1 8.8 6.1 c-1.8 .9-2.3 2-2.3 3.8" stroke-width="3" stroke-linecap="round"/>'
      + '<circle cx="24" cy="34" r="2.4" fill="currentColor" stroke="none"/></g></svg>',
    none: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor">'
      + '<line class="cyi-pulse" x1="14" y1="24" x2="34" y2="24" stroke-width="3" stroke-linecap="round"/></svg>'
  };

  /* ═══════════════════ Firestore ═══════════════════ */
  function boot() {
    if (boot._on) return; boot._on = true;
    var u = window.__parvritiUser;
    if (!u) { location.replace('index.html'); return; }
    try { db = firebase.firestore(); } catch (e) { fail('Firestore did not load.'); return; }

    /* Visibility curtain (Settings → Visibility). Default: Parv sees it, Riti
       does not. A URL must not open for anyone the matrix hides. Not a wall:
       the file is public and the rules let all three read; the per-page JS is
       the second lock. Also pulls the admin-tunable cycle numbers (bounds-
       checked) before the first render, else the built-in defaults. */
    db.collection('settings').doc('app').get().then(function (s) {
      var v = s.exists ? (s.data() || {}) : {};
      var canSee = u.person === 'parv' ? (v.v_periods_parv !== false) : (v.v_periods_riti === true);
      if (!canSee) { location.replace('index.html'); return; }
      // Full control for whoever can see the tab: Parv always, and Riti once she turns
      // Periods on for herself in Settings. The Firestore `cycle` rules allow either of
      // them to write (ok()), so her log/edit/delete now work instead of just erroring.
      canEdit = true;
      if (typeof v.cyLen === 'number' && v.cyLen >= 18 && v.cyLen <= 45) EXPECT = Math.round(v.cyLen);
      if (typeof v.cyFlagAt === 'number' && v.cyFlagAt >= 35 && v.cyFlagAt <= 90) FLAG_AT = Math.round(v.cyFlagAt);
      if (typeof v.cyDefaultLen === 'number' && v.cyDefaultLen >= 1 && v.cyDefaultLen <= 12) DEFAULT_LEN = Math.round(v.cyDefaultLen);
      watchCycle();
    }).catch(function () {
      if (u.person !== 'parv') { location.replace('index.html'); return; }   // safe default on read failure
      canEdit = true;   // only Parv reaches here
      watchCycle();
    });
  }
  function watchCycle() {
    db.collection('cycle').orderBy('start').onSnapshot(function (snap) {
      LOGS = [];
      snap.forEach(function (doc) {
        var v = doc.data() || {};
        /* Reject anything malformed rather than trusting it. A bad `start`
           (hand-edited in the console, a broken seed) would otherwise become
           an Invalid Date and turn every derived statistic into NaN silently. */
        /* the doc id is later handed straight back to .doc() for delete and
           move, so refuse anything that is not a plain date-shaped id */
        if (typeof doc.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.id)) return;
        if (typeof v.start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.start)) return;
        var st = d(v.start);
        /* round-trip, not just isNaN: new Date(2026,12,45) is a VALID date,
           JS quietly rolls it over to Feb 2027. Comparing back to the string
           is the only way to reject an impossible date like 2026-13-45. */
        if (isNaN(st.getTime()) || iso(st) !== v.start) return;
        LOGS.push({
          id: doc.id, start: st,
          len: (typeof v.len === 'number' && v.len > 0 && v.len < 15) ? Math.round(v.len) : DEFAULT_LEN,
          longOk: !!v.longOk
        });
      });
      recompute(); ready = true;
      arrive();
    }, function () { fail('Could not read her history.'); });
  }
  function fail(msg) {
    ready = true; LOGS = []; recompute(); render(true);
    toast(msg);
  }

  function saveLog(startDate, len, longOk) {
    if (!db) return Promise.reject();
    var id = iso(startDate);
    var FV = firebase.firestore.FieldValue;
    return db.collection('cycle').doc(id).set({
      start: id, len: len || DEFAULT_LEN, longOk: !!longOk,
      by: ((window.__parvritiUser && window.__parvritiUser.person) || 'parv'), createdAt: FV.serverTimestamp(), editedAt: FV.serverTimestamp()
    }, { merge: true });
  }
  function patchLog(id, fields) {
    if (!db) return Promise.reject();
    fields.editedAt = firebase.firestore.FieldValue.serverTimestamp();
    return db.collection('cycle').doc(id).set(fields, { merge: true });
  }
  function deleteLog(id) {
    if (!db) return Promise.reject();
    return db.collection('cycle').doc(id).delete();
  }
  /* moving a start means a new doc id, so it is a delete plus a create */
  function moveLog(oldId, newStart, len, longOk) {
    return saveLog(newStart, len, longOk).then(function () {
      if (iso(newStart) !== oldId) return deleteLog(oldId);
    });
  }

  /* ═══════════════════ small helpers ═══════════════════ */
  var $ = function (id) { return document.getElementById(id); };
  function toast(m) {
    var t = $('cyToast'); if (!t) return;
    clearTimeout(toastUndo._t); t.classList.remove('has-undo');
    t.textContent = m; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  /* like toast(), but with a 5-second Undo, so a mis-tap delete is recoverable */
  function toastUndo(m, undoFn) {
    var t = $('cyToast'); if (!t) return;
    clearTimeout(toast._t); clearTimeout(toastUndo._t);
    t.innerHTML = '<span class="cyt-msg"></span><button type="button" class="cyt-undo">Undo</button>';
    t.querySelector('.cyt-msg').textContent = m;
    t.classList.add('show', 'has-undo');
    var used = false;
    t.querySelector('.cyt-undo').onclick = function () {
      if (used) return; used = true;
      clearTimeout(toastUndo._t);
      t.classList.remove('show', 'has-undo');
      if (undoFn) undoFn();
    };
    toastUndo._t = setTimeout(function () { t.classList.remove('show', 'has-undo'); }, 5000);
  }
  function loggedDays() {
    var set = {};
    for (var i = 0; i < LOGS.length; i++)
      for (var k = 0; k < LOGS[i].len; k++) set[iso(addD(LOGS[i].start, k))] = (k === 0 ? 'start' : 'in');
    return set;
  }
  function cycleDay() {
    if (!lastStart) return 0;
    return diffD(today(), lastStart) + 1;
  }

  /* ═══════════════════ render ═══════════════════ */
  var washFlip = false, lastPh = null, shownDay = null, iconPh = null;   // shownDay null so the first render always paints; then only re-tween on a real change

  function paintLook(ph, instant) {
    var L = LOOK[ph];
    var inc = washFlip ? $('cyWashA') : $('cyWashB');
    var out = washFlip ? $('cyWashB') : $('cyWashA');
    if (instant) { inc.style.transition = 'none'; out.style.transition = 'none'; }
    inc.style.background =
      'radial-gradient(120% 54% at 50% 0%, ' + L[3] + ' 0%, rgba(10,4,6,0) 62%),' +
      'radial-gradient(100% 46% at 50% 100%, ' + L[4] + ' 0%, rgba(10,4,6,0) 70%)';
    inc.classList.add('on'); out.classList.remove('on'); washFlip = !washFlip;
    if (instant) requestAnimationFrame(function () { inc.style.transition = ''; out.style.transition = ''; });
    var b = document.body;
    b.style.setProperty('--cy-accent', L[0]);
    b.style.setProperty('--cy-soft', L[1]);
    b.style.setProperty('--cy-deep', L[2]);
    $('cyGA').setAttribute('stop-color', L[1]);
    $('cyGB').setAttribute('stop-color', L[0]);
  }

  function tweenDay(from, to) {
    var el = $('cyDayNum');
    if (!to) { el.textContent = '?'; return; }
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    var t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / 900), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function renderWeek(centre, isNone) {
    var logged = loggedDays();
    var pf = lastStart ? addD(lastStart, EXPECT - RANGE - 1) : null;
    var pt = lastStart ? addD(lastStart, EXPECT + RANGE - 1) : null;
    var html = '';
    for (var off = -4; off <= 4; off++) {
      var dt = addD(centre, off), k = iso(dt), cls = ['cy-wd'];
      if (logged[k]) cls.push('per');
      else if (pf && dt >= pf && dt <= pt) cls.push('pred');
      if (off === 0 && !isNone) cls.push('sel');
      if (Math.abs(off) === 4) cls.push('dim');
      html += '<div class="' + cls.join(' ') + '"><div class="l">' + DOWL[dt.getDay()] + '</div>'
        + '<div class="n">' + dt.getDate() + '</div><div class="dot"></div></div>';
    }
    $('cyWeek').innerHTML = html;
  }

  /* the centre phase glyph. Cross-fade the old icon into the new (two stacked layers)
     instead of a hard innerHTML swap that popped/twitched. animate=false just seats an
     icon with no transition (first paint, and the arrival's opening phase). Self-guards
     on no-change, so repeated snapshots never re-trigger it. */
  function setPhaseIcon(ph, animate) {
    var host = $('cyPhIcon');
    if (iconPh === ph && host.firstChild) return;
    var layer = document.createElement('div');
    layer.className = 'cy-phlayer';
    layer.innerHTML = ICON[ph];
    var old = host.firstChild;
    if (!animate) {
      host.innerHTML = '';
      host.appendChild(layer);
    } else {
      layer.classList.add('cy-in');
      host.appendChild(layer);
      if (old) {
        old.classList.remove('cy-in');
        old.classList.add('cy-out');
        (function (dead) {
          setTimeout(function () { if (dead.parentNode === host) host.removeChild(dead); }, 820);
        })(old);
      }
    }
    iconPh = ph;
  }

  function render(animateIcon) {
    var day = cycleDay();
    var isNone = (!LOGS.length || day < 1);
    var ph = isNone ? 'none' : phaseFor(day);
    var changed = (ph !== lastPh) || animateIcon;
    lastPh = ph;

    paintLook(ph, false);

    $('cyDate').textContent = longDate(today());
    $('cySub').innerHTML = isNone
      ? 'nothing logged yet'
      : 'She is on <b>day ' + day + '</b> of her cycle.';
    renderWeek(today(), isNone);

    var pct = isNone ? 0 : Math.max(0, Math.min(100, Math.min(day, RING_DAYS) / RING_DAYS * 100));
    $('cyProg').style.strokeDasharray = pct.toFixed(2) + ' 100';
    var kn = $('cyKnob');
    kn.style.opacity = isNone ? '0' : '1';
    kn.style.transform = 'rotate(' + (pct * 3.6).toFixed(2) + 'deg)';

    $('cyPhName').textContent = PHNAME[ph];
    $('cyDayCap').textContent = isNone ? '' : 'cycle day';
    if (day !== shownDay) { tweenDay(shownDay, day); shownDay = day || shownDay; }   // only pop/tween when the day actually changed (was popping on every snapshot)
    setPhaseIcon(ph, changed);
    if (changed) {
      var pn = $('cyPhName');
      pn.classList.remove('enter'); void pn.offsetWidth; pn.classList.add('enter');
    }

    if (isNone) {
      $('cyRange').textContent = 'not yet';
      $('cyAway').textContent = 'one start date is all it needs';
      $('cyIn').textContent = '?'; $('cyInLbl').textContent = 'days';
    } else {
      $('cyRange').textContent = fmt(addD(lastStart, EXPECT - RANGE - 1)) + ' to ' + fmt(addD(lastStart, EXPECT + RANGE - 1));
      $('cyAway').textContent = 'a ' + (RANGE * 2 + 1) + ' day window, not a date';
      var away = EXPECT - day;
      if (day > LONGEST) { $('cyIn').textContent = (day - EXPECT); $('cyInLbl').textContent = 'days over'; }
      else if (away > RANGE) { $('cyIn').textContent = away; $('cyInLbl').textContent = 'days away'; }
      else if (away < -RANGE) { $('cyIn').textContent = (-away); $('cyInLbl').textContent = 'days long'; }
      else { $('cyIn').textContent = 'now'; $('cyInLbl').textContent = 'any day'; }
    }

    var lv = levelsFor(ph, day), mets = document.querySelectorAll('.cy-met');
    for (var r = 0; r < mets.length; r++) {
      var v = lv[ROWS[r].k];
      var pips = mets[r].querySelectorAll('.cy-pips i');
      for (var p = 0; p < 4; p++) {
        pips[p].className = (v > 0 && p < v) ? 'on' : '';
        pips[p].style.transitionDelay = (r * 70 + p * 80) + 'ms';
      }
      var val = mets[r].querySelector('.cy-mval');
      val.textContent = WORD[String(v)]; val.className = 'cy-mval' + (v < 0 ? ' q' : '');
    }
    $('cyHint').textContent = HINT[ph];
  }

  /* the arrival: if her phase moved on since he last looked, open wearing the
     old phase and animate the whole page across to the new one */
  function staggerIn() {
    var els = document.querySelectorAll('.cy-rise');
    for (var i = 0; i < els.length; i++)
      (function (el, n) { setTimeout(function () { el.classList.add('in'); }, 70 + n * 110); })(els[i], +els[i].dataset.r);
  }
  function arrive() {
    var day = cycleDay();
    var now = (!LOGS.length || day < 1) ? 'none' : phaseFor(day);
    var prev = null;
    try { prev = localStorage.getItem('cyclePhaseSeen'); } catch (e) {}
    if (!arrive._done && prev && prev !== now && LOOK[prev]) {
      arrive._done = true;
      lastPh = prev;
      paintLook(prev, true);
      setPhaseIcon(prev, false);
      $('cyPhName').textContent = PHNAME[prev];
      staggerIn();
      setTimeout(function () { render(true); toast('new phase since you last looked'); }, 1150);
    } else {
      /* animate the icon on the first paint only. Passing true here meant the
         icon popped again on every snapshot, so it twitched after each write. */
      var first = !arrive._done;
      render(first);
      if (first) { arrive._done = true; staggerIn(); }
    }
    try { localStorage.setItem('cyclePhaseSeen', now); } catch (e) {}
    refreshPanels();
  }

  /* ═══════════════════ the log button ═══════════════════ */
  (function () {
    var fab = $('cyFab'), prog = $('cyFrProg'), rip = $('cyRip');
    var held = false, timer = null, swell = null;

    /* inline style, NOT setAttribute: a CSS stroke-dasharray declaration would
       beat the attribute and the sweep would never move */
    function startRing() {
      prog.classList.remove('rst');
      prog.style.strokeDasharray = '0 100';
      void prog.getBoundingClientRect();
      prog.classList.add('go');
      prog.style.strokeDasharray = '100 100';
    }
    function resetRing() { prog.classList.remove('go'); prog.classList.add('rst'); prog.style.strokeDasharray = '0 100'; }
    function clearBtn() { clearTimeout(timer); clearTimeout(swell); fab.classList.remove('press', 'held'); }

    fab.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      held = false;
      fab.classList.add('press');
      swell = setTimeout(function () { fab.classList.remove('press'); fab.classList.add('held'); }, 130);
      startRing();
      timer = setTimeout(function () {
        held = true;
        if (window.parvritiHaptic) window.parvritiHaptic();
        clearBtn(); resetRing();
        openPick(today(), 'add', null);
      }, 760);
    });
    fab.addEventListener('pointerup', function () {
      var was = held; clearBtn(); resetRing();
      if (was) return;
      rip.classList.remove('go'); void rip.offsetWidth; rip.classList.add('go');
      var t = today();
      for (var i = 0; i < LOGS.length; i++) if (iso(LOGS[i].start) === iso(t)) { toast('today is already logged'); return; }
      if (inSpan(t)) { toast('today falls inside a logged period'); return; }
      if (window.parvritiHaptic) window.parvritiHaptic();
      saveLog(t, DEFAULT_LEN, false).then(function () {
        toastUndo('Period logged 🌸', function () {
          deleteLog(iso(t)).then(function () { toast('undone'); }).catch(function () { toast('could not undo'); });
        });
      }).catch(function () { toast('could not save'); });
    });
    fab.addEventListener('pointerleave', function () { if (!held) { clearBtn(); resetRing(); } });
    fab.addEventListener('pointercancel', function () { clearBtn(); resetRing(); });
  })();

  /* ═══════════════════ pick a date ═══════════════════ */
  var pkMonth = null, pkSel = null, pkMode = 'add', pkEditId = null;
  function openPick(seed, mode, id) {
    pkMode = mode || 'add'; pkEditId = id || null; pkSel = null;
    pkMonth = new Date(seed.getFullYear(), seed.getMonth(), 1);
    drawPick(); $('cyPick').classList.add('show'); document.body.classList.add('cy-locked');
  }
  function closePick() {
    $('cyPick').classList.remove('show');
    if (!$('cyEdit').classList.contains('show') && !$('cyDrawer').classList.contains('open'))
      document.body.classList.remove('cy-locked');
  }
  function drawPick() {
    var dow = $('cyPickDow');
    if (!dow.children.length) dow.innerHTML = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (x) { return '<span>' + x + '</span>'; }).join('');
    $('cyPickMo').textContent = MONTHS[pkMonth.getMonth()] + ' ' + pkMonth.getFullYear();
    var logged = loggedDays(), T = today();
    var first = new Date(pkMonth.getFullYear(), pkMonth.getMonth(), 1);
    var lead = (first.getDay() + 6) % 7;
    var dim = new Date(pkMonth.getFullYear(), pkMonth.getMonth() + 1, 0).getDate();
    var html = '';
    for (var i = 0; i < lead; i++) html += '<button type="button" class="pad" tabindex="-1"></button>';
    for (var n = 1; n <= dim; n++) {
      var dt = new Date(pkMonth.getFullYear(), pkMonth.getMonth(), n);
      var k = iso(dt), cls = [], future = (dt > T);
      if (logged[k] === 'start') cls.push('logged', 'start');
      else if (logged[k] === 'in') cls.push('logged');
      if (k === iso(T)) cls.push('today');
      if (pkSel && k === iso(pkSel)) cls.push('sel');
      html += '<button type="button" data-k="' + k + '"' + (future ? ' disabled' : '') + ' class="' + cls.join(' ') + '">' + n + '</button>';
    }
    $('cyPickGrid').innerHTML = html;
    /* forward is capped at this month (a period cannot start in the future);
       back is deliberately uncapped, so an older period can be backfilled */
    $('cyPickNext').disabled = (pkMonth.getFullYear() === T.getFullYear() && pkMonth.getMonth() === T.getMonth());
    $('cyPickPrev').disabled = false;
    $('cyPicked').textContent = pkSel ? longDate(pkSel) : 'pick the first day of bleeding';
    $('cyPickSave').disabled = !pkSel;
  }
  (function () {
    function step(n) { pkMonth = new Date(pkMonth.getFullYear(), pkMonth.getMonth() + n, 1); drawPick(); }
    $('cyPickPrev').addEventListener('click', function () { step(-1); });
    $('cyPickNext').addEventListener('click', function () { step(1); });
    $('cyPickCancel').addEventListener('click', closePick);
    $('cyPick').addEventListener('click', function (e) { if (e.target === this) closePick(); });
    $('cyPickGrid').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || b.disabled || !b.dataset.k) return;
      pkSel = d(b.dataset.k); drawPick();
    });
    $('cyPickSave').addEventListener('click', function () {
      if (!pkSel) return;
      var picked = pkSel;
      for (var i = 0; i < LOGS.length; i++)
        if (iso(LOGS[i].start) === iso(picked) && LOGS[i].id !== pkEditId) { toast(fmt(picked) + ' is already logged'); return; }
      if (inSpan(picked, pkEditId)) { toast(fmt(picked) + ' falls inside a logged period'); return; }
      if (pkMode === 'edit' && pkEditId) {
        var L = findLog(pkEditId); if (!L) { closePick(); return; }
        moveLog(pkEditId, picked, L.len, L.longOk).then(function () {
          closePick(); closeEdit(); toast('moved to ' + fmt(picked));
        }).catch(function () { toast('could not save'); });
      } else {
        saveLog(picked, DEFAULT_LEN, false).then(function () {
          closePick(); toast('logged ' + fmt(picked));
        }).catch(function () { toast('could not save'); });
      }
    });
  })();

  function findLog(id) { for (var i = 0; i < LOGS.length; i++) if (LOGS[i].id === id) return LOGS[i]; return null; }
  // true if date t falls INSIDE an already-logged period's span (day 2..len); she's already
  // bleeding per that log, so a new "start" there would fabricate a bogus short cycle. The exact
  // start day is caught separately by the "already logged" guard, so we only check days 1..len-1.
  function inSpan(t, exceptId) {
    var ts = iso(t);
    for (var i = 0; i < LOGS.length; i++) {
      var L = LOGS[i];
      if (exceptId && L.id === exceptId) continue;
      var len = L.len || DEFAULT_LEN;
      for (var k = 1; k < len; k++) if (iso(addD(L.start, k)) === ts) return true;
    }
    return false;
  }
  function findIdx(id) { for (var i = 0; i < LOGS.length; i++) if (LOGS[i].id === id) return i; return -1; }

  /* ═══════════════════ phase calendar ═══════════════════ */
  var PC_ORDER = ['menstrual', 'follicular', 'fertile', 'luteal', 'pms', 'due', 'late'];
  var PC_FADE = [1, .72, .52, .4, .32];
  var pcMonth = null, pcPick = null;

  function phaseAt(dt) {
    if (!LOGS.length || dt < LOGS[0].start) return null;
    var T = today();
    if (dt <= T) {
      for (var i = LOGS.length - 1; i >= 0; i--) {
        if (dt >= LOGS[i].start) {
          var day = diffD(dt, LOGS[i].start) + 1, len = LOGS[i].len;
          return { day: day, ph: phaseFor(day, len), proj: 0, bleed: (day <= len) };
        }
      }
      return null;
    }
    var dayN = diffD(dt, lastStart) + 1, k = 0, step = Math.max(1, EXPECT);
    while (dayN > step) { dayN -= step; k++; }
    var l2 = curLen();
    return { day: dayN, ph: phaseFor(dayN, l2), proj: k, bleed: (dayN <= l2) };
  }

  function openCal() {
    var T = today();
    pcMonth = new Date(T.getFullYear(), T.getMonth(), 1); pcPick = T;
    drawCal(); $('cyCal').classList.add('show'); document.body.classList.add('cy-locked');
  }
  function closeCal() {
    $('cyCal').classList.remove('show');
    if (!$('cyDrawer').classList.contains('open')) document.body.classList.remove('cy-locked');
  }
  function calDetail(dt) {
    var el = $('cyCalDet'), info = phaseAt(dt);
    if (!info) {
      el.innerHTML = '<div class="dh">' + longDate(dt) + '</div>'
        + '<div class="dx">Before her records start, so there is nothing to go on.</div>';
      return;
    }
    var L = LOOK[info.ph];
    el.innerHTML = '<div class="dh">' + dt.toLocaleDateString('en-GB', { weekday: 'long' }) + ', ' + longDate(dt) + '</div>'
      + '<div class="dp" style="color:' + L[0] + '">' + (info.proj ? 'projected ' : '') + PHNAME[info.ph] + ' · day ' + info.day + '</div>'
      + '<div class="dx">' + HINT[info.ph]
      + (info.proj ? (' <b>This is ' + info.proj + ' cycle' + (info.proj > 1 ? 's' : '')
        + ' ahead, so it could easily be ' + (info.proj * RANGE + RANGE) + ' days out either way.</b>') : '')
      + '</div>';
  }
  function drawCal() {
    var dow = $('cyCalDow');
    if (!dow.children.length) dow.innerHTML = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (x) { return '<span>' + x + '</span>'; }).join('');
    $('cyCalMo').textContent = MONTHS[pcMonth.getMonth()] + ' ' + pcMonth.getFullYear();
    var T = today();
    var first = new Date(pcMonth.getFullYear(), pcMonth.getMonth(), 1);
    var lead = (first.getDay() + 6) % 7;
    var dim = new Date(pcMonth.getFullYear(), pcMonth.getMonth() + 1, 0).getDate();
    var html = '';
    for (var i = 0; i < lead; i++) html += '<button type="button" class="pad" tabindex="-1"></button>';
    for (var n = 1; n <= dim; n++) {
      var dt = new Date(pcMonth.getFullYear(), pcMonth.getMonth(), n);
      var info = phaseAt(dt), cls = [], sty = '';
      if (info) {
        var L = LOOK[info.ph], fade = PC_FADE[Math.min(info.proj, PC_FADE.length - 1)];
        sty = '--cbg:' + L[1] + ';--cdot:' + L[0] + ';opacity:' + fade + ';';
        if (info.bleed) cls.push('bleed');
      } else cls.push('out');
      if (iso(dt) === iso(T)) cls.push('today');
      if (pcPick && iso(dt) === iso(pcPick)) cls.push('pick');
      html += '<button type="button" data-k="' + iso(dt) + '" class="' + cls.join(' ') + '" style="' + sty + '">'
        + '<span>' + n + '</span><span class="pd"></span></button>';
    }
    $('cyCalGrid').innerHTML = html;
    $('cyCalLegend').innerHTML = PC_ORDER.map(function (p) {
      return '<span><i style="background:' + LOOK[p][0] + '"></i>' + PHNAME[p] + '</span>';
    }).join('');
    $('cyCalNote').textContent =
      'A bar instead of a dot means bleeding days. Past months come from what was actually logged. '
      + 'Future months repeat her typical ' + EXPECT + ' day cycle and fade the further out they go, '
      + 'because a start date that moves by a few days shifts everything after it.';
    if (pcPick) calDetail(pcPick);
  }
  (function () {
    function step(n) { pcMonth = new Date(pcMonth.getFullYear(), pcMonth.getMonth() + n, 1); drawCal(); }
    $('cyCalBtn').addEventListener('click', openCal);
    $('cyCalPrev').addEventListener('click', function () { step(-1); });
    $('cyCalNext').addEventListener('click', function () { step(1); });
    $('cyCalNow').addEventListener('click', function () {
      var T = today(); pcMonth = new Date(T.getFullYear(), T.getMonth(), 1); pcPick = T; drawCal();
    });
    $('cyCalClose').addEventListener('click', closeCal);
    $('cyCal').addEventListener('click', function (e) { if (e.target === this) closeCal(); });
    $('cyCalGrid').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !b.dataset.k) return;
      pcPick = d(b.dataset.k); drawCal();
    });
  })();

  /* ═══════════════════ history drawer ═══════════════════ */
  function buildPeriods() {
    var out = [], T = today();
    for (var i = 0; i < LOGS.length; i++) {
      var L = LOGS[i], s = L.start, e = addD(s, L.len - 1), cyc, running = false;
      if (i < LOGS.length - 1) cyc = cycleLen(i);
      else { cyc = diffD(T, s) + 1; running = true; }
      out.push({
        id: L.id, start: s, end: e, days: L.len, cyc: cyc, running: running,
        gap: (!running && cyc >= FLAG_AT && !L.longOk), longOk: L.longOk,
        hay: [ord(s.getDate()), s.getDate(), SHORTM[s.getMonth()], MONTHS[s.getMonth()],
          s.getFullYear(), iso(s), L.len + ' days'].join(' ').toLowerCase()
      });
    }
    return out.reverse();
  }
  function refreshPanels() {
    if (!ready) return;
    var P = buildPeriods();
    if (LOGS.length) {
      var f = LOGS[0].start, l = LOGS[LOGS.length - 1].start;
      $('cyDrSub').textContent = 'every period logged, ' + SHORTM[f.getMonth()] + ' ' + f.getFullYear()
        + ' to ' + SHORTM[l.getMonth()] + ' ' + l.getFullYear();
    } else $('cyDrSub').textContent = 'nothing logged yet';
    $('cyDrStats').innerHTML =
      '<div class="cy-dst"><b>' + P.length + '</b><span>logged</span></div>'
      + '<div class="cy-dst"><b>' + SHORTEST + '</b><span>shortest</span></div>'
      + '<div class="cy-dst"><b>' + EXPECT + '</b><span>typical</span></div>'
      + '<div class="cy-dst"><b>' + LONGEST_EVER + '</b><span>longest</span></div>';
    renderHistory(P, $('cyDrQ').value);
    /* Anything already on screen must be redrawn from the new snapshot, or it
       keeps showing pre-edit values. The edit sheet is the one that bit: change
       a length and the segmented control still highlighted the old number until
       it was closed and reopened. */
    if ($('cyCal').classList.contains('show')) drawCal();
    if ($('cyPick').classList.contains('show')) drawPick();
    if (edId && $('cyEdit').classList.contains('show')) openEdit(edId);
  }
  function renderHistory(P, q) {
    var toks = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    var rows = P.filter(function (p) {
      for (var t = 0; t < toks.length; t++) if (p.hay.indexOf(toks[t]) === -1) return false;
      return true;
    });
    var el = $('cyDrList');
    if (!rows.length) { el.innerHTML = '<div class="cy-drnone">' + (P.length ? 'nothing matches that' : 'nothing logged yet') + '</div>'; return; }
    var html = '', yr = null, n = 0;
    rows.forEach(function (p) {
      var y = p.start.getFullYear();
      if (y !== yr) { yr = y; html += '<div class="cy-yr">' + y + '</div>'; }
      var cls = p.running ? 'run' : (p.gap ? 'warn' : '');
      html += '<div class="cy-prow' + (p.gap ? ' flagged' : '') + '" data-id="' + esc(p.id) + '"'
        + ' style="animation-delay:' + (n * 24) + 'ms">'
        + '<div class="st">' + ord(p.start.getDate()) + ' ' + SHORTM[p.start.getMonth()]
        + (p.running ? '<em>now</em>' : '') + (p.longOk ? '<em>long</em>' : '')
        + (p.gap ? '<br><span class="cy-chip">missed period?</span>' : '') + '</div>'
        + '<div class="en">' + ord(p.end.getDate()) + ' ' + SHORTM[p.end.getMonth()] + '</div>'
        + '<div class="dy">' + p.days + '</div>'
        + '<div class="cy ' + cls + '">' + (p.running ? ('d' + p.cyc) : (p.cyc + 'd')) + '</div></div>';
      n++;
    });
    html += '<div class="cy-drfoot">'
      + (canEdit ? '<b>Press and hold any row to edit it</b>, to fix the start date, change how many days it lasted, or tell it a long gap was real.<br><br>' : '')
      + 'Cycle is the gap to the next start, so the newest row counts from today. '
      + 'Anything ' + FLAG_AT + ' days or more is flagged as a possible missed period.</div>';
    el.innerHTML = html;
  }
  (function () {
    var dr = $('cyDrawer'), sc = $('cyScrim');
    function open() { refreshPanels(); dr.classList.add('open'); sc.classList.add('open'); document.body.classList.add('cy-locked'); }
    function close() { dr.classList.remove('open'); sc.classList.remove('open'); document.body.classList.remove('cy-locked'); }
    $('cyHistBtn').addEventListener('click', open);
    $('cyDrX').addEventListener('click', close);
    sc.addEventListener('click', close);
    $('cyDrQ').addEventListener('input', function () { renderHistory(buildPeriods(), this.value); });
  })();

  /* ═══════════════════ edit a logged period ═══════════════════ */
  var edId = null;
  function openEdit(id) {
    var i = findIdx(id); if (i < 0) return;
    edId = id;
    var L = LOGS[i], cyc = cycleLen(i);
    $('cyEdDate').textContent = longDate(L.start);
    $('cyEdMeta').textContent =
      (cyc === null ? 'her current cycle, day ' + (diffD(today(), L.start) + 1)
        : 'the cycle that followed ran ' + cyc + ' days')
      + ' · ended ' + fmt(addD(L.start, L.len - 1));
    $('cyEdStart').textContent = fmt(L.start) + ' ' + L.start.getFullYear();
    $('cyEdSeg').innerHTML = [3, 4, 5, 6].map(function (n) {
      return '<button type="button" data-len="' + n + '"' + (n === L.len ? ' class="on"' : '') + '>' + n + '</button>';
    }).join('');

    var wrap = $('cyEdFlagWrap'), ins = $('cyEdInsert');
    if (cyc !== null && cyc >= FLAG_AT && !L.longOk) {
      var n = Math.max(1, Math.round(cyc / EXPECT) - 1);
      $('cyEdFlagText').textContent = 'The gap after this one is ' + cyc + ' days. Either a period went '
        + 'unlogged, or that cycle really was that long. Her longest confirmed cycle is ' + LONGEST_EVER + ' days.';
      if (n > 3) {
        ins.style.display = 'none';
        $('cyEdFlagText').textContent += ' That is too long to reconstruct, it looks like a stretch where nothing was recorded at all.';
      } else {
        ins.style.display = '';
        ins.textContent = 'Add ' + n + ' missed period' + (n > 1 ? 's' : '') + ' in the gap';
        ins.dataset.n = n;
      }
      wrap.style.display = '';
    } else if (cyc !== null && L.longOk) {
      ins.style.display = '';
      $('cyEdFlagText').textContent = 'Marked as a genuinely long cycle (' + cyc + ' days), so it counts towards her range.';
      ins.textContent = 'Actually, a period was missed';
      ins.dataset.n = 'undo';
      wrap.style.display = '';
    } else wrap.style.display = 'none';

    $('cyEdDel').disabled = (LOGS.length < 2);
    $('cyEdit').classList.add('show');
    document.body.classList.add('cy-locked');
  }
  function closeEdit() {
    $('cyEdit').classList.remove('show'); edId = null;
    if (!$('cyDrawer').classList.contains('open')) document.body.classList.remove('cy-locked');
  }
  (function () {
    $('cyEdDone').addEventListener('click', closeEdit);
    $('cyEdit').addEventListener('click', function (e) { if (e.target === this) closeEdit(); });
    $('cyEdSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !edId) return;
      var id = edId;
      patchLog(id, { len: +b.dataset.len }).then(function () {
        toast('lasted ' + b.dataset.len + ' days'); openEdit(id);
      }).catch(function () { toast('could not save'); });
    });
    $('cyEdChange').addEventListener('click', function () {
      var L = findLog(edId); if (!L) return;
      openPick(L.start, 'edit', L.id);
    });
    $('cyEdKeep').addEventListener('click', function () {
      var id = edId; if (!id) return;
      patchLog(id, { longOk: true }).then(function () {
        toast('counted as a real long cycle'); openEdit(id);
      }).catch(function () { toast('could not save'); });
    });
    $('cyEdInsert').addEventListener('click', function () {
      var id = edId, i = findIdx(id); if (i < 0) return;
      if (this.dataset.n === 'undo') {
        patchLog(id, { longOk: false }).then(function () { toast('flagged again'); openEdit(id); });
        return;
      }
      var n = +this.dataset.n, cyc = cycleLen(i), start = LOGS[i].start;
      if (!cyc) return;
      var step = cyc / (n + 1), jobs = [];
      for (var k = 1; k <= n; k++) jobs.push(saveLog(addD(start, Math.round(k * step)), DEFAULT_LEN, false));
      Promise.all(jobs).then(function () {
        toast('added ' + n + ' estimated start' + (n > 1 ? 's' : '')); openEdit(id);
      }).catch(function () { toast('could not save'); });
    });
    $('cyEdDel').addEventListener('click', function () {
      var id = edId, L = findLog(id); if (!L || LOGS.length < 2) return;
      var snap = { start: L.start, len: L.len, longOk: L.longOk };   // keep it to restore on Undo
      deleteLog(id).then(function () {
        closeEdit();
        toastUndo('Period removed', function () {
          saveLog(snap.start, snap.len, snap.longOk).then(function () { toast('brought it back'); }).catch(function () { toast('could not undo'); });
        });
      }).catch(function () { toast('could not remove'); });
    });

    /* press and hold a row. Delegated so it survives every re-render. */
    var pT = null, pRow = null, pY = 0;
    function cancel() { clearTimeout(pT); if (pRow) { pRow.classList.remove('pressing'); pRow = null; } }
    var list = $('cyDrList');
    list.addEventListener('pointerdown', function (e) {
      if (!canEdit) return;   // read-only for Riti — no press-and-hold edit
      var row = e.target.closest('.cy-prow'); if (!row) return;
      pRow = row; pY = e.clientY; row.classList.add('pressing');
      pT = setTimeout(function () { var id = row.dataset.id; cancel(); openEdit(id); }, 450);
    });
    /* a flick to scroll must not count as a hold: the scroll event alone is
       not enough, a small drag moves the finger before the list scrolls */
    list.addEventListener('pointermove', function (e) { if (pRow && Math.abs(e.clientY - pY) > 8) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { list.addEventListener(ev, cancel); });
    list.addEventListener('scroll', cancel);
  })();

  /* ═══════════════════ CSV export ═══════════════════ */
  $('cyCsv').addEventListener('click', function () {
    var rows = [['start', 'end', 'period_days', 'cycle_length_days', 'note']];
    for (var i = 0; i < LOGS.length; i++) {
      var L = LOGS[i], c = cycleLen(i);
      var note = (c === null) ? 'current cycle'
        : (L.longOk ? 'confirmed long cycle' : (c >= FLAG_AT ? 'possible missed period' : ''));
      rows.push([iso(L.start), iso(addD(L.start, L.len - 1)), L.len, (c === null ? '' : c), note]);
    }
    var csv = rows.map(function (r) {
      return r.map(function (v) {
        v = String(v);
        /* Neutralise spreadsheet formula injection. Nothing we emit today starts
           with one of these, but a cell that did would be executed as a formula
           on open in Excel or Sheets, so guard the shape rather than the data. */
        if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\n');
    try {
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'cycle-history-' + iso(today()) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      toast('exported ' + LOGS.length + ' periods');
    } catch (e) {
      /* iOS can refuse a programmatic download, so fall back to the clipboard */
      if (navigator.clipboard) navigator.clipboard.writeText(csv)
        .then(function () { toast('copied as CSV'); })
        .catch(function () { toast('could not export'); });
      else toast('could not export');
    }
  });

  /* ═══════════════════ start ═══════════════════ */
  $('cyMetrics').innerHTML = ROWS.map(function (R) {
    return '<div class="cy-met" data-k="' + R.k + '" style="--c:' + R.c + '">'
      + '<div class="cy-mic">' + MIC[R.k] + '</div>'
      + '<div class="cy-mlab">' + R.label + '</div>'
      + '<div class="cy-mval"></div>'
      + '<div class="cy-pips"><i></i><i></i><i></i><i></i></div></div>';
  }).join('');

  if (window.__parvritiAuthed) boot();
  else window.addEventListener('parvriti-authed', boot);

  /* the page can sit open past midnight, so re-derive the day on return */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && ready) { render(false); }
  });

  /* Escape closes whatever is on top. Desktop only in practice, but free. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if ($('cyPick').classList.contains('show')) { closePick(); return; }
    if ($('cyEdit').classList.contains('show')) { closeEdit(); return; }
    if ($('cyCal').classList.contains('show')) { closeCal(); return; }
    if ($('cyDrawer').classList.contains('open')) {
      $('cyDrawer').classList.remove('open');
      $('cyScrim').classList.remove('open');
      document.body.classList.remove('cy-locked');
    }
  });
})();
