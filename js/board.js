/* =====================================================================
   board.js — "Our Board" (board.html)

   A cork wall the two of you fill together with reason-notes and photos.
   Nothing here is auto-placed: when you add something you DRAG it onto the
   grid and tap ✓ to pin it exactly where you want (or ✕ to throw it away).
   An edit mode lets you move or take down anything later. Everything syncs
   live between the two phones. NOTHING here sends a notification.
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
} catch (e) { console.warn('board firestore init failed', e); }
function serverTime() { try { return firebase.firestore.FieldValue.serverTimestamp(); } catch (e) { return Date.now(); } }

function me() { return (window.__parvritiUser && window.__parvritiUser.person) || 'parv'; }
function meName() { return me() === 'parv' ? 'Pavu' : 'Riti'; }

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
function rndRot() { return +(Math.random() * 6 - 3).toFixed(1); }
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

/* =====================  the grid  ===================== */
var COLS = 4;                 // columns across the wall
var items = [];               // live items from Firestore
var editing = false;          // edit-mode toggle
var pending = null;           // { type, text?, color?, img?, by, rot, slot }

function boardEl() { return document.getElementById('board'); }
function cellSize() { var w = (boardEl() && boardEl().clientWidth) || 300; return Math.floor(w / COLS); }
function gap() { return Math.max(6, Math.round(cellSize() * 0.1)); }
function slotOf(it) { return (typeof it.slot === 'number') ? it.slot : 0; }
function maxRow() {
  var m = -1;
  items.forEach(function (it) { var r = Math.floor(slotOf(it) / COLS); if (r > m) m = r; });
  if (pending && pending.slot != null) { var pr = Math.floor(pending.slot / COLS); if (pr > m) m = pr; }
  return m;
}
function rowCount() { return Math.max(5, maxRow() + 2); }             // always keep a spare row to drop into
function cellXY(slot) { var cs = cellSize(); return { c: slot % COLS, r: Math.floor(slot / COLS), x: (slot % COLS) * cs, y: Math.floor(slot / COLS) * cs, cs: cs }; }
function occupiedSet(excludeId) {
  var o = {};
  items.forEach(function (it) { if (excludeId && it.id === excludeId) return; o[slotOf(it)] = true; });
  if (pending && pending.slot != null && !(pending._committing)) o[pending.slot] = true;
  return o;
}
function firstEmpty() {
  var o = occupiedSet(), total = rowCount() * COLS;
  for (var s = 0; s < total; s++) if (!o[s]) return s;
  return total;
}
function nearestEmpty(px, py, excludeId) {
  var o = occupiedSet(excludeId), cs = cellSize(), total = rowCount() * COLS, best = firstEmpty(), bd = Infinity;
  for (var s = 0; s < total; s++) {
    if (o[s]) continue;
    var c = s % COLS, r = Math.floor(s / COLS), cx = c * cs + cs / 2, cy = r * cs + cs / 2;
    var d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/* ── live feed ── */
function startItems() {
  if (!rdb) { renderBoard(); return; }
  try {
    rdb.collection('roomItems').orderBy('createdAt', 'asc').onSnapshot(function (snap) {
      items = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      renderBoard();
    }, function (e) { console.warn('roomItems listen', e); });
  } catch (e) { console.warn(e); }
}

/* ── render ── */
function noteNumbers() {
  var order = items.slice().sort(function (a, b) { return millis(a.createdAt) - millis(b.createdAt); });
  var num = {}, k = 0;
  order.forEach(function (it) { if (it.type !== 'photo') { k++; num[it.id] = k; } });
  return num;
}
function tileInner(it, no) {
  var tackCls = it.by === 'parv' ? '' : 'b';
  if (it.type === 'photo') {
    return '<span class="tack ' + tackCls + '"></span><img loading="lazy" src="' + esc(it.img) + '" alt="a moment of us"/>';
  }
  var numTag = no ? '<span class="tnum">#' + no + '</span>' : '';
  return '<span class="tack ' + tackCls + '"></span>' + numTag + '<span class="ttxt">' + esc(it.text) + '</span>';
}
function placeEl(el, slot) {
  var xy = cellXY(slot), g = gap(), size = xy.cs - g;
  el.style.left = (xy.x + g / 2) + 'px';
  el.style.top = (xy.y + g / 2) + 'px';
  el.style.width = size + 'px';
  el.style.height = size + 'px';
}
function renderBoard() {
  var b = boardEl(); if (!b) return;
  var cs = cellSize(), R = rowCount();
  b.style.height = (R * cs) + 'px';
  b.innerHTML = '';
  document.body.classList.toggle('placing', !!pending);
  document.body.classList.toggle('editing', editing);

  // faint grid cells while placing or editing
  if (pending || editing) {
    var occ = occupiedSet(), g = gap();
    for (var s = 0; s < R * COLS; s++) {
      if (occ[s]) continue;
      var gh = document.createElement('div'); gh.className = 'cellghost'; gh.dataset.slot = s;
      placeEl(gh, s); b.appendChild(gh);
    }
  }

  var num = noteNumbers();
  items.forEach(function (it) {
    var el = document.createElement(editing ? 'div' : 'button');
    if (!editing) el.type = 'button';
    el.className = 'tile ' + (it.type === 'photo' ? 'photo' : 'note');
    el.style.setProperty('--r', (it.rot != null ? it.rot : 0) + 'deg');
    if (it.type !== 'photo') { var color = it.color || '#fff2a8'; el.style.background = 'linear-gradient(158deg,' + color + ',' + shade(color) + ')'; }
    el.innerHTML = tileInner(it, num[it.id]);
    placeEl(el, slotOf(it));
    if (editing) {
      el.classList.add('editing');
      var x = document.createElement('button'); x.type = 'button'; x.className = 'tdel'; x.innerHTML = '✕';
      x.addEventListener('click', function (ev) { ev.stopPropagation(); askRemove(it); });
      el.appendChild(x);
      makeDraggable(el, it.id, function (slot) {
        if (slot === slotOf(it)) return;
        if (rdb) rdb.collection('roomItems').doc(it.id).update({ slot: slot }).catch(function () {});
      });
    } else {
      el.addEventListener('click', function () { it.type === 'photo' ? openPhoto(it) : openNote(it, num[it.id]); });
    }
    b.appendChild(el);
  });

  if (pending) renderPending();
  var empty = document.getElementById('boardEmpty');
  if (empty) empty.style.display = (items.length || pending) ? 'none' : '';
}

/* ── dragging (shared by placement + edit-move) ── */
function highlightGhost(px, py, excludeId) {
  var slot = nearestEmpty(px, py, excludeId);
  document.querySelectorAll('.cellghost').forEach(function (g) { g.classList.toggle('hot', +g.dataset.slot === slot); });
  return slot;
}
function makeDraggable(el, excludeId, onDrop) {
  var sx, sy, ox, oy, moved, dragging = false;
  el._excludeId = excludeId;
  el.addEventListener('pointerdown', function (e) {
    if (e.target.classList && e.target.classList.contains('tdel')) return;
    e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {}
    dragging = true; moved = false; el.classList.add('dragging');
    sx = e.clientX; sy = e.clientY; ox = parseFloat(el.style.left); oy = parseFloat(el.style.top);
  });
  el.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var nx = ox + (e.clientX - sx), ny = oy + (e.clientY - sy);
    if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) moved = true;
    el.style.left = nx + 'px'; el.style.top = ny + 'px';
    var cs = cellSize(), g = gap(), sz = cs - g;
    highlightGhost(nx + sz / 2, ny + sz / 2, excludeId);
  });
  function end(e) {
    if (!dragging) return; dragging = false; el.classList.remove('dragging');
    var cs = cellSize(), g = gap(), sz = cs - g;
    var nx = parseFloat(el.style.left), ny = parseFloat(el.style.top);
    var slot = moved ? nearestEmpty(nx + sz / 2, ny + sz / 2, excludeId) : (excludeId ? slotForId(excludeId) : pending.slot);
    onDrop(slot);
  }
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
function slotForId(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return slotOf(items[i]); return 0; }

/* ── placement: the pending tile with ✓ / ✕ ── */
function startPlacing(obj) {
  pending = obj;
  pending.rot = (pending.rot != null) ? pending.rot : rndRot();
  pending.slot = firstEmpty();
  editing = false;
  renderBoard();
  var wall = document.getElementById('wall'); if (wall && wall.scrollIntoView) wall.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('drag it to a spot, then tap ✓');
}
function renderPending() {
  var b = boardEl();
  var el = document.createElement('div');
  el.className = 'tile pending ' + (pending.type === 'photo' ? 'photo' : 'note');
  el.style.setProperty('--r', pending.rot + 'deg');
  if (pending.type !== 'photo') { var color = pending.color || '#fff2a8'; el.style.background = 'linear-gradient(158deg,' + color + ',' + shade(color) + ')'; }
  el.innerHTML = tileInner({ type: pending.type, text: pending.text, img: pending.img, by: pending.by }, '');
  placeEl(el, pending.slot);
  makeDraggable(el, null, function (slot) { pending.slot = slot; renderBoard(); });
  b.appendChild(el);

  // ✓ / ✕ pinned just under the tile
  var xy = cellXY(pending.slot), g = gap();
  var conf = document.createElement('div'); conf.className = 'place-confirm';
  conf.style.left = (xy.x + xy.cs / 2) + 'px';
  conf.style.top = (xy.y + xy.cs + 2) + 'px';
  conf.innerHTML = '<button type="button" class="pc-no" aria-label="discard">✕</button><button type="button" class="pc-yes" aria-label="pin it">✓</button>';
  conf.querySelector('.pc-yes').addEventListener('click', commitPending);
  conf.querySelector('.pc-no').addEventListener('click', cancelPending);
  b.appendChild(conf);
}
function commitPending() {
  if (!pending) return;
  if (!rdb) { toast('no connection'); return; }
  var doc = { type: pending.type, by: pending.by, rot: pending.rot, slot: pending.slot, createdAt: serverTime() };
  if (pending.type === 'photo') doc.img = pending.img; else { doc.text = pending.text; doc.color = pending.color; }
  pending._committing = true;
  rdb.collection('roomItems').add(doc)
    .then(function () { toast(pending && pending.type === 'photo' ? 'pinned a moment 📷' : 'pinned 🌸'); })
    .catch(function () { toast('could not pin'); });
  pending = null; renderBoard();
}
function cancelPending() { pending = null; renderBoard(); toast('threw it away'); }

/* ── readers (tap to enlarge) ── */
function openNote(it, no) {
  var color = it.color || '#fff2a8';
  var who = it.by === 'parv' ? 'Pavu' : 'Riti';
  var body = '<div class="big-note" style="background:linear-gradient(158deg,' + color + ',' + shade(color) + ')">' +
    '<div class="bn-kick">reason i love you · #' + (no || '') + '</div>' +
    '<div class="bn-txt">' + esc(it.text) + '</div>' +
    '<div class="bn-sig">yours, ' + who + '</div>' +
    '<div class="bn-date">pinned ' + fmtWhen(it.createdAt) + '</div></div>';
  overlay(body, 'note-ov');
}
function openPhoto(it) {
  var who = it.by === 'parv' ? 'Pavu' : 'Riti';
  var body = '<div class="big-photo"><img src="' + esc(it.img) + '" alt="a moment of us"/>' +
    '<div class="bp-cap">pinned ' + fmtWhen(it.createdAt) + ' by ' + who + '</div></div>';
  overlay(body, 'photo-ov');
}
function askRemove(it) {
  if (!window.confirm(it.type === 'photo' ? 'Take this photo down?' : 'Take this note down?')) return;
  if (rdb) rdb.collection('roomItems').doc(it.id).delete().catch(function () {});
}

/* ── compose a reason ── */
function pinReasonUI() {
  var body = '<div class="composer-card"><h3>a reason i love you</h3>' +
    '<textarea id="rrText" maxlength="180" placeholder="a small true thing…"></textarea>' +
    '<div class="cc-row"><span class="cc-who">signing as ' + meName() + '</span>' +
    '<button class="cc-btn" id="rrPin" type="button">choose a spot →</button></div></div>';
  var ov = overlay(body, 'composer-ov');
  var ta = ov.querySelector('#rrText'); setTimeout(function () { ta.focus(); }, 80);
  ov.querySelector('#rrPin').addEventListener('click', function () {
    var v = ta.value.trim(); if (!v) { ta.focus(); return; }
    ov._close();
    setTimeout(function () { startPlacing({ type: 'note', text: v, by: me(), color: pick(NOTE_COLORS) }); }, 220);
  });
}

/* ── add a photo ── */
function pinPhotoUI() { document.getElementById('photoInput').click(); }
function handlePhoto(file) {
  if (!file) return;
  toast('preparing your photo…');
  var img = new Image();
  img.onload = function () {
    var maxE = 620, s = Math.min(1, maxE / Math.max(img.width, img.height));
    var cw = Math.round(img.width * s), ch = Math.round(img.height * s);
    var c = document.createElement('canvas'); c.width = cw; c.height = ch;
    c.getContext('2d').drawImage(img, 0, 0, cw, ch);
    var url; try { url = c.toDataURL('image/jpeg', 0.72); } catch (e) { toast('could not read that photo'); return; }
    if (url.length > 980000) { toast('that photo is a bit large, try another'); URL.revokeObjectURL(img.src); return; }
    URL.revokeObjectURL(img.src);
    startPlacing({ type: 'photo', img: url, by: me() });
  };
  img.onerror = function () { toast('could not read that photo'); };
  img.src = URL.createObjectURL(file);
}

/* ── edit mode ── */
function toggleEdit() {
  if (pending) { cancelPending(); }
  editing = !editing;
  var btn = document.getElementById('editBoard');
  if (btn) { btn.classList.toggle('on', editing); btn.textContent = editing ? '✓ done' : '✎ edit'; }
  renderBoard();
  if (editing) toast('drag to move · ✕ to take down');
}

/* ── ambient (fairy lights only) ── */
function startAmbient() {
  var lights = document.getElementById('lights');
  if (lights) for (var i = 0; i < 11; i++) { var d = document.createElement('div'); d.className = 'bulb'; d.style.left = (4 + i * 9.1) + '%'; d.style.top = (11 + Math.sin(i * 1.1) * 3) + 'px'; d.style.animationDelay = (i * 0.37) + 's'; lights.appendChild(d); }
  var hr = new Date().getHours();
  if (hr >= 19 || hr < 6) document.body.classList.add('room-night');
}

/* ── boot ── */
var _rezT = null;
function startBoard() {
  startAmbient();
  var ar = document.getElementById('addReason'); if (ar) ar.addEventListener('click', pinReasonUI);
  var ap = document.getElementById('addPhoto'); if (ap) ap.addEventListener('click', pinPhotoUI);
  var ed = document.getElementById('editBoard'); if (ed) ed.addEventListener('click', toggleEdit);
  var pi = document.getElementById('photoInput'); if (pi) pi.addEventListener('change', function () { if (this.files && this.files[0]) handlePhoto(this.files[0]); this.value = ''; });
  window.addEventListener('resize', function () { clearTimeout(_rezT); _rezT = setTimeout(renderBoard, 160); });
  startItems();
}
if (window.__parvritiAuthed) startBoard();
else window.addEventListener('parvriti-authed', startBoard, { once: true });
