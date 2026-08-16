/* =====================================================================
   room.js — "Our Room" (room.html)

   A cosy, tactile wall the two of you fill together: reason sticky-notes
   and photos pinned in the order they were made (tap any to read/enlarge),
   a shared doodle pad, a jar of little notes, and scratch-off surprises.
   Everything syncs live between the two phones. NOTHING here sends a
   notification — it's just for us, for fun.
   ===================================================================== */

/* ── Firebase (compat, initialised by common.js) ── */
var firebaseConfig = {
  apiKey: "AIzaSyBW_EMfKIkIJDNSMPUp6UeHOGtIdv26Wpk",
  authDomain: "parvriti.firebaseapp.com",
  projectId: "parvriti",
  storageBucket: "parvriti.firebasestorage.app",
  messagingSenderId: "598106428796",
  appId: "1:598106428796:web:bcb49b129377d9a5d6c0f9"
};
var rdb = null;
try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    rdb = firebase.firestore();
  }
} catch (e) { console.warn('room firestore init failed', e); }
function serverTime() { try { return firebase.firestore.FieldValue.serverTimestamp(); } catch (e) { return Date.now(); } }

function me() { return (window.__parvritiUser && window.__parvritiUser.person) || 'parv'; }
function meName() { return me() === 'parv' ? 'Pavu' : 'Riti'; }
function otherName() { return me() === 'parv' ? 'Riti' : 'Pavu'; }

/* ── helpers ── */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(m) {
  var t = document.getElementById('roomToast'); if (!t) return;
  t.textContent = m; t.classList.add('on'); clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove('on'); }, 2000);
}
function millis(ts) { return ts && ts.toMillis ? ts.toMillis() : (typeof ts === 'number' ? ts : 0); }
function fmtWhen(ts) {
  var ms = millis(ts); if (!ms) return 'just now';
  var d = new Date(ms), mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var diff = (Date.now() - ms) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) { var m = Math.floor(diff / 60); return m + (m === 1 ? ' minute ago' : ' minutes ago'); }
  if (diff < 86400) { var h = Math.floor(diff / 3600); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
  return d.getDate() + ' ' + mo[d.getMonth()] + ' ' + d.getFullYear();
}
var NOTE_COLORS = ['#fff2a8', '#ffc7d4', '#c9efd8', '#bfe1ff', '#e6ccff', '#ffd6b0', '#d7f2b0', '#ffd0c2', '#c8ecf0'];
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function rndRot() { return (Math.random() * 6 - 3).toFixed(1); }
function shade(hex) {
  var c = hex.replace('#', ''); var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  return 'rgb(' + Math.max(0, r - 24) + ',' + Math.max(0, g - 24) + ',' + Math.max(0, b - 24) + ')';
}

/* ── overlay plumbing ── */
function overlay(inner, cls) {
  var ov = document.createElement('div');
  ov.className = 'room-ov' + (cls ? ' ' + cls : '');
  ov.innerHTML = '<button class="room-ov-x" type="button" aria-label="close">✕</button><div class="room-ov-in">' + inner + '</div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function () { ov.classList.add('show'); });
  function close() { ov.classList.remove('show'); setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 260); }
  ov.querySelector('.room-ov-x').addEventListener('click', close);
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  ov._close = close;
  return ov;
}

/* =====================  the wall (notes + photos)  ===================== */
var items = [];
function startItems() {
  if (!rdb) return;
  try {
    rdb.collection('roomItems').orderBy('createdAt', 'asc').onSnapshot(function (snap) {
      items = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      renderBoard();
    }, function (e) { console.warn('roomItems listen', e); });
  } catch (e) { console.warn(e); }
}
function renderBoard() {
  var board = document.getElementById('board'); if (!board) return;
  board.innerHTML = '';
  document.getElementById('boardEmpty').style.display = items.length ? 'none' : '';
  var noteNo = 0;
  items.forEach(function (it, i) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.style.setProperty('--r', rot(it) + 'deg');
    tile.style.animationDelay = Math.min(i * 0.012, 0.5) + 's';
    if (it.type === 'photo') {
      tile.className = 'tile photo';
      tile.innerHTML = '<span class="tack ' + (it.by === 'parv' ? '' : 'b') + '"></span><img loading="lazy" src="' + esc(it.img) + '" alt="a moment of us"/>';
      tile.addEventListener('click', function () { openPhoto(it); });
    } else {
      noteNo++;
      var no = noteNo, color = it.color || '#fff2a8';
      tile.className = 'tile note';
      tile.style.background = 'linear-gradient(158deg,' + color + ',' + shade(color) + ')';
      tile.innerHTML = '<span class="tack ' + (it.by === 'parv' ? '' : 'b') + '"></span>' +
        '<span class="tnum">#' + no + '</span>' +
        '<span class="ttxt">' + esc(it.text) + '</span>';
      tile.addEventListener('click', function () { openNote(it, no); });
    }
    board.appendChild(tile);
  });
}
function rot(it) { if (it._rot == null) it._rot = (it.rot != null ? it.rot : rndRot()); return it._rot; }

function openNote(it, no) {
  var color = it.color || '#fff2a8';
  var who = it.by === 'parv' ? 'Pavu' : 'Riti';
  var body = '<div class="big-note" style="background:linear-gradient(158deg,' + color + ',' + shade(color) + ')">' +
    '<div class="bn-kick">reason i love you · #' + no + '</div>' +
    '<div class="bn-txt">' + esc(it.text) + '</div>' +
    '<div class="bn-sig">yours, ' + who + '</div>' +
    '<div class="bn-date">pinned ' + fmtWhen(it.createdAt) + '</div></div>' +
    (it.by === me() ? '<button class="room-del" type="button" data-del="' + it.id + '">take it down</button>' : '');
  var ov = overlay(body, 'note-ov');
  wireDelete(ov, 'roomItems', it.id);
}
function openPhoto(it) {
  var who = it.by === 'parv' ? 'Pavu' : 'Riti';
  var body = '<div class="big-photo"><img src="' + esc(it.img) + '" alt="a moment of us"/>' +
    '<div class="bp-cap">pinned ' + fmtWhen(it.createdAt) + ' by ' + who + '</div></div>' +
    (it.by === me() ? '<button class="room-del" type="button" data-del="' + it.id + '">take it down</button>' : '');
  var ov = overlay(body, 'photo-ov');
  wireDelete(ov, 'roomItems', it.id);
}
function wireDelete(ov, coll, id) {
  var b = ov.querySelector('[data-del]'); if (!b) return;
  b.addEventListener('click', function () {
    if (!window.confirm('Take this down for good?')) return;
    if (rdb) rdb.collection(coll).doc(id).delete().catch(function (e) { console.warn(e); });
    ov._close();
  });
}

/* ── pin a reason ── */
function pinReasonUI() {
  var body = '<div class="composer-card"><h3>pin a reason</h3>' +
    '<textarea id="rrText" maxlength="180" placeholder="a small true thing…"></textarea>' +
    '<div class="cc-row"><span class="cc-who">signing as ' + meName() + '</span>' +
    '<button class="cc-btn" id="rrPin" type="button">pin it 🌸</button></div></div>';
  var ov = overlay(body, 'composer-ov');
  var ta = ov.querySelector('#rrText'); setTimeout(function () { ta.focus(); }, 80);
  ov.querySelector('#rrPin').addEventListener('click', function () {
    var v = ta.value.trim(); if (!v) { ta.focus(); return; }
    if (!rdb) { toast('no connection'); return; }
    rdb.collection('roomItems').add({ type: 'note', text: v, by: me(), color: pick(NOTE_COLORS), rot: +rndRot(), createdAt: serverTime() })
      .then(function () { toast('pinned 🌸'); }).catch(function () { toast('could not pin'); });
    ov._close();
  });
}

/* ── pin a photo ── */
function pinPhotoUI() { document.getElementById('photoInput').click(); }
function handlePhoto(file) {
  if (!file || !rdb) return;
  toast('adding your photo…');
  var img = new Image();
  img.onload = function () {
    var maxE = 620, s = Math.min(1, maxE / Math.max(img.width, img.height));
    var cw = Math.round(img.width * s), ch = Math.round(img.height * s);
    var c = document.createElement('canvas'); c.width = cw; c.height = ch;
    c.getContext('2d').drawImage(img, 0, 0, cw, ch);
    var url; try { url = c.toDataURL('image/jpeg', 0.72); } catch (e) { toast('could not read that photo'); return; }
    if (url.length > 980000) { toast('that photo is a bit large, try another'); return; }
    rdb.collection('roomItems').add({ type: 'photo', img: url, by: me(), rot: +rndRot(), createdAt: serverTime() })
      .then(function () { toast('pinned a moment 📷'); }).catch(function () { toast('could not pin the photo'); });
    URL.revokeObjectURL(img.src);
  };
  img.onerror = function () { toast('could not read that photo'); };
  img.src = URL.createObjectURL(file);
}

/* =====================  doodle pad (shared)  ===================== */
var pad, pctx, strokes = [], drawColor = '#c0425a', drawing = false, curPts = null, lastXY = null;
function startDoodle() {
  pad = document.getElementById('pad'); if (!pad) return;
  pctx = pad.getContext('2d'); pctx.lineCap = 'round'; pctx.lineJoin = 'round';
  document.querySelectorAll('.swatch').forEach(function (sw) {
    sw.addEventListener('click', function () {
      document.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
      sw.classList.add('sel'); drawColor = sw.dataset.c;
    });
  });
  document.getElementById('clearPad').addEventListener('click', clearDoodle);
  pad.addEventListener('pointerdown', dStart);
  pad.addEventListener('pointermove', dMove);
  pad.addEventListener('pointerup', dEnd);
  pad.addEventListener('pointercancel', dEnd);
  if (rdb) {
    try {
      rdb.collection('canvasStrokes').orderBy('at', 'asc').onSnapshot(function (snap) {
        strokes = snap.docs.map(function (d) { return d.data(); });
        redraw();
        var last = strokes.length ? strokes[strokes.length - 1] : null;
        document.getElementById('padBy').textContent = last ? ('last doodled by ' + (last.by === 'parv' ? 'Pavu' : 'Riti')) : 'draw something silly together';
      }, function (e) { console.warn('strokes', e); });
    } catch (e) { console.warn(e); }
  }
}
function pxy(e) { var r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height) }; }
function redraw() {
  pctx.clearRect(0, 0, pad.width, pad.height);
  strokes.forEach(function (s) { drawStroke(s.pts, s.color); });
}
function drawStroke(pts, color) {
  if (!pts || !pts.length) return;
  pctx.strokeStyle = color || '#c0425a'; pctx.lineWidth = 5;
  pctx.beginPath(); pctx.moveTo(pts[0].x, pts[0].y);
  for (var i = 1; i < pts.length; i++) pctx.lineTo(pts[i].x, pts[i].y);
  if (pts.length === 1) pctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
  pctx.stroke();
}
function dStart(e) { e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (er) {} drawing = true; var p = pxy(e); curPts = [p]; lastXY = p; drawStroke(curPts, drawColor); }
function dMove(e) { if (!drawing) return; var p = pxy(e); if (curPts.length < 400) curPts.push(p); pctx.strokeStyle = drawColor; pctx.lineWidth = 5; pctx.beginPath(); pctx.moveTo(lastXY.x, lastXY.y); pctx.lineTo(p.x, p.y); pctx.stroke(); lastXY = p; }
function dEnd() {
  if (!drawing) return; drawing = false;
  if (curPts && curPts.length && rdb) {
    var pts = curPts.map(function (p) { return { x: Math.round(p.x), y: Math.round(p.y) }; });
    rdb.collection('canvasStrokes').add({ pts: pts, color: drawColor, by: me(), at: serverTime() }).catch(function () {});
  }
  curPts = null;
}
function clearDoodle() {
  if (!rdb) { pctx.clearRect(0, 0, pad.width, pad.height); return; }
  if (!window.confirm('Wipe the doodle for both of you?')) return;
  pctx.clearRect(0, 0, pad.width, pad.height);
  rdb.collection('canvasStrokes').get().then(function (snap) {
    var batch = rdb.batch(); snap.docs.forEach(function (d) { batch.delete(d.ref); }); return batch.commit();
  }).then(function () { toast('cleared the pad'); }).catch(function () {});
}

/* =====================  the jar  ===================== */
var jarNotes = [];
function startJar() {
  buildJar();
  document.getElementById('jar').addEventListener('click', openJar);
  if (!rdb) return;
  try {
    rdb.collection('jarNotes').onSnapshot(function (snap) {
      jarNotes = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      buildJar();
    }, function (e) { console.warn('jarNotes', e); });
  } catch (e) { console.warn(e); }
}
function buildJar() {
  var glass = document.getElementById('jarGlass'); if (!glass) return;
  glass.innerHTML = '';
  var cols = ['#ffc7d4', '#bfe1ff', '#fff2a8', '#c9efd8', '#e6ccff', '#ffd6b0'];
  var n = Math.max(4, Math.min(11, jarNotes.length || 6));
  for (var i = 0; i < n; i++) {
    var sl = document.createElement('div'); sl.className = 'slip'; sl.style.background = cols[i % cols.length];
    sl.style.left = (5 + Math.random() * 30) + 'px'; sl.style.bottom = (4 + i * 6.5) + 'px';
    sl.style.transform = 'rotate(' + (Math.random() * 40 - 20) + 'deg)'; glass.appendChild(sl);
  }
}
function openJar() {
  var jar = document.getElementById('jar'); jar.classList.remove('pop'); void jar.offsetWidth; jar.classList.add('pop');
  if (!jarNotes.length) { addToJarUI(true); return; }
  var note = jarNotes[Math.floor(Math.random() * jarNotes.length)];
  var who = note.by === 'parv' ? 'Pavu' : 'Riti';
  var body = '<div class="jar-slip"><div class="js-paper"><div class="js-txt">' + esc(note.text) + '</div>' +
    (note.by ? '<div class="js-by">— ' + who + '</div>' : '') + '</div></div>' +
    '<div class="jar-actions"><button class="cc-btn ghost" id="jarAdd" type="button">＋ add one</button>' +
    '<button class="cc-btn" id="jarMore" type="button">draw another</button></div>';
  var ov = overlay(body, 'jar-ov');
  ov.querySelector('#jarMore').addEventListener('click', function () { ov._close(); setTimeout(openJar, 200); });
  ov.querySelector('#jarAdd').addEventListener('click', function () { ov._close(); setTimeout(function () { addToJarUI(false); }, 200); });
}
function addToJarUI(empty) {
  var body = '<div class="composer-card"><h3>' + (empty ? 'the jar is empty — fill it' : 'add to the jar') + '</h3>' +
    '<textarea id="jnText" maxlength="160" placeholder="a memory, a compliment, an inside joke…"></textarea>' +
    '<div class="cc-row"><span class="cc-who">from ' + meName() + '</span>' +
    '<button class="cc-btn" id="jnAdd" type="button">drop it in 🫙</button></div></div>';
  var ov = overlay(body, 'composer-ov');
  var ta = ov.querySelector('#jnText'); setTimeout(function () { ta.focus(); }, 80);
  ov.querySelector('#jnAdd').addEventListener('click', function () {
    var v = ta.value.trim(); if (!v) { ta.focus(); return; }
    if (rdb) rdb.collection('jarNotes').add({ text: v, by: me(), createdAt: serverTime() }).then(function () { toast('dropped in the jar 🫙'); }).catch(function () {});
    ov._close();
  });
}

/* =====================  scratch surprises (one hides, the other reveals)  ===================== */
var scratchCards = [];
function startScratch() {
  document.getElementById('scratchStack').addEventListener('click', openScratch);
  if (!rdb) return;
  try {
    rdb.collection('scratchCards').orderBy('createdAt', 'asc').onSnapshot(function (snap) {
      scratchCards = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      renderScratchStack();
    }, function (e) { console.warn('scratchCards', e); });
  } catch (e) { console.warn(e); }
}
function mineToScratch() { return scratchCards.filter(function (c) { return c.from !== me() && !c.revealedAt; }); }
function renderScratchStack() {
  var stack = document.getElementById('scratchStack'), cnt = document.getElementById('scratchCount');
  var mine = mineToScratch();
  var face = stack.querySelector('.scard-face');
  if (mine.length) { stack.classList.add('has'); face.textContent = 'scratch to reveal'; cnt.style.display = ''; cnt.textContent = mine.length; }
  else { stack.classList.remove('has'); face.textContent = 'hide one for ' + otherName(); cnt.style.display = 'none'; }
}
function openScratch() {
  var mine = mineToScratch();
  if (!mine.length) { hideScratchUI(); return; }
  var card = mine[0];
  var body = '<div class="scratch-big"><div class="sb-note">' + esc(card.text) + '</div>' +
    '<canvas id="scCanvas" width="320" height="380"></canvas>' +
    '<div class="sb-hint" id="scHint">scratch with your finger ✦</div></div>' +
    '<div class="jar-actions"><button class="cc-btn ghost" id="scHide" type="button">＋ hide one back</button></div>';
  var ov = overlay(body, 'scratch-ov');
  ov.querySelector('#scHide').addEventListener('click', function () { ov._close(); setTimeout(function () { hideScratchUI(); }, 200); });
  var cv = ov.querySelector('#scCanvas'), sx = cv.getContext('2d'), revealed = false, cleared = 0, down = false;
  var g = sx.createLinearGradient(0, 0, cv.width, cv.height); g.addColorStop(0, '#c9b48f'); g.addColorStop(.5, '#e7d7b4'); g.addColorStop(1, '#b79f74');
  sx.fillStyle = g; sx.fillRect(0, 0, cv.width, cv.height);
  sx.fillStyle = 'rgba(90,60,20,.55)'; sx.font = '700 26px -apple-system,sans-serif'; sx.textAlign = 'center'; sx.fillText('scratch ✦', cv.width / 2, cv.height / 2);
  function sp(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; }
  function scr(p) { sx.globalCompositeOperation = 'destination-out'; sx.beginPath(); sx.arc(p.x, p.y, 24, 0, 7); sx.fill(); cleared++; if (cleared > 40 && !revealed) finish(); }
  function finish() {
    revealed = true;
    ov.querySelector('#scHint').textContent = '';
    cv.style.transition = 'opacity .6s'; cv.style.opacity = '0';
    if (rdb) rdb.collection('scratchCards').doc(card.id).update({ revealedAt: serverTime() }).catch(function () {});
  }
  cv.addEventListener('pointerdown', function (e) { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (er) {} down = true; scr(sp(e)); });
  cv.addEventListener('pointermove', function (e) { if (down) scr(sp(e)); });
  cv.addEventListener('pointerup', function () { down = false; });
}
function hideScratchUI() {
  var body = '<div class="composer-card"><h3>hide a note for ' + otherName() + '</h3>' +
    '<p class="cc-note">they\'ll scratch it off to find it.</p>' +
    '<textarea id="scText" maxlength="160" placeholder="a little secret…"></textarea>' +
    '<div class="cc-row"><span class="cc-who">from ' + meName() + '</span>' +
    '<button class="cc-btn" id="scAdd" type="button">hide it ✦</button></div></div>';
  var ov = overlay(body, 'composer-ov');
  var ta = ov.querySelector('#scText'); setTimeout(function () { ta.focus(); }, 80);
  ov.querySelector('#scAdd').addEventListener('click', function () {
    var v = ta.value.trim(); if (!v) { ta.focus(); return; }
    if (rdb) rdb.collection('scratchCards').add({ text: v, from: me(), revealedAt: null, createdAt: serverTime() }).then(function () { toast('hidden for ' + otherName() + ' ✦'); }).catch(function () {});
    ov._close();
  });
}

/* =====================  ambient (lights + candle)  ===================== */
function startAmbient() {
  var lights = document.getElementById('lights');
  if (lights) for (var i = 0; i < 11; i++) { var b = document.createElement('div'); b.className = 'bulb'; b.style.left = (4 + i * 9.1) + '%'; b.style.top = (11 + Math.sin(i * 1.1) * 3) + 'px'; b.style.animationDelay = (i * 0.37) + 's'; lights.appendChild(b); }
  var candle = document.getElementById('candle');
  if (candle) candle.addEventListener('click', function () { candle.classList.toggle('lit'); });
  var hr = new Date().getHours();
  if (hr >= 19 || hr < 6) { document.body.classList.add('room-night'); if (candle) candle.classList.add('lit'); }
}

/* =====================  boot  ===================== */
function startRoom() {
  startAmbient();
  startDoodle();
  var ar = document.getElementById('addReason'); if (ar) ar.addEventListener('click', pinReasonUI);
  var ap = document.getElementById('addPhoto'); if (ap) ap.addEventListener('click', pinPhotoUI);
  var pi = document.getElementById('photoInput'); if (pi) pi.addEventListener('change', function () { if (this.files && this.files[0]) handlePhoto(this.files[0]); this.value = ''; });
  startItems();
  startJar();
  startScratch();
}
if (window.__parvritiAuthed) startRoom();
else window.addEventListener('parvriti-authed', startRoom, { once: true });
