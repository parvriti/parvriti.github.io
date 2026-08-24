/* =====================================================================
   native.js — the "native app" shell layered on the UNTOUCHED components.
   Additive only; changes no component and no backend.
     · iPhone  → bottom tab bar + frosted corner buttons.
     · iPad/Mac → a LEFT SIDEBAR (nav + Settings + theme toggle).
   Tab visibility is computed with the SAME canSee rules + settings/app doc
   that common.js uses, so each person's restrictions (e.g. Riti's Periods/
   Settings) are preserved exactly. NOTE: canSee below is a deliberate mirror
   of common.js's — keep the two in sync if that logic ever changes.
   ===================================================================== */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement, body = doc.body;

  /* ── theme (head-init applies it pre-paint; this keeps it + wires toggles) ── */
  var THEME_KEY = 'parvritiTheme';
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    var tm = doc.querySelector('meta[name="theme-color"]');
    if (tm) tm.setAttribute('content', t === 'light' ? '#fbf1f1' : '#0a0406');
  }
  var saved = 'dark';
  try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
  applyTheme(saved);   // unconditional: the head-init already set data-theme, but only applyTheme syncs the theme-color meta
  body.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('.proto-toggle, .ps-toggle')) {
      applyTheme(root.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
      return;
    }
    // Any nav link (tab bar / sidebar / corner gear) is an AUTHORIZED entry — sign-in
    // already gated us in, so mark riti_open before it navigates so common.js's inner-page
    // guard doesn't bounce a direct tab tap back to Home (same as the old gear did).
    var link = e.target.closest('.proto-tab, .ps-item, .proto-corner');
    if (link && link.getAttribute('href')) { try { sessionStorage.setItem('riti_open', '1'); } catch (er) {} }
  });

  var page = body.dataset ? (body.dataset.page || '') : (body.getAttribute('data-page') || '');

  /* ── visibility: mirror common.js's canSee + defaults exactly ── */
  var VIS_DEFAULT = {
    openwhen: { riti: true, parv: true }, board: { riti: true, parv: true },
    doodles: { riti: true, parv: true }, periods: { riti: false, parv: true },
    settings: { riti: false, parv: true }
  };
  function canSee(key, who, d) {
    if (key === 'settings' && who === 'parv') return true;
    var v = d && d['v_' + key + '_' + who];
    if (typeof v === 'boolean') return v;
    return !!(VIS_DEFAULT[key] && VIS_DEFAULT[key][who]);
  }
  var PAGES = [
    { p: 'open-when', vis: 'openwhen', href: 'open-when.html', label: 'Letters', ic: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5 12 13l8.5-6.5"/>' },
    { p: 'board', vis: 'board', href: 'board.html', label: 'Board', ic: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M9 9h.01M15 9h.01M9 14h6"/>' },
    { p: 'doodles', vis: 'doodles', href: 'doodles.html', label: 'Doodles', ic: '<path d="M4 20c3-1 4-3 6-7s3-7 5-8"/><path d="M14 5c2 1 3 3 3 6"/><circle cx="19" cy="19" r="2"/>' },
    { p: 'periods', vis: 'periods', href: 'periods.html', label: 'Cycle', ic: '<circle cx="12" cy="13" r="8"/><path d="M12 13V8M12 3v2"/>' }
  ];
  var HOME = { p: 'home', href: 'index.html', label: 'Home', ic: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>' };

  function svg(inner) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'; }
  var GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  var THEME_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3 A9 9 0 0 1 12 21 Z" fill="currentColor" stroke="none"/></svg>';

  function build(items, showSettings) {
    /* bottom tab bar (mobile) */
    var bar = doc.getElementById('protoTabbar');
    if (!bar) { bar = doc.createElement('nav'); bar.id = 'protoTabbar'; bar.className = 'proto-tabbar'; bar.setAttribute('aria-label', 'Main'); body.appendChild(bar); }
    var bh = '';
    for (var i = 0; i < items.length; i++) { var m = items[i]; bh += '<a class="proto-tab' + (m.p === page ? ' on' : '') + '" href="' + m.href + '">' + svg(m.ic) + '<span>' + m.label + '</span></a>'; }
    bar.innerHTML = bh;

    /* left sidebar (iPad/Mac) */
    var side = doc.getElementById('protoSidebar');
    if (!side) { side = doc.createElement('nav'); side.id = 'protoSidebar'; side.className = 'proto-sidebar'; side.setAttribute('aria-label', 'Sidebar'); body.appendChild(side); }
    var sh = '<div class="ps-brand"><span class="ps-flower">🌸</span><span class="ps-name">For Toti</span></div><div class="ps-list">';
    for (var j = 0; j < items.length; j++) { var mm = items[j]; sh += '<a class="ps-item' + (mm.p === page ? ' on' : '') + '" href="' + mm.href + '">' + svg(mm.ic) + '<span>' + mm.label + '</span></a>'; }
    sh += '</div><div class="ps-foot">';
    if (showSettings) sh += '<a class="ps-item' + (page === 'settings' ? ' on' : '') + '" href="settings.html">' + GEAR + '<span>Settings</span></a>';
    sh += '<button class="ps-item ps-toggle" type="button">' + THEME_SVG + '<span>Theme</span></button></div>';
    side.innerHTML = sh;

    /* mobile corner buttons */
    if (page === 'home' && !doc.getElementById('protoToggle')) {
      var tg = doc.createElement('button'); tg.id = 'protoToggle'; tg.className = 'proto-corner proto-toggle proto-left'; tg.type = 'button';
      tg.setAttribute('aria-label', 'Toggle theme'); tg.innerHTML = '<span class="proto-theme-ic">' + THEME_SVG + '</span>'; body.appendChild(tg);
    }
    var cg = doc.getElementById('protoGear');
    if (showSettings && page !== 'settings' && page !== 'periods') {
      if (!cg) { cg = doc.createElement('a'); cg.id = 'protoGear'; cg.className = 'proto-corner proto-right'; cg.href = 'settings.html'; cg.setAttribute('aria-label', 'Settings'); cg.innerHTML = GEAR; body.appendChild(cg); }
    } else if (cg && cg.parentNode) { cg.parentNode.removeChild(cg); }
  }

  function buildFrom(d) {
    var who = (window.__parvritiUser && window.__parvritiUser.person) || 'parv';
    var items = [HOME];
    for (var i = 0; i < PAGES.length; i++) if (canSee(PAGES[i].vis, who, d)) items.push(PAGES[i]);
    build(items, canSee('settings', who, d));
  }

  /* build instantly from defaults (matches common.js), then refine from settings/app */
  function go() {
    // On Home (post sign-in) open the session gate so every nav tap works even before
    // the "Open it" ceremony. Home has no inner-page guard, so this only ever helps.
    if (page === 'home') { try { sessionStorage.setItem('riti_open', '1'); } catch (e) {} }
    buildFrom({});
    try {
      if (typeof firebase !== 'undefined' && firebase.firestore) {
        firebase.firestore().collection('settings').doc('app').get()
          .then(function (s) { buildFrom(s.exists ? (s.data() || {}) : {}); }).catch(function () {});
      }
    } catch (e) {}
  }
  if (window.__parvritiAuthed) go();
  else window.addEventListener('parvriti-authed', go);
})();
