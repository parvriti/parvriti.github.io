/* =====================================================================
   common.js — shared chrome loaded by every page
     · unlock guard  (inner pages require the lock ritual this session)
     · background atmosphere (drifting petals)
     · top navigation (built from one NAV list so it's easy to grow)
   The page identifies itself via <body data-page="…">.
   ===================================================================== */
(function () {
  var body = document.body;
  var page = body.dataset.page || '';

  /* ── unlock guard ──
     The letter/open-when/wedding pages are meant to be reached only after
     the locks on index.html. We remember that per browser session, so a
     fresh visit re-runs the ritual but tab-hopping stays free. */
  if (page && page !== 'home') {
    try {
      if (sessionStorage.getItem('riti_open') !== '1') {
        location.replace('index.html');
        return;
      }
    } catch (e) { /* storage blocked — let them through rather than trap */ }
  }

  /* ── background atmosphere ── */
  (function atmosphere() {
    if (document.querySelector('.bg-base')) return;
    var base = document.createElement('div');
    base.className = 'bg-base';
    body.insertBefore(base, body.firstChild);
    [
      'width:100px;height:68px;background:#c0425a;top:8%;left:-3%;opacity:.05;animation-duration:20s;',
      'width:70px;height:50px;background:#e890a0;top:52%;right:-2%;opacity:.05;animation-duration:24s;animation-delay:-9s;',
      'width:50px;height:35px;background:#f9c6c6;top:25%;left:76%;opacity:.04;animation-duration:17s;animation-delay:-5s;',
      'width:85px;height:60px;background:#8b2040;bottom:15%;left:7%;opacity:.04;animation-duration:28s;animation-delay:-14s;'
    ].forEach(function (s) {
      var p = document.createElement('div');
      p.className = 'bgp';
      p.setAttribute('style', s);
      body.insertBefore(p, base.nextSibling);
    });
  })();

  /* ── top navigation (inner pages only) ──
     Add a page here and it appears in the nav everywhere. */
  var NAV = [
    { href: 'letter.html',    label: 'The Letter', page: 'letter' },
    { href: 'open-when.html', label: 'Open When…', page: 'open-when' },
    { href: 'wedding.html',   label: 'Wedding',    page: 'wedding' }
  ];
  var navEl = document.getElementById('nav');
  if (navEl) {
    NAV.forEach(function (item) {
      var a = document.createElement('a');
      a.className = 'tab' + (item.page === page ? ' active' : '');
      a.href = item.href;
      a.textContent = item.label;
      navEl.appendChild(a);
    });
  }

  /* ╔═══════════════════════════════════════════════════════════════════╗
     ║  DEV SKIP — TEMPORARY. Comment out (or delete) this whole block    ║
     ║  when the gift is ready to ship.                                   ║
     ║  Shows a "skip ›››" button on the home page that jumps past the    ║
     ║  locks + signature straight to the letter. Live for now so the     ║
     ║  deployed site is testable too.                                    ║
     ╚═══════════════════════════════════════════════════════════════════╝ */
  if (page === 'home') {
    var skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'dev-skip';
    skip.textContent = 'skip ›››';
    skip.title = 'dev — skip locks straight to the letter';
    skip.addEventListener('click', function () {
      try { sessionStorage.setItem('riti_open', '1'); } catch (e) {}
      location.href = 'letter.html';
    });
    document.body.appendChild(skip);
  }
  /* ────────────────────────────── END DEV SKIP ────────────────────────── */
})();
