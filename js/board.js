/* =====================================================================
   board.js - "Our Board" (board.html)

   A cork wall the two of you fill together with reason-notes and photos.
   You DRAG each thing onto the grid and tap ✓ to pin it exactly where you
   want. Drop one tile ONTO another and they STACK into a little pile you can
   swipe through. The board grows forever, so the reasons never run out. An
   edit mode moves / stacks / takes things down. Everything syncs live between
   the two phones. NOTHING here sends a notification.
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
// color is stored per note and flows into an inline style (and shade()); whitelist it to a hex so a
// crafted value can't break out of the attribute (XSS) and a non-string can't crash shade().
function safeColor(c) { return /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#fff2a8'; }

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
var bonusRows = 0;            // extra rows added by the "＋ more room" button

function boardEl() { return document.getElementById('board'); }
function cellSize() { var w = (boardEl() && boardEl().clientWidth) || 300; return Math.floor(w / COLS); }
function gap() { return Math.max(6, Math.round(cellSize() * 0.1)); }
function slotOf(it) { return (typeof it.slot === 'number') ? it.slot : 0; }

/* group every item by its slot - a slot with more than one item is a STACK */
function cellsBySlot() {
  var m = {};
  items.forEach(function (it) { var s = slotOf(it); (m[s] = m[s] || []).push(it); });
  Object.keys(m).forEach(function (s) { m[s].sort(function (a, b) { return millis(a.createdAt) - millis(b.createdAt); }); });
  return m;
}
function maxRow() {
  var m = -1;
  items.forEach(function (it) { var r = Math.floor(slotOf(it) / COLS); if (r > m) m = r; });
  if (pending && pending.slot != null) { var pr = Math.floor(pending.slot / COLS); if (pr > m) m = pr; }
  return m;
}
function rowCount() { return Math.max(6, maxRow() + 2) + bonusRows; }   // always a spare row + any manual "more room"
function cellXY(slot) { var cs = cellSize(); return { c: slot % COLS, r: Math.floor(slot / COLS), x: (slot % COLS) * cs, y: Math.floor(slot / COLS) * cs, cs: cs }; }
function firstEmpty() {
  var cells = cellsBySlot(), total = rowCount() * COLS;
  for (var s = 0; s < total; s++) if (!(cells[s] && cells[s].length)) return s;
  return total;
}
function dropCell(cx, cy) {   // the exact grid cell a point lands in (clamped)
  var cs = cellSize(), R = rowCount();
  var c = Math.max(0, Math.min(COLS - 1, Math.floor(cx / cs)));
  var r = Math.max(0, Math.min(R - 1, Math.floor(cy / cs)));
  return r * COLS + c;
}

var dragActive = false;   // true while a tile is being dragged; pauses snapshot rebuilds so the drag isn't destroyed mid-move
/* ── live feed ── */
function startItems() {
  if (!rdb) {   // no connection: say so, don't show the "nothing pinned yet, tap + " invite as if the wall were just empty
    var be = document.getElementById('boardEmpty');
    if (be) {
      var t = be.querySelector('.be-title'), s = be.querySelector('.be-sub');
      if (t) t.textContent = "can't reach the wall right now";
      if (s) s.textContent = 'check your connection and reopen 🌸';
    }
    renderBoard(); return;
  }
  try {
    rdb.collection('roomItems').orderBy('createdAt', 'asc').onSnapshot(function (snap) {
      items = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      if (dragActive) return;   // a drag is in progress: keep items fresh but don't rebuild the DOM now; end() re-renders
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
function singleTileEl(slot, it, num) {
  var el = document.createElement(editing ? 'div' : 'button');
  if (!editing) el.type = 'button';
  el.className = 'tile ' + (it.type === 'photo' ? 'photo' : 'note');
  el.dataset.slot = slot;
  el.style.setProperty('--r', (it.rot != null ? it.rot : 0) + 'deg');
  if (it.type !== 'photo') { var color = safeColor(it.color); el.style.background = 'linear-gradient(158deg,' + color + ',' + shade(color) + ')'; }
  el.innerHTML = tileInner(it, num[it.id]);
  return el;
}
function coverDiv(it, no) {   // the visible face of a stack (visual only, no events)
  var el = document.createElement('div');
  el.className = 'tile cover ' + (it.type === 'photo' ? 'photo' : 'note');
  if (it.type !== 'photo') { var c = safeColor(it.color); el.style.background = 'linear-gradient(158deg,' + c + ',' + shade(c) + ')'; }
  el.innerHTML = tileInner(it, no);
  return el;
}
function stackTileEl(slot, stack, num) {
  var cover = stack[stack.length - 1];   // newest sits on top of the pile
  var el = document.createElement(editing ? 'div' : 'button');
  if (!editing) el.type = 'button';
  el.className = 'stackwrap';
  el.dataset.slot = slot;
  el.style.setProperty('--r', (cover.rot != null ? cover.rot : 0) + 'deg');
  el.setAttribute('aria-label', 'a stack of ' + stack.length);
  var p2 = document.createElement('span'); p2.className = 'peek p2';
  var p1 = document.createElement('span'); p1.className = 'peek p1';
  var cnt = document.createElement('span'); cnt.className = 'scount'; cnt.textContent = stack.length;
  el.appendChild(p2); el.appendChild(p1);
  el.appendChild(coverDiv(cover, num[cover.id]));
  el.appendChild(cnt);
  return el;
}
function renderBoard() {
  var b = boardEl(); if (!b) return;
  var cs = cellSize(), R = rowCount();
  b.style.height = (R * cs) + 'px';
  b.innerHTML = '';
  document.body.classList.toggle('placing', !!pending);
  document.body.classList.toggle('editing', editing);

  var cells = cellsBySlot();

  // faint grid cells for the empty squares while placing or editing
  if (pending || editing) {
    for (var s = 0; s < R * COLS; s++) {
      if (cells[s] && cells[s].length) continue;
      if (pending && !pending._committing && pending.slot === s) continue;
      var gh = document.createElement('div'); gh.className = 'cellghost'; gh.dataset.slot = s;
      placeEl(gh, s); b.appendChild(gh);
    }
  }

  var num = noteNumbers();
  Object.keys(cells).forEach(function (sk) {
    var slot = +sk, stack = cells[slot], isStack = stack.length > 1;
    var el = isStack ? stackTileEl(slot, stack, num) : singleTileEl(slot, stack[0], num);
    placeEl(el, slot);
    if (editing) {
      el.classList.add('editing');
      var x = document.createElement('button'); x.type = 'button'; x.className = 'tdel'; x.innerHTML = '✕';
      x.addEventListener('click', function (ev) { ev.stopPropagation(); isStack ? askRemoveStack(stack) : askRemove(stack[0]); });
      el.appendChild(x);
      makeDraggable(el, function (cx, cy) {
        var target = dropCell(cx, cy);
        if (target === slot) { renderBoard(); return; }
        batchSetSlot(stack.map(function (i) { return i.id; }), target);   // move, or stack/merge if target is taken
      });
    } else {
      el.addEventListener('click', function () {
        if (isStack) openStack(stack);
        else if (stack[0].type === 'photo') openPhoto(stack[0]);
        else openNote(stack[0], num[stack[0].id]);
      });
    }
    b.appendChild(el);
  });

  if (pending) renderPending();
  var empty = document.getElementById('boardEmpty');
  if (empty) empty.style.display = (items.length || pending) ? 'none' : '';
}

/* ── dragging (placement + edit-move); drop resolves to the cell under the tile ── */
function clearHighlights() { document.querySelectorAll('.hot, .stack-target').forEach(function (e) { e.classList.remove('hot', 'stack-target'); }); }
function highlightDrop(cx, cy, dragEl) {
  var slot = dropCell(cx, cy);
  document.querySelectorAll('.cellghost').forEach(function (g) { g.classList.toggle('hot', +g.dataset.slot === slot); });
  document.querySelectorAll('.tile[data-slot], .stackwrap[data-slot]').forEach(function (t) {
    t.classList.toggle('stack-target', +t.dataset.slot === slot && t !== dragEl && !t.classList.contains('dragging'));
  });
}
function makeDraggable(el, onDrop) {
  var sx, sy, ox, oy, moved, dragging = false;
  function end() {
    if (!dragging) return;
    dragging = false; dragActive = false; el.classList.remove('dragging');
    window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
    clearHighlights();
    if (!moved || !el.isConnected) { renderBoard(); return; }   // no move, or the tile got rebuilt out from under the drag: just resync
    var cs = cellSize(), g = gap(), sz = cs - g;
    var nx = parseFloat(el.style.left), ny = parseFloat(el.style.top);
    onDrop(nx + sz / 2, ny + sz / 2);
  }
  el.addEventListener('pointerdown', function (e) {
    if (e.target.closest && e.target.closest('.tdel')) return;
    e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {}
    dragging = true; dragActive = true; moved = false; el.classList.add('dragging');
    sx = e.clientX; sy = e.clientY; ox = parseFloat(el.style.left); oy = parseFloat(el.style.top);
    // window-level net: a release anywhere - or after the tile is destroyed (e.g. a mid-drag resize) -
    // still runs end(), so dragActive can never stick true and freeze live snapshot rebuilds.
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  });
  el.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var nx = ox + (e.clientX - sx), ny = oy + (e.clientY - sy);
    if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) moved = true;
    el.style.left = nx + 'px'; el.style.top = ny + 'px';
    var cs = cellSize(), g = gap(), sz = cs - g;
    highlightDrop(nx + sz / 2, ny + sz / 2, el);
  });
}
function batchSetSlot(ids, slot) {
  if (!rdb) return;
  var batch = rdb.batch();
  ids.forEach(function (id) { batch.update(rdb.collection('roomItems').doc(id), { slot: slot }); });
  batch.commit().catch(function (e) { console.warn('move', e); });
}

/* ── placement: the pending tile with ✓ / ✕ (drop it on a spot, or onto a tile to stack) ── */
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
  var cells = cellsBySlot();
  var stacking = !!(cells[pending.slot] && cells[pending.slot].length);
  var el = document.createElement('div');
  el.className = 'tile pending ' + (pending.type === 'photo' ? 'photo' : 'note') + (stacking ? ' will-stack' : '');
  el.style.setProperty('--r', pending.rot + 'deg');
  if (pending.type !== 'photo') { var color = safeColor(pending.color); el.style.background = 'linear-gradient(158deg,' + color + ',' + shade(color) + ')'; }
  el.innerHTML = tileInner({ type: pending.type, text: pending.text, img: pending.img, by: pending.by }, '');
  placeEl(el, pending.slot);
  makeDraggable(el, function (cx, cy) { pending.slot = dropCell(cx, cy); renderBoard(); });
  b.appendChild(el);
  if (stacking) { var t = b.querySelector('.tile[data-slot="' + pending.slot + '"], .stackwrap[data-slot="' + pending.slot + '"]'); if (t) t.classList.add('stack-target'); }

  var xy = cellXY(pending.slot), g = gap();
  var hint = document.createElement('div'); hint.className = 'place-hint';
  hint.style.left = (xy.x + xy.cs / 2) + 'px'; hint.style.top = (xy.y - 12) + 'px';
  hint.textContent = stacking ? 'drop here to stack ✦' : 'drag me anywhere';
  b.appendChild(hint);

  var conf = document.createElement('div'); conf.className = 'place-confirm';
  conf.style.left = (xy.x + xy.cs / 2) + 'px';
  conf.style.top = (xy.y + xy.cs + 2) + 'px';
  conf.innerHTML = '<button type="button" class="pc-no" aria-label="discard">✕</button><button type="button" class="pc-yes" aria-label="' + (stacking ? 'stack it' : 'pin it') + '">✓</button>';
  conf.querySelector('.pc-yes').addEventListener('click', commitPending);
  conf.querySelector('.pc-no').addEventListener('click', cancelPending);
  b.appendChild(conf);
}
function commitPending() {
  if (!pending) return;
  if (!rdb) { toast('no connection'); return; }
  var cells = cellsBySlot(), stacking = !!(cells[pending.slot] && cells[pending.slot].length);
  var isPhoto = pending.type === 'photo';
  var by = pending.by, other = by === 'parv' ? 'riti' : 'parv';   // the pin's author -> notify the other
  var doc = { type: pending.type, by: pending.by, rot: pending.rot, slot: pending.slot, createdAt: serverTime() };
  if (isPhoto) doc.img = pending.img; else { doc.text = pending.text; doc.color = pending.color; }
  var saved = pending;   // keep the composed pin so a failed write can restore it instead of losing it
  rdb.collection('roomItems').add(doc)
    .then(function () {
      toast(stacking ? 'stacked 🌸' : (isPhoto ? 'pinned a moment 📷' : 'pinned 🌸'));
      if (window.parvritiNotify) window.parvritiNotify(other, (by === 'parv' ? 'Parv' : 'Riti') + (isPhoto ? ' pinned a photo 📌' : ' pinned a reason 📌'), '', 'https://parvriti.github.io/board.html?n=1', 'board');
    })
    .catch(function () {
      if (!pending) { pending = saved; renderBoard(); }   // nothing new placed since: put the tile back so it can be retried
      toast('could not pin, tap ✓ to try again');
    });
  pending = null; renderBoard();
}
function cancelPending() { pending = null; renderBoard(); toast('threw it away'); }

/* ── readers ── */
function bigNoteInner(it, no) {
  var color = safeColor(it.color);
  var who = it.by === 'parv' ? 'Pavu' : 'Riti';
  return '<div class="big-note" style="background:linear-gradient(158deg,' + color + ',' + shade(color) + ')">' +
    '<div class="bn-kick">reason i love you · #' + (no || '') + '</div>' +
    '<div class="bn-txt">' + esc(it.text) + '</div>' +
    '<div class="bn-sig">yours, ' + who + '</div>' +
    '<div class="bn-date">pinned ' + fmtWhen(it.createdAt) + '</div></div>';
}
function bigPhotoInner(it) {
  var who = it.by === 'parv' ? 'Pavu' : 'Riti';
  return '<div class="big-photo"><img src="' + esc(it.img) + '" alt="a moment of us"/>' +
    '<div class="bp-cap">pinned ' + fmtWhen(it.createdAt) + ' by ' + who + '</div></div>';
}
function openNote(it, no) { overlay(bigNoteInner(it, no), 'note-ov'); }
function openPhoto(it) { overlay(bigPhotoInner(it), 'photo-ov'); }

/* ── the stack viewer: swipe through the pile ── */
function openStack(stack) {
  var num = noteNumbers();
  stack = stack.slice().reverse();   // newest (the face of the pile) first
  var cards = stack.map(function (it) {
    var inner = it.type === 'photo' ? bigPhotoInner(it) : bigNoteInner(it, num[it.id]);
    var acts = '<div class="sv-acts">' +
      '<button type="button" class="sv-act sv-unstack" data-id="' + esc(it.id) + '">↗ take out of stack</button>' +
      (it.by === me() ? '<button type="button" class="sv-act sv-del" data-id="' + esc(it.id) + '">take it down</button>' : '') +
      '</div>';
    return '<div class="sv-card">' + inner + acts + '</div>';
  }).join('');
  var dots = stack.map(function (_, i) { return '<span class="sv-dot' + (i === 0 ? ' on' : '') + '"></span>'; }).join('');
  var body = '<div class="stack-view">' +
    '<div class="sv-head">a little stack · <span id="svPos">1</span> / ' + stack.length + '</div>' +
    '<div class="sv-track" id="svTrack">' + cards + '</div>' +
    '<div class="sv-dots">' + dots + '</div></div>';
  var ov = overlay(body, 'stack-ov');
  var track = ov.querySelector('#svTrack'), dotsEl = ov.querySelectorAll('.sv-dot'), posEl = ov.querySelector('#svPos');
  function upd() {
    var i = track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : 0;
    i = Math.max(0, Math.min(stack.length - 1, i));
    posEl.textContent = i + 1;
    dotsEl.forEach(function (d, j) { d.classList.toggle('on', j === i); });
  }
  track.addEventListener('scroll', function () { requestAnimationFrame(upd); }, { passive: true });
  ov.querySelectorAll('.sv-unstack').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var slot = firstEmpty();
      if (rdb) rdb.collection('roomItems').doc(btn.dataset.id).update({ slot: slot }).then(function () { toast('pulled it out'); }).catch(function () { toast('could not pull it out, try again'); });
      ov._close();
    });
  });
  ov.querySelectorAll('.sv-del').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!window.confirm('Take this down for good?')) return;
      if (rdb) rdb.collection('roomItems').doc(btn.dataset.id).delete().catch(function () { toast('could not take it down, try again'); });
      ov._close();
    });
  });
}

/* ── removals ── */
function askRemove(it) {
  if (!window.confirm(it.type === 'photo' ? 'Take this photo down?' : 'Take this note down?')) return;
  if (rdb) rdb.collection('roomItems').doc(it.id).delete().catch(function () { toast('could not take it down, try again'); });
}
function askRemoveStack(stack) {
  if (!window.confirm('Take down all ' + stack.length + ' in this stack?')) return;
  if (!rdb) return;
  var batch = rdb.batch();
  stack.forEach(function (it) { batch.delete(rdb.collection('roomItems').doc(it.id)); });
  batch.commit().catch(function () { toast('could not take them down, try again'); });
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
    var url; try { url = c.toDataURL('image/jpeg', 0.72); } catch (e) { URL.revokeObjectURL(img.src); toast('could not read that photo'); return; }
    if (url.length > 980000) { toast('that photo is a bit large, try another'); URL.revokeObjectURL(img.src); return; }
    URL.revokeObjectURL(img.src);
    startPlacing({ type: 'photo', img: url, by: me() });
  };
  img.onerror = function () { URL.revokeObjectURL(img.src); toast('could not read that photo'); };
  img.src = URL.createObjectURL(file);
}

/* ── edit mode ── */
function toggleEdit() {
  if (pending) { cancelPending(); }
  editing = !editing;
  var btn = document.getElementById('editBoard');
  if (btn) { btn.classList.toggle('on', editing); btn.textContent = editing ? '✓ done' : '✎ edit'; }
  renderBoard();
  if (editing) toast('drag to move · drop onto another to stack · ✕ to take down');
}

/* ── grow the board on demand ── */
function addMoreRoom() {
  bonusRows += 2;
  renderBoard();
  toast('more room to love ✦');
  var b = boardEl(); if (b && b.scrollIntoView) b.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
  var mr = document.getElementById('moreRoom'); if (mr) mr.addEventListener('click', addMoreRoom);
  var pi = document.getElementById('photoInput'); if (pi) pi.addEventListener('change', function () { if (this.files && this.files[0]) handlePhoto(this.files[0]); this.value = ''; });
  window.addEventListener('resize', function () { clearTimeout(_rezT); _rezT = setTimeout(function () { if (dragActive) return; renderBoard(); }, 160); });   // don't rebuild mid-drag (it would destroy the dragged tile); end() re-renders on release
  startItems();
}
if (window.__parvritiAuthed) startBoard();
else window.addEventListener('parvriti-authed', startBoard, { once: true });
