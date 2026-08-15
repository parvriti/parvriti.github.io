/* =====================================================================
   common.js — shared chrome loaded by every page

     · Google sign-in GATE: nobody sees anything until they sign in with
       one of the three allowed accounts. Persists per device (forever
       until sign-out).
     · unlock guard (inner pages require the lock ritual this session)
     · background atmosphere (drifting petals)
     · top navigation

   The page identifies itself via <body data-page="…">.
   ===================================================================== */
(function () {
  var ALLOWED = ['parvbajaj2000@gmail.com', 'aritika2000@gmail.com', 'parvbajaj2480@gmail.com'];
  var firebaseConfig = {
    apiKey: "AIzaSyBW_EMfKIkIJDNSMPUp6UeHOGtIdv26Wpk",
    authDomain: "parvriti.firebaseapp.com",
    projectId: "parvriti",
    storageBucket: "parvriti.firebasestorage.app",
    messagingSenderId: "598106428796",
    appId: "1:598106428796:web:bcb49b129377d9a5d6c0f9"
  };
  var body = document.body;
  var page = body.dataset.page || '';
  var auth = null;

  buildGate();   // opaque overlay covers everything until we know who this is

  try {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      try { auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}
      auth.getRedirectResult().catch(function (e) { gateError(e); });
      auth.onAuthStateChanged(function (user) {
        if (user && ALLOWED.indexOf((user.email || '').toLowerCase()) !== -1) {
          unlock();
        } else if (user) {
          auth.signOut();
          revealGate('This little world is only for the three of us 💛');
        } else {
          revealGate('');
        }
      });
    } else {
      // Firebase failed to load. The static pages are public anyway, so don't trap anyone.
      unlock();
    }
  } catch (e) { unlock(); }

  function unlock() {
    var g = document.getElementById('authGate');
    if (g && g.parentNode) g.parentNode.removeChild(g);
    window.__parvritiAuthed = true;
    try { window.dispatchEvent(new Event('parvriti-authed')); } catch (e) {}
    proceed();
  }

  /* ── everything below the gate ── */
  function proceed() {
    if (page && page !== 'home') {
      try { if (sessionStorage.getItem('riti_open') !== '1') { location.replace('index.html'); return; } } catch (e) {}
    }
    if (!document.querySelector('.bg-base')) {
      var base = document.createElement('div'); base.className = 'bg-base';
      body.insertBefore(base, body.firstChild);
      [
        'width:100px;height:68px;background:#c0425a;top:8%;left:-3%;opacity:.05;animation-duration:20s;',
        'width:70px;height:50px;background:#e890a0;top:52%;right:-2%;opacity:.05;animation-duration:24s;animation-delay:-9s;',
        'width:50px;height:35px;background:#f9c6c6;top:25%;left:76%;opacity:.04;animation-duration:17s;animation-delay:-5s;',
        'width:85px;height:60px;background:#8b2040;bottom:15%;left:7%;opacity:.04;animation-duration:28s;animation-delay:-14s;'
      ].forEach(function (s) { var p = document.createElement('div'); p.className = 'bgp'; p.setAttribute('style', s); body.insertBefore(p, base.nextSibling); });
    }
    var NAV = [
      { href: 'letter.html', label: 'The Letter', page: 'letter' },
      { href: 'open-when.html', label: 'Open When…', page: 'open-when' },
      { href: 'wedding.html', label: 'Wedding', page: 'wedding' }
    ];
    var navEl = document.getElementById('nav');
    if (navEl && !navEl.children.length) {
      NAV.forEach(function (item) {
        var a = document.createElement('a');
        a.className = 'tab' + (item.page === page ? ' active' : '');
        a.href = item.href; a.textContent = item.label; navEl.appendChild(a);
      });
    }
    /* dev skip (home) — TEMPORARY, remove before this is the finished gift */
    if (page === 'home' && !document.querySelector('.dev-skip')) {
      var skip = document.createElement('button');
      skip.type = 'button'; skip.className = 'dev-skip'; skip.textContent = 'skip ›››';
      skip.title = 'dev — skip locks straight to the letter';
      skip.addEventListener('click', function () { try { sessionStorage.setItem('riti_open', '1'); } catch (e) {} location.href = 'letter.html'; });
      document.body.appendChild(skip);
    }
  }

  /* ── the sign-in gate ── */
  function buildGate() {
    var g = document.createElement('div');
    g.id = 'authGate';
    g.className = 'auth-gate';
    g.innerHTML =
      '<div class="auth-inner">' +
        '<div class="auth-flower">' +
          '<svg viewBox="0 0 150 150" aria-hidden="true">' +
            '<ellipse cx="75" cy="20" rx="12" ry="19" fill="#c0425a" opacity=".78" transform="rotate(0 75 75)"/>' +
            '<ellipse cx="75" cy="20" rx="12" ry="19" fill="#d4607a" opacity=".78" transform="rotate(45 75 75)"/>' +
            '<ellipse cx="75" cy="20" rx="12" ry="19" fill="#b03050" opacity=".78" transform="rotate(90 75 75)"/>' +
            '<ellipse cx="75" cy="20" rx="12" ry="19" fill="#e07090" opacity=".78" transform="rotate(135 75 75)"/>' +
            '<ellipse cx="75" cy="20" rx="12" ry="19" fill="#c0425a" opacity=".78" transform="rotate(180 75 75)"/>' +
            '<ellipse cx="75" cy="20" rx="12" ry="19" fill="#d4607a" opacity=".78" transform="rotate(225 75 75)"/>' +
            '<ellipse cx="75" cy="20" rx="12" ry="19" fill="#b03050" opacity=".78" transform="rotate(270 75 75)"/>' +
            '<ellipse cx="75" cy="20" rx="12" ry="19" fill="#e07090" opacity=".78" transform="rotate(315 75 75)"/>' +
          '</svg>' +
          '<div class="auth-jewel">🌸</div>' +
        '</div>' +
        '<div class="auth-title">Only for us.</div>' +
        '<div class="auth-sub">A little world of ours. Sign in to come in.</div>' +
        '<button type="button" class="auth-google" id="authGoogle"><span class="auth-g">G</span>Continue with Google</button>' +
        '<div class="auth-msg" id="authMsg"></div>' +
      '</div>';
    body.appendChild(g);
    g.querySelector('#authGoogle').addEventListener('click', function () {
      gateMsg('');
      if (!auth) { gateMsg('Sign-in is not available right now.'); return; }
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      /* Popup keeps the session on our own origin's storage. A redirect
         (via parvriti.firebaseapp.com) loses it to browser cross-site
         storage blocking, so popup is primary; redirect is the fallback
         only when a popup can't open. */
      auth.signInWithPopup(provider).catch(function (e) {
        var c = e && e.code;
        if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
        if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') {
          try { auth.signInWithRedirect(provider); } catch (er) { gateError(er); }
          return;
        }
        gateError(e);
      });
    });
  }
  function revealGate(msg) {
    var g = document.getElementById('authGate');
    if (g) g.classList.add('ready');
    if (msg) gateMsg(msg);
  }
  function gateMsg(t) { var m = document.getElementById('authMsg'); if (m) m.textContent = t || ''; }
  function gateError(e) {
    if (!e || e.code === 'auth/no-auth-event') return;
    if (e.code === 'auth/operation-not-allowed') gateMsg('Google sign-in is not enabled yet in Firebase.');
    else if (e.code === 'auth/unauthorized-domain') gateMsg('This domain needs adding to Firebase authorized domains.');
    else gateMsg(e.message || 'Sign-in failed, please try again.');
    revealGate('');
  }
})();
