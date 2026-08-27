/* =====================================================================
   common.js - shared chrome loaded by every page

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
  var INITIAL_SEARCH = (location.search || '');   // captured before any page strips it (for the deep-link gate)
  var auth = null;
  var cdb = null;
  var quietTimer = null;   // gate-quiet safety fallback (see buildGate)

  registerSW();
  setupHaptics();
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
          // Signed in, but not one of us. Grab the address before signOut(), which
          // fires this handler again with user === null a tick later.
          var rejectedEmail = user.email || '';
          auth.signOut().catch(function () {});
          showRejection(rejectedEmail);
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
    clearTimeout(quietTimer);
    var g = document.getElementById('authGate');
    if (g && g.parentNode) g.parentNode.removeChild(g);
    // Remember "returning" ONLY for a real signed-in user - not the Firebase-failed-to-load
    // fallback unlock() (which passes no user). That keeps the gate-quiet skip meaning
    // "an allowed account signed in on this device before".
    if (user && user.email) { try { localStorage.setItem('parvritiReturning', '1'); } catch (e) {} }
    window.__parvritiAuthed = true;
    if (user && user.email) window.__parvritiUser = { email: user.email, person: personFor(user.email) };
    try { window.dispatchEvent(new Event('parvriti-authed')); } catch (e) {}
    proceed();
    try { startRealtime(); } catch (e) {}
    try { celebrate(); } catch (e) {}
    try { setupMessaging(); } catch (e) {}
    try { handleMoment(); } catch (e) {}
  }

  /* a notification tap can land on Home with ?moment=… to replay the moment
     it announced (heart / got-home). celebrate() already covers ?moment=celebrate
     on the day, so nothing extra is needed for that. */
  function handleMoment() {
    var m, who;
    try { var p = new URLSearchParams(location.search); m = p.get('moment'); who = p.get('who'); } catch (e) { return; }
    if (!m) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}   // don't replay on refresh
    var name = who === 'parv' ? 'Parv' : 'Riti';
    if (m === 'heart') pulseHeart({ from: who, emoji: '💗', text: name + ' is thinking of you 💗' });
    else if (m === 'home') pulseHeart({ from: who, emoji: '🏡', text: name + ' got home safe 🏡' });
  }

  /* ── everything below the gate ── */
  function proceed() {
    if (page && page !== 'home') {
      try {
        if (sessionStorage.getItem('riti_open') !== '1') {
          // A notification tap is an authorized entry (sign-in already gated us in
          // above). Its deep-link URL carries open= / moment= / n=, so enter
          // straight to the page rather than bouncing to the front door - which on
          // a cold (terminated-app) launch would drop the deep-link. A plain manual
          // visit with no such marker still returns to Home.
          if (/[?&](open|moment|n)=/.test(INITIAL_SEARCH)) sessionStorage.setItem('riti_open', '1');
          else { location.replace('index.html'); return; }
        }
      } catch (e) {}
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
    // Navigation is owned entirely by native.js (the bottom tab bar / sidebar), which does
    // its own settings/app read + canSee filtering. The old hidden #nav/#tabTop/#homeGear
    // shell used to be built here too, causing a duplicate Firestore read and dead DOM.
    renderDayCounter();
  }

  /* ── iOS haptics ── navigator.vibrate is a no-op in an iOS PWA. The one thing that
     DOES buzz is toggling a rendered <input type="checkbox" switch> inside a user gesture
     (iOS 17.4+). Keep one hidden off-screen and click it from parvritiHaptic(). Everywhere
     else it's a harmless no-op, so callers can just call it and also keep navigator.vibrate. */
  function setupHaptics() {
    window.parvritiHaptic = function () {};   // safe default until the element exists
    try {
      var sw = document.createElement('input');
      sw.type = 'checkbox'; sw.setAttribute('switch', ''); sw.tabIndex = -1; sw.setAttribute('aria-hidden', 'true');
      sw.style.cssText = 'position:fixed;bottom:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      (document.body || document.documentElement).appendChild(sw);
      window.parvritiHaptic = function () { try { sw.click(); } catch (e) {} };
    } catch (e) {}
  }

  /* ── loading veil ── a translucent bloom over a content area during its FIRST data load.
     Hidden by default; a page arms it, and it only becomes visible if data has not arrived
     within ~120ms (so a fast / cached load shows nothing at all - zero added time). done()
     fades it out the instant content paints: call it in the SAME snapshot callback, right
     AFTER the render, so the hand-off is exact - never an empty flash, never a lingering wait. */
  function buildLoadVeil(id) {
    var v = document.getElementById(id);
    var finished = false, t = null, maxT = null;
    function showErr(msg) {
      finished = true; if (t) clearTimeout(t); if (maxT) clearTimeout(maxT);
      if (!v) return;
      v.classList.remove('gone'); v.classList.add('show', 'err');
      var c = v.querySelector('.lv-cap'); if (c && msg) c.textContent = msg;
    }
    if (v) {
      t = setTimeout(function () { if (!finished && v) v.classList.add('show'); }, 120);
      // cold offline load (no persistence by design) can leave the snapshot neither firing nor erroring;
      // don't let "loading…" sit forever - surface the error after a long wait. done() cancels this well before.
      maxT = setTimeout(function () { if (!finished) showErr("couldn't load, check your connection"); }, 15000);
    }
    return {
      done: function () { finished = true; if (t) clearTimeout(t); if (maxT) clearTimeout(maxT); if (v) v.classList.add('gone'); },
      fail: function (msg) { showErr(msg); }
    };
  }
  window.parvritiLoadVeil = buildLoadVeil;

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
        '<button type="button" class="auth-google" id="authGoogle"><span class="auth-g"><svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg></span>Continue with Google</button>' +
        '<div class="auth-msg" id="authMsg"></div>' +
      '</div>' +
      '<div class="auth-reject" role="group" aria-label="This account is not recognized">' +
        '<svg class="auth-reject-env" viewBox="0 0 120 92" aria-hidden="true">' +
          '<rect x="12" y="22" width="96" height="56" rx="6" fill="#170b10" stroke="#e8cfc9" stroke-width="3.2"/>' +
          '<path d="M13.5 24 L60 55 L106.5 24" fill="none" stroke="#e8cfc9" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M14 76 L46 53 M106 76 L74 53" fill="none" stroke="#e8cfc9" stroke-width="2.2" stroke-linecap="round" opacity=".5"/>' +
          '<g class="auth-stamp">' +
            '<rect x="68" y="9" width="40" height="36" rx="3" fill="#2a0d12" stroke="#df6274" stroke-width="2.4" stroke-dasharray="0.5 3.4" stroke-linecap="round"/>' +
            '<rect x="72" y="13" width="32" height="28" rx="2" fill="none" stroke="#df6274" stroke-width="1.5"/>' +
            '<text x="88" y="25" text-anchor="middle" font-family="\'DM Sans\',sans-serif" font-size="7.4" font-weight="700" letter-spacing="1.1" fill="#f0919e">RETURN</text>' +
            '<path d="M79 31 h18 M81 35 h14" stroke="#df6274" stroke-width="1.5" stroke-linecap="round"/>' +
          '</g>' +
        '</svg>' +
        '<div class="auth-reject-head">No one here by that name</div>' +
        '<div class="auth-reject-email" id="authRejectEmail"></div>' +
        '<button type="button" class="auth-reuse" id="authReuse">Use another account</button>' +
      '</div>';
    body.appendChild(g);
    // Someone who has signed in on this device before doesn't need the full "Only for us."
    // splash flashed at them on every page load while auth silently re-resolves. Start the
    // gate transparent + click-through; unlock() removes it, or revealGate() brings it back
    // if auth actually needs them (signed out / failed).
    try {
      if (localStorage.getItem('parvritiReturning') === '1') {
        g.classList.add('gate-quiet');
        // Fast path (local-persistence auth ≈ tens of ms): stays transparent the whole time,
        // so the tab just opens - no splash. Safety: if auth is slow to resolve, don't leave a
        // blank shell lingering; fade the branded splash in as a placeholder (no sign-in button -
        // auth may still succeed). unlock()/revealGate() cancel this.
        quietTimer = setTimeout(function () {
          var gg = document.getElementById('authGate');
          if (gg) gg.classList.remove('gate-quiet');
        }, 200);
      }
    } catch (e) {}
    /* Escape hatch: the sign-in button is invisible until '.ready' is added, and ONLY the
       auth callbacks add it. If onAuthStateChanged never fires (blocked IndexedDB in a
       private / lockdown window, corrupted persistence), the user is stranded on a
       button-less splash with no way in. After a short wait, if we still are not authed,
       force the gate interactive. Leaves the returning flag alone, so a merely-slow auth
       still resolves and unlocks normally; harmless if unlock/revealGate already ran. */
    setTimeout(function () {
      if (window.__parvritiAuthed) return;
      var gg = document.getElementById('authGate');
      if (gg) { gg.classList.remove('gate-quiet'); gg.classList.add('ready'); }
    }, 2500);
    /* one sign-in path, shared by "Continue with Google" and the rejected
       screen's "Use another account" so they can never drift apart. */
    function doSignIn() {
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
    }
    g.querySelector('#authGoogle').addEventListener('click', doSignIn);
    var reuse = g.querySelector('#authReuse'); if (reuse) reuse.addEventListener('click', doSignIn);
  }
  function revealGate(msg) {
    clearTimeout(quietTimer);
    var g = document.getElementById('authGate');
    // auth genuinely needs them, so the "returning" assumption was wrong: show the real gate.
    try { localStorage.removeItem('parvritiReturning'); } catch (e) {}
    if (g) { g.classList.remove('gate-quiet'); g.classList.add('ready'); }
    // The if(msg) guard keeps revealGate('') from wiping a real error set by
    // gateError() just before it. revealGate never touches the .rejected class,
    // so the rejection screen (below) also survives a revealGate('') call.
    if (msg) gateMsg(msg);
  }
  function gateMsg(t) { var m = document.getElementById('authMsg'); if (m) m.textContent = t || ''; }
  /* A signed-in Google account that isn't one of ours. Instead of a body-copy line,
     flip the gate to a "return to sender" screen. The face is a CLASS (.rejected),
     not a clearable message, so it deliberately survives the SECOND onAuthStateChanged
     that signOut() triggers a tick later with user === null (that path calls
     revealGate(''), which never removes .rejected). A successful sign-in tears the
     whole thing down: unlock() removes #authGate, and the reject block is its child. */
  function showRejection(email) {
    var em = document.getElementById('authRejectEmail');
    if (em) em.textContent = email || '';   // textContent, so the address can't inject markup
    var g = document.getElementById('authGate');
    if (g) g.classList.add('rejected');   // add before reveal, same tick, so the reject face is what paints
    revealGate('');   // cancel gate-quiet, drop the "returning" flag, reveal - without clearing the face
  }
  function gateError(e) {
    if (!e || e.code === 'auth/no-auth-event') return;
    if (e.code === 'auth/operation-not-allowed') gateMsg('Google sign-in is not enabled yet in Firebase.');
    else if (e.code === 'auth/unauthorized-domain') gateMsg('This domain needs adding to Firebase authorized domains.');
    else gateMsg(e.message || "couldn't sign in, try again");
    revealGate('');
  }

  /* ── who is this? (two of the allowed emails are Parv's) ── */
  function personFor(email) { return (email || '').toLowerCase() === 'aritika2000@gmail.com' ? 'riti' : 'parv'; }

  /* ── live "days of us" counter (since 29 July 2019) ── */
  function renderDayCounter() {
    if (renderDayCounter._on) return; renderDayCounter._on = true;   // onAuthStateChanged can refire; don't stack the 60s interval
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
    if (setupMessaging._on) return; setupMessaging._on = true;   // onAuthStateChanged can refire; don't stack onMessage observers or re-write the token
    var u = window.__parvritiUser;
    if (!u || !cdb || typeof firebase === 'undefined' || !firebase.messaging) return;
    if (FCM_VAPID_KEY.indexOf('REPLACE') === 0) return;   // not configured yet → stay dormant
    try { if (firebase.messaging.isSupported && !firebase.messaging.isSupported()) return; } catch (e) { return; }
    if (typeof Notification === 'undefined') return;
    var messaging;
    try { messaging = firebase.messaging(); } catch (e) { return; }
    if (Notification.permission === 'granted') registerToken(messaging, u.person, false);
    else if (Notification.permission === 'default' && page && page !== 'home') buildNotifPrompt(messaging, u.person);
    try { messaging.onMessage(function () {}); } catch (e) {}   // foreground: the live pulse already covers it
  }
  function registerToken(messaging, person, announce) {
    try {
      messaging.getToken({ vapidKey: FCM_VAPID_KEY }).then(function (token) {
        if (!token) { if (announce) toast('notifications unavailable here'); return; }
        cdb.collection('deviceTokens').doc(token).set({
          person: person, token: token, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () { if (announce) toast('🔔 notifications on'); }).catch(function () { if (announce) toast("couldn't turn on notifications, try again"); });
      }).catch(function () { if (announce) toast("couldn't turn on notifications, try again"); });
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
      try { Notification.requestPermission().then(function (perm) { if (perm === 'granted') registerToken(messaging, person, true); else toast('notifications not allowed'); }); } catch (e) {}
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
  /* open-when.js calls this when a note is saved; heartbeat calls it too.
     Returns a promise that RESOLVES to true (sent) / false (couldn't) - it never
     rejects, so the fire-and-forget callers stay unaffected while the Settings
     test ping can await the real outcome. */
  window.parvritiNotify = function (to, title, text, url, type) {
    try {
      if (PUSH_ENDPOINT.indexOf('REPLACE') === 0) return Promise.resolve(false);
      if (typeof firebase === 'undefined' || !firebase.auth) return Promise.resolve(false);
      var user = firebase.auth().currentUser;
      if (!user) return Promise.resolve(false);
      return user.getIdToken().then(function (idt) {
        return fetch(PUSH_ENDPOINT, {
          method: 'POST', keepalive: true,   // still completes if fired from a pagehide handler (doodle-and-leave nudge)
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idt },
          body: JSON.stringify({ to: to, title: title, body: text || '', url: url || 'https://parvriti.github.io/open-when.html', type: type || '' })
        }).then(function (r) { return !!(r && r.ok); }, function () { return false; });
      }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  };

  /* ══════════════ real-time: presence · typing · heartbeat ping ══════════════ */
  function startRealtime() {
    if (startRealtime._on) return;   // onAuthStateChanged can fire again; don't stack listeners/timers
    var u = window.__parvritiUser;
    if (!u || typeof firebase === 'undefined' || !firebase.firestore) return;
    try { cdb = firebase.firestore(); } catch (e) { return; }
    startRealtime._on = true;
    var me = u.person, other = me === 'riti' ? 'parv' : 'riti';
    var FV = firebase.firestore.FieldValue;
    var meRef = cdb.collection('presence').doc(me);
    var inner = page && page !== 'home';
    var curAct = null, curActLabel = '', curTyping = false;   // live "reading/drawing/typing" state, rewritten on every beat

    function beat(extra) {
      var d = { at: FV.serverTimestamp(), atMs: Date.now(), page: page, hidden: !!document.hidden, gone: false, activity: curAct, activityLabel: curActLabel, typing: curTyping };
      if (extra) for (var k in extra) d[k] = extra[k];
      meRef.set(d, { merge: true }).catch(function () {});
    }
    beat();
    setInterval(function () { if (!document.hidden) beat(); }, 25000);   // don't write while backgrounded
    document.addEventListener('visibilitychange', function () { beat(); });
    window.addEventListener('focus', function () { beat(); });
    window.addEventListener('pagehide', function () { beat({ gone: true }); });

    /* open-when.js calls this while the note box is being typed in */
    var typingOffT = null;
    window.parvritiTyping = function (on) {
      curTyping = !!on; beat();   // rides the base object now, so a fresh page load (curTyping=false) clears a stuck "writing…" the same way activity self-clears
      clearTimeout(typingOffT);
      if (on) typingOffT = setTimeout(function () { curTyping = false; beat(); }, 5000);
    };
    /* open-when.js calls this when a note is opened → the "last opened" line */
    window.parvritiSetLastOpened = function (title) {
      meRef.set({ lastOpenedTitle: String(title || '').slice(0, 60), atMs: Date.now(), at: FV.serverTimestamp(), gone: false, hidden: false }, { merge: true }).catch(function () {});
    };
    /* open-when.js / doodle.js set a live activity ("reading X", "drawing"). It
       rides the online window, and every beat rewrites it, so a fresh page load
       (curAct = null) clears whatever the previous page had set. */
    window.parvritiActivity = function (kind, label) {
      curAct = kind || null;
      curActLabel = String(label || '').slice(0, 60);
      beat();
    };

    /* watch the other person */
    var lastOther = null;
    if (inner) buildPresencePill();
    cdb.collection('presence').doc(other).onSnapshot(function (snap) {
      lastOther = snap.exists ? snap.data() : null;
      renderPresence(lastOther, other);
      renderLastSeen(lastOther, other);
    }, function () {});
    setInterval(function () { renderPresence(lastOther, other); renderLastSeen(lastOther, other); }, 15000);

    /* home page only: the optional "♡ Riti is home / away" line (line 3). Dormant
       shown per-person via the Notifications matrix (n_away) once the Leave
       automations exist. */
    if (page === 'home') setupHomeState(other);

    /* heartbeat ping */
    window.parvritiSendLove = function () {
      if (!cdb) return;
      cdb.collection('pings').doc(other).set({ at: FV.serverTimestamp(), from: me, seq: Date.now() }).then(function () { toast('sent 💗'); }).catch(function () { toast("couldn't send, try again"); });
      if (window.parvritiHaptic) window.parvritiHaptic();
      if (navigator.vibrate) navigator.vibrate(24);
      // also push, so it reaches them even if the app is closed
      if (window.parvritiNotify) window.parvritiNotify(other, (me === 'parv' ? 'Parv' : 'Riti') + ' is thinking of you 💗', '', 'https://parvriti.github.io/index.html?moment=heart&who=' + me, 'heart');
    };

    var pingFirst = true;
    cdb.collection('pings').doc(me).onSnapshot(function (snap) {
      if (pingFirst) { pingFirst = false; return; }   // ignore whatever is already there on load
      if (!snap.exists) return;
      pulseHeart(snap.data());
    }, function () {});
    // heartbeat button everywhere (incl. home, after sign-in) except the
    // wedding invite, which stays full-screen, and Periods, where the log
    // drop takes the same slot on purpose so switching tabs reads as one
    // button changing its mind rather than two buttons fighting.
    if (page !== 'wedding' && page !== 'periods') buildPingButton();
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
    if (typing) { pill.classList.add('typing'); pill.innerHTML = '<span class="pres-dot"></span>✍️ ' + name + ' is writing you something…'; return; }
    pill.classList.remove('typing');
    var msg;
    if (data.activity === 'reading') msg = '💌 ' + name + ' is reading ' + (data.activityLabel ? '“' + escHtml(data.activityLabel) + '”' : 'your notes');
    else if (data.activity === 'drawing') msg = '✏️ ' + name + ' is doodling…';
    else msg = '💌 ' + name + ' is here right now';
    pill.innerHTML = '<span class="pres-dot"></span>' + msg;
  }
  function buildPresencePill() {
    if (document.getElementById('presPill')) return;
    var p = document.createElement('div'); p.id = 'presPill'; p.className = 'pres-pill';
    body.appendChild(p);
  }
  function timeAgoShort(ms) {
    var s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.floor(h / 24); if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
    var w = Math.floor(d / 7); return w + (w === 1 ? ' week ago' : ' weeks ago');
  }
  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /* "last seen" line under the day counter (home page). Shows the OTHER person. */
  function renderLastSeen(data, other) {
    var el = document.querySelector('[data-lastseen]');
    if (!el) return;
    var name = other === 'parv' ? 'Parv' : 'Riti';
    if (!data) { el.style.display = 'none'; return; }
    var ms = data.atMs || 0;
    var online = !data.gone && !data.hidden && ms && (Date.now() - ms < 70000);
    if (online) {
      var icon = '💌', txt;   // 💌 is the base (reading + just-here); drawing/writing swap it. Never a flower here.
      if (data.typing) { icon = '✍️'; txt = name + ' is writing you something…'; }
      else if (data.activity === 'reading') txt = name + ' is reading ' + (data.activityLabel ? '“' + escHtml(data.activityLabel) + '”' : 'your notes');
      else if (data.activity === 'drawing') { icon = '✏️'; txt = name + ' is doodling…'; }
      else txt = name + ' is here right now';
      el.style.display = ''; el.innerHTML = '<span class="ls-flower">' + icon + '</span>' + txt;
      return;
    }
    if (!ms) { el.style.display = 'none'; return; }
    var line = '<span class="ls-flower">💌</span>' + name + ' was here ' + timeAgoShort(ms);
    if (data.lastOpenedTitle) line += ' <span class="ls-note">· last opened “' + escHtml(data.lastOpenedTitle) + '”</span>';
    el.style.display = ''; el.innerHTML = line;
  }
  /* ── optional "home / away" ambient line (home page, line 3). Symmetric: each
     person sees the other's. Physical home state comes only from the geofence
     Shortcuts via the Worker (homeState/<person> = {atHome, since}); the app
     never sees location. Shown only when this viewer's n_away toggle is on
     (Notifications matrix; default on). ── */
  var homeStateOther = null, homeStateTog = null;   // cached snapshots so the tick can re-heal
  function setupHomeState(other) {
    var el = document.querySelector('[data-homestate]');
    if (!el || !cdb) return;
    el.style.display = 'none';
    var me = (window.__parvritiUser && window.__parvritiUser.person) || null;
    cdb.collection('settings').doc('app').get().then(function (s) {
      var d = s.exists ? (s.data() || {}) : {};
      if (d['n_away_' + me] === false) return;   // this viewer turned their home/away line off (default on)
      cdb.collection('homeState').doc(other).onSnapshot(function (snap) {
        homeStateOther = snap.exists ? snap.data() : null;
        renderHomeState(el, other);
      }, function () {});
      // shared "together" flag (a boolean + time, never a location), written by
      // the worker when an arrival puts you both at the same place.
      cdb.collection('homeState').doc('together').onSnapshot(function (snap) {
        homeStateTog = snap.exists ? snap.data() : null;
        renderHomeState(el, other);
      }, function () {});
      setInterval(function () { renderHomeState(el, other); }, 60000);   // re-heal a stale "home"/"together"
    }).catch(function () {});
  }
  function renderHomeState(el, other) {
    if (!el) return;
    // Trust the arrive/leave automations - they flip home/away (and together) on
    // real events now. This cap is only a LAST-RESORT for a totally-missed Leave,
    // so it must sit ABOVE a normal continuous stay - and Parv + Riti are both
    // home a lot (full days, long weekends). 12h wrongly flipped a genuinely-home
    // 20h stay to "away"; 72h clears a 3-day stay.
    var STALE = 72 * 3600 * 1000;
    // "Together right now" wins over the per-person line when you're both in.
    var t = homeStateTog;
    if (t && t.together && t.since && (Date.now() - t.since < STALE)) {
      el.style.display = ''; el.innerHTML = '<span class="hs-heart">♡</span>Together right now';
      return;
    }
    var data = homeStateOther;
    var name = other === 'parv' ? 'Parv' : 'Riti';
    if (!data) { el.style.display = 'none'; return; }
    var atHome = !!data.atHome, since = data.since || 0;
    if (atHome && since && (Date.now() - since > STALE)) atHome = false;   // self-heal a missed Leave
    el.style.display = '';
    el.innerHTML = '<span class="hs-heart">♡</span>' + name + (atHome ? ' is home' : ' is away');
  }
  function buildPingButton() {
    if (document.getElementById('loveFab')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'loveFab'; b.className = 'love-fab';
    b.setAttribute('aria-label', 'Send a heartbeat');
    b.innerHTML = '<span class="lf-heart">💗</span>';
    body.appendChild(b);
    b.addEventListener('click', function () {
      b.classList.remove('tap'); void b.offsetWidth; b.classList.add('tap');
      if (window.parvritiSendLove) window.parvritiSendLove();
    });
  }
  function pulseHeart(data) {
    var from = data && data.from;
    var name = from === 'parv' ? 'Parv' : (from === 'riti' ? 'Riti' : 'Someone');
    var emoji = (data && data.emoji) || '💗';
    var text = (data && data.text) || (name + ' is thinking of you');
    var ov = document.createElement('div');
    ov.className = 'love-pulse';
    ov.innerHTML = '<div class="love-heart">' + escHtml(emoji) + '</div><div class="love-text">' + escHtml(text) + '</div>';
    body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('go'); });
    if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    setTimeout(function () {
      ov.classList.remove('go');
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 300);
    }, 1200);
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

  /* ══════════════ celebrations: birthdays (confetti blast) + anniversary (fireworks) ══════════════
     Dormant every normal day. Fires only on the three dates, or when forced with
     ?celebrate=riti|pavu|anniv (or ?celebrate=off) for QA on any day. Step 1 = Home takeover only.
     Called from unlock() inside a try/catch, and every entry point here re-guards, so a hiccup can
     never break a page. */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function celebOccasion() {
    var forced = null;
    try { forced = new URLSearchParams(INITIAL_SEARCH).get('celebrate'); } catch (e) {}
    if (forced === 'off') return null;
    var kind = (forced === 'riti' || forced === 'pavu' || forced === 'anniv') ? forced : null;
    if (!kind) {
      var d = new Date(), md = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
      if (md === '04-20') kind = 'riti'; else if (md === '12-10') kind = 'pavu'; else if (md === '07-29') kind = 'anniv';
    }
    if (!kind) return null;
    var y = new Date().getFullYear() - 2019; if (y < 1) y = 1;
    return { kind: kind, years: y, forced: !!forced };
  }
  function celebrate() {
    var occ = celebOccasion();
    if (!occ) return;
    body.classList.add('celebrating');
    try { celebAmbient(occ); } catch (e) {}   // all-day ambient decor, every page, BEHIND all content
    if (page !== 'home') return;   // the full-screen takeover opening is Home only
    var quick = false;
    if (!occ.forced) {
      var key = 'celebSeen_' + occ.kind + '_' + new Date().toDateString();
      try { quick = localStorage.getItem(key) === '1'; localStorage.setItem(key, '1'); } catch (e) {}
    }
    try { runTakeover(occ, quick); } catch (e) {}
  }
  /* compact particle engine on a full-screen canvas */
  function celebEngine(cv) {
    var ctx = cv.getContext('2d'), W = 0, H = 0, dpr = 1, ps = [], em = [], raf = null, run = false, last = 0;
    function size() { dpr = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size(); window.addEventListener('resize', size);
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pick(a) { return a[(Math.random() * a.length) | 0]; }
    function confetti(x, y, o) { o = o || {}; var lng = Math.random() < (o.longp || 0);
      ps.push({ t: 'c', x: x, y: y, vx: (o.vx != null ? o.vx : rnd(-1.4, 1.4)), vy: (o.vy != null ? o.vy : rnd(-2, 1)), g: (o.g != null ? o.g : 0.05),
        w: lng ? 2.4 : rnd(3, 7), h: lng ? rnd(12, 22) : rnd(5, 10), rot: rnd(0, 6), vr: rnd(-0.4, 0.4), c: o.c, life: o.life || rnd(140, 240), ph: rnd(0, 6) }); }
    function spark(x, y, c, s) { var a = rnd(0, 6.28); ps.push({ t: 's', x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.05, r: rnd(1.4, 2.8), c: c, life: rnd(38, 66) }); }
    function firework(x, y, c) { for (var i = 0; i < 46; i++) spark(x, y, c, rnd(1.6, 4.6)); for (var j = 0; j < 8; j++) confetti(x, y, { c: c, vy: rnd(-1, 1), g: 0.03, life: rnd(60, 110) }); }
    function rocket(x, c, toY) { ps.push({ t: 'r', x: x, y: H + 8, vx: rnd(-0.3, 0.3), vy: -rnd(6, 8), g: 0.03, c: c, toY: toY, ex: false, life: 260 }); }
    function step(dt) {
      for (var e = em.length - 1; e >= 0; e--) { var m = em[e]; m.acc += dt; while (m.acc >= m.every) { m.acc -= m.every; m.fn(); } if (m.until != null) { m.until -= dt; if (m.until <= 0) em.splice(e, 1); } }
      ctx.clearRect(0, 0, W, H);
      for (var i = ps.length - 1; i >= 0; i--) { var p = ps[i]; p.life -= dt;
        if (p.t === 'r') { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; ctx.globalAlpha = 1; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, 6.28); ctx.fill();
          if ((p.vy >= -0.4 || p.y <= p.toY) && !p.ex) { p.ex = true; firework(p.x, p.y, p.c); p.life = 0; } if (p.life <= 0) ps.splice(i, 1); continue; }
        if (p.g) p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.rot != null) p.rot += p.vr * dt;
        var a = p.life < 40 ? Math.max(0, p.life / 40) : 1; ctx.globalAlpha = a;
        if (p.t === 'c') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.6 + 0.4 * Math.abs(Math.sin(p.ph)))); ctx.restore(); }
        else { ctx.globalAlpha = a * a; ctx.fillStyle = p.c; ctx.shadowBlur = 8; ctx.shadowColor = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); ctx.shadowBlur = 0; }
        if (p.life <= 0 || p.y > H + 40) ps.splice(i, 1);
      }
      ctx.globalAlpha = 1;
    }
    function loop(ts) { if (!run) return; var dt = last ? Math.min(2.5, (ts - last) / 16.667) : 1; last = ts; step(dt); raf = requestAnimationFrame(loop); }
    return {
      W: function () { return W; }, H: function () { return H; }, rnd: rnd, pick: pick, confetti: confetti, rocket: rocket,
      emit: function (o) { em.push(o); },
      start: function () { if (!run) { run = true; last = 0; raf = requestAnimationFrame(loop); } },
      stop: function () { run = false; if (raf) cancelAnimationFrame(raf); ps = []; em = []; try { window.removeEventListener('resize', size); } catch (e) {} }
    };
  }
  /* a full party-popper confetti blast that fills the screen, then thins to a drift */
  function celebBlast(FX, cols) {
    var W = FX.W(), H = FX.H(), o = [[W * 0.1, H], [W * 0.3, H * 1.02], [W * 0.5, H * 1.02], [W * 0.7, H * 1.02], [W * 0.9, H]];
    o.forEach(function (p) { for (var i = 0; i < 24; i++) { var ang = FX.rnd(-2.5, -0.64), sp = FX.rnd(8, 16); FX.confetti(p[0], p[1], { c: FX.pick(cols), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.16, longp: 0.32, life: FX.rnd(130, 240) }); } });
    for (var j = 0; j < 46; j++) { var a = FX.rnd(0, 6.28), s = FX.rnd(3, 12); FX.confetti(W * 0.5, H * 0.42, { c: FX.pick(cols), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3.5, g: 0.15, life: FX.rnd(130, 240) }); }
    FX.emit({ every: 4, acc: 0, until: 700, fn: function () { FX.confetti(FX.rnd(0, W), -8, { c: FX.pick(cols), vy: FX.rnd(2.5, 6), g: 0.05, life: FX.rnd(120, 200) }); } });
    FX.emit({ every: 8, acc: 0, until: 1800, fn: function () { FX.confetti(FX.rnd(0, W), -8, { c: FX.pick(cols), vy: FX.rnd(1.5, 4), g: 0.04 }); } });
  }
  function runTakeover(occ, quick) {
    if (document.getElementById('celebOverlay')) return;
    var reduce = false; try { reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches; } catch (e) {}
    var ov = document.createElement('div'); ov.id = 'celebOverlay'; ov.className = 'celeb-ov celeb-' + occ.kind;
    var cv = document.createElement('canvas'); cv.className = 'celeb-fx';
    var stage = document.createElement('div'); stage.className = 'celeb-stage';
    ov.appendChild(cv); ov.appendChild(stage); body.appendChild(ov);
    var FX = celebEngine(cv); FX.start();
    if (occ.kind === 'anniv') annivScene(stage, FX, occ, quick, reduce);
    else birthdayScene(stage, FX, occ, quick, reduce);
    var life = quick ? 2800 : 6400, done = false;
    function finish() { if (done) return; done = true; ov.classList.add('out'); setTimeout(function () { try { FX.stop(); } catch (e) {} if (ov.parentNode) ov.parentNode.removeChild(ov); }, 900); }
    var hold = false; try { hold = /[?&]hold\b/.test(INITIAL_SEARCH); } catch (e) {}   // QA aid: ?celebrate=riti&hold keeps it up
    if (!hold) setTimeout(finish, life);
    ov.addEventListener('click', finish);   // tap to dismiss early
  }
  function birthdayScene(stage, FX, occ, quick, reduce) {
    var riti = occ.kind === 'riti';
    var cols = riti ? ['#ff4f8b', '#ffd76a', '#ff9ec2', '#ffffff', '#ff77a8'] : ['#5b8cff', '#ffd76a', '#a9c4ff', '#ffffff', '#8fb0ff'];
    stage.className = 'celeb-stage graffiti ' + occ.kind;
    stage.innerHTML = '<div class="cg cg1" style="color:#ffd76a">HAPPY</div>' +
      '<div class="cg cg2" style="color:' + (riti ? '#ff9ec2' : '#5b8cff') + '">BIRTHDAY</div>' +
      (riti ? '<div class="cg cg3" style="color:#ff4f8b">RITI</div>' : '');
    var els = stage.querySelectorAll('.cg');
    if (reduce) { Array.prototype.forEach.call(els, function (n) { n.classList.add('in'); }); celebBlast(FX, cols); return; }
    var delays = [120, 340, 640];
    Array.prototype.forEach.call(els, function (n, i) { setTimeout(function () { n.classList.add('in'); }, delays[i] || 300); });
    setTimeout(function () { celebBlast(FX, cols); }, quick ? 200 : 1000);
  }
  function annivScene(stage, FX, occ, quick, reduce) {
    var cols = ['#ff7d9c', '#ffd9a0', '#ffb3c8', '#ffffff', '#f7c873'];   // Rose Champagne
    stage.className = 'celeb-stage anniv';
    stage.innerHTML = '<div class="ca-title">Happy Anniversary</div><div class="ca-years">' + occ.years + ' YEARS OF US</div>';
    var t = stage.querySelector('.ca-title'), yr = stage.querySelector('.ca-years');
    if (reduce) { t.style.opacity = 1; yr.style.opacity = 1; }
    else {
      t.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 800, delay: 400, fill: 'forwards' });
      yr.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 1100, fill: 'forwards' });
    }
    var W = FX.W(), H = FX.H();
    function launch() { FX.rocket(FX.rnd(W * 0.2, W * 0.8), FX.pick(cols), FX.rnd(H * 0.14, H * 0.42)); }
    if (reduce) { for (var i = 0; i < 6; i++) launch(); return; }
    setTimeout(launch, quick ? 100 : 200); setTimeout(launch, 650); setTimeout(launch, 1100);
    FX.emit({ every: 44, acc: 0, until: null, fn: launch });
    FX.emit({ every: 20, acc: 0, until: null, fn: function () { FX.confetti(FX.rnd(0, W), -10, { c: FX.pick(cols), vy: FX.rnd(0.5, 1.2), g: 0.015 }); } });
  }
  /* all-day ambient: a fixed layer BELOW the app content (z-index -1), so it shows only where the
     page is empty and is covered by every card / pad / cork / FAB / nav. Lightweight CSS animation,
     no all-day canvas loop. Occasion-coloured; reads on both themes. */
  function ambientCfg(kind) {
    if (kind === 'pavu') return { cols: ['#5b8cff', '#ffd76a', '#a9c4ff', '#dbe6ff'], glyphs: ['🎂', '🎉', '🕯️', '🎈', '💙', '✨', '❄️', '🌟'], words: ['P', 'पर्व'], wcol: '#a9c4ff' };
    if (kind === 'anniv') return { cols: ['#ff7d9c', '#ffd9a0', '#ffb3c8', '#fff0d8'], glyphs: ['💍', '💗', '🌹', '🌸', '🥂', '🎉', '✨', '🌷'], words: ['रिति', 'पर्व', 'RITI', 'PARV', '♥'], wcol: '#ffb3c8' };
    return { cols: ['#ff4f8b', '#ffd76a', '#ff9ec2', '#fff0f4'], glyphs: ['🎂', '🎉', '🕯️', '🎈', '🌸', '🌷', '💗', '✨'], words: ['RITI', 'R', 'रिति'], wcol: '#ff9ec2' };
  }
  function celebAmbient(occ) {
    if (document.getElementById('celebAmbient')) return;
    // load a refined Devanagari serif for रिति / पर्व, only on a celebration day (no year-round cost)
    try { if (!document.getElementById('celebDevaFont')) { var lk = document.createElement('link'); lk.id = 'celebDevaFont'; lk.rel = 'stylesheet'; lk.href = 'https://fonts.googleapis.com/css2?family=Tiro+Devanagari+Hindi&display=swap'; document.head.appendChild(lk); } } catch (e) {}
    var c = ambientCfg(occ.kind), amb = document.createElement('div'), r = Math.random, h = '', i;
    amb.id = 'celebAmbient'; amb.className = 'celeb-amb'; amb.setAttribute('aria-hidden', 'true');
    var n = 18; try { n = Math.max(16, Math.min(32, Math.round(window.innerWidth / 24))); } catch (e) {}   // a touch denser on iPad/Mac
    for (i = 0; i < n; i++) {
      var left = (r() * 100).toFixed(1), dur = (7 + r() * 8).toFixed(1), del = (-r() * 15).toFixed(1), roll = r();
      if (roll < 0.32) h += '<span class="ca-bit" style="left:' + left + '%;width:' + (4 + r() * 5).toFixed(0) + 'px;height:' + (7 + r() * 7).toFixed(0) + 'px;background:' + c.cols[(r() * c.cols.length) | 0] + ';animation-duration:' + dur + 's;animation-delay:' + del + 's"></span>';
      else if (roll < 0.84) h += '<span class="ca-petal" style="left:' + left + '%;font-size:' + (12 + r() * 9).toFixed(0) + 'px;animation-duration:' + dur + 's;animation-delay:' + del + 's">' + c.glyphs[(r() * c.glyphs.length) | 0] + '</span>';
      else { var w = c.words[(r() * c.words.length) | 0]; h += '<span class="ca-word" style="left:' + left + '%;font-size:' + (w.length > 1 ? (12 + r() * 4) : (15 + r() * 6)).toFixed(0) + 'px;color:' + c.wcol + ';animation-duration:' + dur + 's;animation-delay:' + del + 's">' + w + '</span>'; }
    }
    [['4%', '60%', 26], ['92%', '68%', 22], ['7%', '86%', 24], ['88%', '40%', 20]].forEach(function (b) {
      h += '<span class="ca-bloom" style="left:' + b[0] + ';top:' + b[1] + ';font-size:' + b[2] + 'px">' + c.glyphs[(r() * c.glyphs.length) | 0] + '</span>';
    });
    // Insert it EARLY in the DOM (right after the .bg-base backdrop) at z-index 0: it paints above the
    // backdrop (so the decor is visible) but below every later-in-DOM page element (cards, pad, cork,
    // text, FAB, nav), so it shows only in empty areas and can never cover content.
    amb.innerHTML = h;
    var bg = document.querySelector('.bg-base');
    if (bg && bg.parentNode) bg.parentNode.insertBefore(amb, bg.nextSibling);
    else document.body.insertBefore(amb, document.body.firstChild);
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
