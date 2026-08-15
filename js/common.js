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
  /* Push notifications: fill these two in once set up, and push turns on.
     Until then the code below stays completely dormant. */
  var FCM_VAPID_KEY = 'BC2SDp9eHQzom_RdmSz0Gpuydth7to-6_Zl-4pMKBms90gr2vZOpSJnGbXAtFW-0cfjewlagoQQ7UVefeIuu1Rg';
  var PUSH_ENDPOINT = 'https://parvriti-push.parvbajaj2000.workers.dev';

  var body = document.body;
  var page = body.dataset.page || '';
  var auth = null;
  var cdb = null;

  registerSW();
  buildGate();   // opaque overlay covers everything until we know who this is

  try {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      try { auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}
      auth.getRedirectResult().catch(function (e) { gateError(e); });
      auth.onAuthStateChanged(function (user) {
        if (user && ALLOWED.indexOf((user.email || '').toLowerCase()) !== -1) {
          unlock(user);
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

  function unlock(user) {
    var g = document.getElementById('authGate');
    if (g && g.parentNode) g.parentNode.removeChild(g);
    window.__parvritiAuthed = true;
    if (user && user.email) window.__parvritiUser = { email: user.email, person: personFor(user.email) };
    try { window.dispatchEvent(new Event('parvriti-authed')); } catch (e) {}
    proceed();
    try { startRealtime(); } catch (e) {}
    try { celebrate(); } catch (e) {}
    try { setupMessaging(); } catch (e) {}
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
    renderDayCounter();
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

  /* ── who is this? (two of the allowed emails are Parv's) ── */
  function personFor(email) { return (email || '').toLowerCase() === 'aritika2000@gmail.com' ? 'riti' : 'parv'; }

  /* ── live "days of us" counter (since 29 July 2019) ── */
  function renderDayCounter() {
    var els = document.querySelectorAll('[data-daycounter]');
    if (!els.length) return;
    var anniv = new Date(2019, 6, 29);   // 29 Jul 2019
    function tick() {
      var now = new Date();
      var a = new Date(anniv.getFullYear(), anniv.getMonth(), anniv.getDate());
      var t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var days = Math.floor((t - a) / 86400000);
      if (days < 0) days = 0;
      var s = days.toLocaleString('en-US');
      for (var i = 0; i < els.length; i++) els[i].innerHTML = '<span class="dc-flower">🌸</span><b>' + s + '</b> days of us';
    }
    tick();
    setInterval(tick, 60000);   // ticks over at midnight if she's watching
  }

  /* ── install the app (offline + home-screen icon) ── */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  /* ══════════════ push notifications (reaches a closed phone) ══════════════ */
  function setupMessaging() {
    var u = window.__parvritiUser;
    if (!u || !cdb || typeof firebase === 'undefined' || !firebase.messaging) return;
    if (FCM_VAPID_KEY.indexOf('REPLACE') === 0) return;   // not configured yet → stay dormant
    try { if (firebase.messaging.isSupported && !firebase.messaging.isSupported()) return; } catch (e) { return; }
    if (typeof Notification === 'undefined') return;
    var messaging;
    try { messaging = firebase.messaging(); } catch (e) { return; }
    if (Notification.permission === 'granted') registerToken(messaging, u.person);
    else if (Notification.permission === 'default' && page && page !== 'home') buildNotifPrompt(messaging, u.person);
    try { messaging.onMessage(function () {}); } catch (e) {}   // foreground: the live pulse already covers it
  }
  function registerToken(messaging, person) {
    try {
      messaging.getToken({ vapidKey: FCM_VAPID_KEY }).then(function (token) {
        if (!token) return;
        cdb.collection('deviceTokens').doc(token).set({
          person: person, token: token, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(function () {});
      }).catch(function () {});
    } catch (e) {}
  }
  function buildNotifPrompt(messaging, person) {
    try { if (localStorage.getItem('notifDismissed') === '1') return; } catch (e) {}
    if (document.getElementById('notifPrompt')) return;
    var other = person === 'riti' ? 'Parv' : 'Riti';
    var p = document.createElement('div');
    p.id = 'notifPrompt'; p.className = 'notif-prompt';
    p.innerHTML = '<span class="np-text">🔔 A nudge whenever ' + other + ' writes you?</span>' +
      '<button type="button" class="np-yes">Turn on</button>' +
      '<button type="button" class="np-no" aria-label="dismiss">✕</button>';
    body.appendChild(p);
    requestAnimationFrame(function () { p.classList.add('show'); });
    p.querySelector('.np-yes').addEventListener('click', function () {
      try { Notification.requestPermission().then(function (perm) { if (perm === 'granted') registerToken(messaging, person); }); } catch (e) {}
      dismissNotifPrompt();
    });
    p.querySelector('.np-no').addEventListener('click', function () {
      try { localStorage.setItem('notifDismissed', '1'); } catch (e) {}
      dismissNotifPrompt();
    });
  }
  function dismissNotifPrompt() {
    var p = document.getElementById('notifPrompt'); if (!p) return;
    p.classList.remove('show');
    setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 400);
  }
  /* open-when.js calls this when a note is saved; heartbeat calls it too */
  window.parvritiNotify = function (to, title, text, url) {
    try {
      if (PUSH_ENDPOINT.indexOf('REPLACE') === 0) return;
      if (typeof firebase === 'undefined' || !firebase.auth) return;
      var user = firebase.auth().currentUser;
      if (!user) return;
      user.getIdToken().then(function (idt) {
        fetch(PUSH_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idt },
          body: JSON.stringify({ to: to, title: title, body: text || '', url: url || 'https://parvriti.github.io/open-when.html' })
        }).catch(function () {});
      }).catch(function () {});
    } catch (e) {}
  };

  /* ══════════════ real-time: presence · typing · heartbeat ping ══════════════ */
  function startRealtime() {
    var u = window.__parvritiUser;
    if (!u || typeof firebase === 'undefined' || !firebase.firestore) return;
    try { cdb = firebase.firestore(); } catch (e) { return; }
    var me = u.person, other = me === 'riti' ? 'parv' : 'riti';
    var FV = firebase.firestore.FieldValue;
    var meRef = cdb.collection('presence').doc(me);
    var inner = page && page !== 'home';

    function beat(extra) {
      var d = { at: FV.serverTimestamp(), atMs: Date.now(), page: page, hidden: !!document.hidden, gone: false };
      if (extra) for (var k in extra) d[k] = extra[k];
      meRef.set(d, { merge: true }).catch(function () {});
    }
    beat();
    setInterval(function () { beat(); }, 25000);
    document.addEventListener('visibilitychange', function () { beat(); });
    window.addEventListener('focus', function () { beat(); });
    window.addEventListener('pagehide', function () { beat({ gone: true }); });

    /* open-when.js calls this while the note box is being typed in */
    var typingOffT = null;
    window.parvritiTyping = function (on) {
      beat({ typing: !!on });
      clearTimeout(typingOffT);
      if (on) typingOffT = setTimeout(function () { beat({ typing: false }); }, 5000);
    };

    /* watch the other person */
    var lastOther = null;
    if (inner) buildPresencePill();
    cdb.collection('presence').doc(other).onSnapshot(function (snap) {
      lastOther = snap.exists ? snap.data() : null;
      renderPresence(lastOther, other);
    }, function () {});
    setInterval(function () { renderPresence(lastOther, other); }, 15000);

    /* heartbeat ping */
    window.parvritiSendLove = function () {
      if (!cdb) return;
      cdb.collection('pings').doc(other).set({ at: FV.serverTimestamp(), from: me, seq: Date.now() }).catch(function () {});
      toast('sent 💗');
      if (navigator.vibrate) navigator.vibrate(24);
      // also push, so it reaches them even if the app is closed
      if (window.parvritiNotify) window.parvritiNotify(other, (me === 'parv' ? 'Parv' : 'Riti') + ' is thinking of you 💗', '', 'https://parvriti.github.io/open-when.html');
    };
    var pingFirst = true;
    cdb.collection('pings').doc(me).onSnapshot(function (snap) {
      if (pingFirst) { pingFirst = false; return; }   // ignore whatever is already there on load
      if (!snap.exists) return;
      var d = snap.data();
      pulseHeart(d && d.from);
    }, function () {});
    if (inner) buildPingButton();
  }

  function renderPresence(data, other) {
    var pill = document.getElementById('presPill');
    if (!pill) return;
    var name = other === 'parv' ? 'Parv' : 'Riti';
    var online = false, typing = false;
    if (data) {
      var ms = data.atMs || 0;
      online = !data.gone && !data.hidden && ms && (Date.now() - ms < 70000);
      typing = online && data.typing;
    }
    if (!online) { pill.classList.remove('show', 'typing'); return; }
    pill.classList.add('show');
    if (typing) { pill.classList.add('typing'); pill.innerHTML = '<span class="pres-dot"></span>✍️ ' + name + ' is writing you something…'; }
    else { pill.classList.remove('typing'); pill.innerHTML = '<span class="pres-dot"></span>' + name + ' is here right now 🌸'; }
  }
  function buildPresencePill() {
    if (document.getElementById('presPill')) return;
    var p = document.createElement('div'); p.id = 'presPill'; p.className = 'pres-pill';
    body.appendChild(p);
  }
  function buildPingButton() {
    if (document.getElementById('loveFab')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'loveFab'; b.className = 'love-fab';
    b.setAttribute('aria-label', 'Send a heartbeat');
    b.innerHTML = '<span>💗</span>';
    b.addEventListener('click', function () {
      b.classList.remove('tap'); void b.offsetWidth; b.classList.add('tap');
      if (window.parvritiSendLove) window.parvritiSendLove();
    });
    body.appendChild(b);
  }
  function pulseHeart(from) {
    var name = from === 'parv' ? 'Parv' : (from === 'riti' ? 'Riti' : 'Someone');
    var ov = document.createElement('div');
    ov.className = 'love-pulse';
    ov.innerHTML = '<div class="love-heart">💗</div><div class="love-text">' + name + ' is thinking of you</div>';
    body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('go'); });
    if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    setTimeout(function () {
      ov.classList.remove('go');
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 700);
    }, 2600);
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'mini-toast'; t.textContent = msg;
    body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 400);
    }, 1600);
  }

  /* ══════════════ anniversary / birthday takeover ══════════════ */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function occasionToday() {
    var d = new Date(), md = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()), y = d.getFullYear();
    if (md === '07-29') { var n = y - 2019; return { emoji: '💍', text: 'Happy anniversary, meri jaan. ' + (n >= 1 ? ord(n) + ' year of us.' : 'Us.') }; }
    if (md === '04-20') return { emoji: '🎂', text: 'Happy birthday, meri Riti. Today the whole world is yours.' };
    if (md === '12-10') return { emoji: '🎂', text: 'Happy birthday, mera Pavu.' };
    return null;
  }
  function celebrate() {
    var occ = occasionToday();
    if (!occ) return;
    body.classList.add('celebrate');
    spawnPetals();
    if (document.getElementById('celebrateBanner')) return;
    var bn = document.createElement('div');
    bn.id = 'celebrateBanner'; bn.className = 'celebrate-banner';
    bn.innerHTML = '<span class="cb-emoji">' + occ.emoji + '</span><span class="cb-text">' + occ.text + '</span>';
    body.appendChild(bn);
    setTimeout(function () { bn.classList.add('show'); }, 500);
    // greet, then step out of the way (the gold title + petals stay all day)
    setTimeout(function () {
      bn.classList.remove('show');
      setTimeout(function () { if (bn.parentNode) bn.parentNode.removeChild(bn); }, 800);
    }, 7000);
  }
  function spawnPetals() {
    if (document.querySelector('.petal-fall')) return;
    var layer = document.createElement('div'); layer.className = 'petal-fall'; body.appendChild(layer);
    var glyphs = ['🌸', '🌹', '💗', '🌺'];
    for (var i = 0; i < 18; i++) {
      var s = document.createElement('span');
      s.className = 'pf'; s.textContent = glyphs[i % glyphs.length];
      s.style.left = (Math.random() * 100) + '%';
      s.style.animationDuration = (5 + Math.random() * 5) + 's';
      s.style.animationDelay = (Math.random() * 5) + 's';
      s.style.fontSize = (14 + Math.random() * 16) + 'px';
      layer.appendChild(s);
    }
  }

  /* ══════════════ tiny synthesized sound + haptics ══════════════ */
  var actx = null;
  function ac() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
    return actx;
  }
  function blip(freq, when, dur, type, peak) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + (when || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak || 0.06, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }
  window.parvritiSfx = {
    tick: function () { blip(660, 0, 0.06, 'triangle', 0.05); },
    pluck: function () { blip(520, 0, 0.14, 'sine', 0.07); blip(780, 0.02, 0.1, 'sine', 0.03); },
    chime: function () { blip(784, 0, 0.5, 'sine', 0.06); blip(1175, 0.04, 0.45, 'sine', 0.035); blip(1568, 0.09, 0.4, 'sine', 0.02); },
    err: function () { blip(200, 0, 0.2, 'sawtooth', 0.05); }
  };
})();
