/* =====================================================================
   doodle.js - "Doodles" (doodles.html)

   A shared sketch pad. Whatever one of you draws appears on the other's
   screen, live. A clear button wipes it for both. A gentle "left you a
   doodle" nudge is sent ~40s after the last stroke, while the pad stays open.
   ===================================================================== */

var firebaseConfig = {
  apiKey: "AIzaSyBW_EMfKIkIJDNSMPUp6UeHOGtIdv26Wpk",
  authDomain: "parvriti.firebaseapp.com",
  projectId: "parvriti",
  storageBucket: "parvriti.firebasestorage.app",
  messagingSenderId: "598106428796",
  appId: "1:598106428796:web:bcb49b129377d9a5d6c0f9"
};
var ddb = null;
try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    ddb = firebase.firestore();
  }
} catch (e) { console.warn('doodle firestore init failed', e); }
function serverTime() { try { return firebase.firestore.FieldValue.serverTimestamp(); } catch (e) { return Date.now(); } }
function me() { return (window.__parvritiUser && window.__parvritiUser.person) || 'parv'; }
function toast(m) {
  var t = document.getElementById('roomToast'); if (!t) return;
  t.textContent = m; t.classList.add('on'); clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove('on'); }, 2000);
}

var pad, pctx, strokes = [], drawColor = '#c0425a', drawSize = 6, drawing = false, curPts = null, lastXY = null, activePtr = null;   // 6 = the pre-selected medium nib
var pendingMine = [];   // finished strokes I just added, kept painted until their own doc echoes back
var ERASE = '#fffdf6';   // the canvas paper colour (styles.css .pad canvas) - erasing paints a stroke in it, which syncs + covers (at:serverTimestamp is null while pending, so an orderBy('at') snapshot omits them for ~½s and a redraw would erase them)
var tool = 'draw', penColor = '#c0425a', imgCache = {}, FILL_TOL = 32;   // fill tool: flood-fill on tap -> stored as a self-contained PNG patch (syncs pixel-identical); imgCache decodes patches for redraw
var brushMode = 'pen', curBrush = '';   // brushMode 'pen'|'water' (only while tool==='draw'); curBrush = the in-progress stroke's brush
var offc = null, offx = null, WATER_ALPHA = 0.34;   // offscreen buffer: a watercolor stroke is rendered opaque here, then laid down as ONE translucent layer (single stroke stays even; overlaps deepen)
var undoStack = [], undone = {};   // undoStack: {cid, ref} of items I added this session (newest last) - undo deletes my last one (syncs). undone: cids I deleted, filtered from snapshots until the delete lands (no flicker-back)
var doodleLoaded = false, doodleVeil = null;   // loading veil (first snapshot ends it)
/* ── kept doodles (the shelf) ── editMode edits a saved doodle LOCALLY (no live sync / no nudge);
   the live canvasStrokes snapshot keeps updating `strokes` in the background but does not repaint. */
var editMode = false, editItems = [], editingId = null, editName = '', editDirty = false;
var shelfUnsub = null, shelfDocs = [], viewerDoc = null;

function startDoodle() {
  pad = document.getElementById('pad'); if (!pad) return;
  if (startDoodle._on) return; startDoodle._on = true;   // one wiring only (mirrors startRealtime); a second auth re-fire must not stack listeners / a second onSnapshot
  pctx = pad.getContext('2d'); pctx.lineCap = 'round'; pctx.lineJoin = 'round';
  offc = document.createElement('canvas'); offc.width = pad.width; offc.height = pad.height;   // watercolor compositing buffer
  offx = offc.getContext('2d'); offx.lineCap = 'round'; offx.lineJoin = 'round';

  var eraseBtn = document.getElementById('eraseTool'), fillBtn = document.getElementById('fillTool'), waterBtn = document.getElementById('waterTool');
  function setTool(t) {   // colour (swatch) and tool (pen/erase/fill) are orthogonal
    tool = t;
    if (eraseBtn) eraseBtn.classList.toggle('on', t === 'erase');
    if (fillBtn) fillBtn.classList.toggle('on', t === 'fill');
    if (waterBtn) waterBtn.classList.toggle('on', t === 'draw' && brushMode === 'water');   // watercolor lights up only while it's the active drawing brush
    drawColor = (t === 'erase') ? ERASE : penColor;
  }
  if (waterBtn) waterBtn.addEventListener('click', function () {
    if (drawing) return;   // don't switch brush mid-stroke
    brushMode = (brushMode === 'water') ? 'pen' : 'water';
    setTool('draw');   // picking a brush means you're drawing, not erasing/filling
  });
  document.querySelectorAll('.swatch:not(.swatch-wheel)').forEach(function (sw) {
    sw.addEventListener('click', function () {
      if (drawing) return;   // a second finger must not recolour the stroke already in progress (commit stores one colour, so it would recolour retroactively)
      document.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
      sw.classList.add('sel'); penColor = sw.dataset.c; setTool('draw');   // picking a colour returns to the pen
    });
  });
  // custom colour: the wheel swatch wraps a native <input type=color>. iOS opens its OWN (GPU-smooth)
  // picker - no hand-rolled canvas wheel to lag. The chosen hex flows through the exact same `color`
  // field as every preset, so it syncs to the other person with zero model change. Remembered per device.
  (function () {
    var cc = document.getElementById('customColor'), sw = document.getElementById('customSwatch');
    if (!cc || !sw) return;
    try { var saved = localStorage.getItem('doodleCustomColor'); if (saved && /^#[0-9a-f]{6}$/i.test(saved)) { cc.value = saved; sw.style.setProperty('--cc', saved); sw.classList.add('picked'); } } catch (e) {}
    function apply() {
      if (drawing) return;
      var v = cc.value;
      document.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
      sw.classList.add('sel', 'picked'); sw.style.setProperty('--cc', v);
      penColor = v; setTool('draw');
    }
    cc.addEventListener('input', apply);    // live while dragging in the native picker (pen + swatch update)
    cc.addEventListener('change', function () { apply(); try { localStorage.setItem('doodleCustomColor', cc.value); } catch (e) {} });   // persist ONCE on close, not on every live tick
  })();
  document.querySelectorAll('.nib').forEach(function (nb) {
    nb.addEventListener('click', function () {   // nib sets size for pen AND eraser
      if (drawing) return;   // don't resize the stroke already in progress mid-way
      document.querySelectorAll('.nib').forEach(function (x) { x.classList.remove('sel'); });
      nb.classList.add('sel'); drawSize = +nb.dataset.s;
    });
  });
  if (eraseBtn) eraseBtn.addEventListener('click', function () { setTool('erase'); });
  if (fillBtn) fillBtn.addEventListener('click', function () { setTool('fill'); });   // fill uses the selected swatch colour; tap the canvas to flood a region
  var un = document.getElementById('undoTool'); if (un) un.addEventListener('click', undoLast);
  var cl = document.getElementById('clearPad'); if (cl) cl.addEventListener('click', clearDoodle);
  // kept doodles: Keep button, the shelf entry, its close, tapping a card, and the editor bar
  var kp = document.getElementById('keepBtn'); if (kp) kp.addEventListener('click', keepDoodle);
  var scn = document.getElementById('shelfCorner'); if (scn) scn.addEventListener('click', openShelf);
  var scl = document.getElementById('shelfClose'); if (scl) scl.addEventListener('click', closeShelf);
  var eb = document.getElementById('editBack'); if (eb) eb.addEventListener('click', closeEditor);
  var esv = document.getElementById('editSave'); if (esv) esv.addEventListener('click', function () { saveEditor(); });
  var sbody = document.getElementById('shelfBody');
  if (sbody) sbody.addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('.sd-card') : null; if (!c) return;
    var i = +c.getAttribute('data-i'); if (shelfDocs[i]) openViewer(shelfDocs[i]);
  });

  pad.addEventListener('pointerdown', dStart);
  pad.addEventListener('pointermove', dMove);
  pad.addEventListener('pointerup', dEnd);
  pad.addEventListener('pointercancel', dEnd);
  window.addEventListener('pointerup', dEnd); window.addEventListener('pointercancel', dEnd);   // safety net: end the stroke even if a release lands off the pad or setPointerCapture failed (else drawing stays stuck true)
  window.addEventListener('pagehide', sendDoodleNudge);   // doodle-and-leave still nudges (don't rely only on the 40s timer)
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { if (drawing) dEnd(); sendDoodleNudge(); } });   // iOS PWA backgrounds via visibilitychange, not pagehide; also end any active stroke so a mid-stroke background can't leave drawing stuck true (dEnd commits + resets)

  doodleVeil = window.parvritiLoadVeil ? window.parvritiLoadVeil('doodleLoad') : null;
  if (ddb) {
    try {
      ddb.collection('canvasStrokes').orderBy('at', 'asc').onSnapshot(function (snap) {
        strokes = snap.docs.map(function (d) { return d.data(); });
        var present = {}; strokes.forEach(function (s) { if (s.cid) present[s.cid] = true; });
        for (var uc in undone) if (!present[uc]) delete undone[uc];   // an undone item's delete has landed -> stop filtering it
        strokes = strokes.filter(function (s) { return !(s.cid && undone[s.cid]); });   // hide items I just undid until their delete confirms (no flicker-back)
        if (!strokes.length) { pendingMine = []; undoStack = []; undone = {}; if (!editMode) imgCache = {}; }   // a wipe (or empty pad): drop my unconfirmed items + undo history; keep the editor's decoded fills while editing
        else {
          if (pendingMine.length) {   // drop mine that echoed back (cid), or expired after ~12s (e.g. deleted before its echo)
            var have = {}, cutoff = Date.now() - 12000;
            strokes.forEach(function (s) { if (s.cid) have[s.cid] = true; });
            pendingMine = pendingMine.filter(function (p) { return !have[p.cid] && p.t > cutoff; });
          }
          var keep = {};   // prune decoded fill patches whose doc is gone (e.g. the other person undid a fill) - imgCache would otherwise grow for the whole session; anything still shown is re-decoded on demand
          strokes.forEach(function (s) { if (s.cid) keep[s.cid] = true; });
          pendingMine.forEach(function (p) { if (p.cid) keep[p.cid] = true; });
          if (editMode) editItems.forEach(function (it) { if (it && it.cid) keep[it.cid] = true; });   // don't evict the editor's fills while editing
          for (var ic in imgCache) if (!keep[ic]) delete imgCache[ic];
        }
        if (!editMode) { paintAll(); updateKeepBtn(); }   // editor keeps its own paint; live strokes still tracked in the background so closing restores them; refresh the Keep/kept toggle
        var last = strokes.length ? strokes[strokes.length - 1] : null;
        var by = document.getElementById('padBy');
        if (by) by.textContent = last ? ('last doodled by ' + (last.by === 'parv' ? 'Pavu' : 'Riti')) : 'draw something silly together';
        if (!doodleLoaded) { doodleLoaded = true; if (doodleVeil) doodleVeil.done(); }   // first snapshot: strokes are painted, end the veil exactly here
      }, function (e) { console.warn('strokes', e); if (!doodleLoaded && doodleVeil) doodleVeil.fail("couldn't load, check your connection"); });
    } catch (e) { console.warn(e); if (!doodleLoaded && doodleVeil) doodleVeil.fail("couldn't load, check your connection"); }
  } else if (doodleVeil) { doodleVeil.fail("couldn't load, check your connection"); }
  attachShelf();   // load the shelf on startup so Keep knows the kept-state right away (no duplicate saves on reopen)
}
function pxy(e) { var r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height) }; }
/* draw one item in order: a fill patch (stamp its cached PNG) or a stroke */
function paintItem(it) {
  if (!it) return;
  if (it.png) {   // a fill patch
    var im = imgCache[it.cid];
    if (!im) { im = new Image(); imgCache[it.cid] = im; im.onload = scheduleRepaint; im.src = it.png; }   // decode async, then repaint
    if (im.complete && im.naturalWidth) pctx.drawImage(im, it.x, it.y);
  } else if (it.pts) {
    if (it.brush === 'water') paintWater(pctx, it.pts, it.color, it.size);
    else drawStroke(it.pts, it.color, it.size);
  }
}
function redraw() {
  pctx.fillStyle = ERASE; pctx.fillRect(0, 0, pad.width, pad.height);   // opaque paper base so erase marks and blank paper are the SAME pixels (flood-fill treats them alike)
  (editMode ? editItems : strokes).forEach(paintItem);   // editor paints its own local item list
}
function paintAll() {
  redraw();
  if (!editMode) pendingMine.forEach(paintItem);   // my not-yet-confirmed strokes + fills (live only)
  if (drawing && curPts && curPts.length) { if (curBrush === 'water') paintWater(pctx, curPts, drawColor, drawSize); else drawStroke(curPts, drawColor, drawSize); }
}
var _repaintQ = false;
function scheduleRepaint() { if (_repaintQ) return; _repaintQ = true; requestAnimationFrame(function () { _repaintQ = false; paintAll(); }); }   // coalesce a burst of fill-image decodes into one repaint
function drawStroke(pts, color, size) {
  if (!pts || !Array.isArray(pts) || !pts.length) return;
  pctx.strokeStyle = color || '#c0425a';
  if (pts.length === 1) { pctx.lineWidth = pts[0].w || size || 5; pctx.beginPath(); pctx.moveTo(pts[0].x, pts[0].y); pctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1); pctx.stroke(); return; }
  for (var i = 1; i < pts.length; i++) { pctx.lineWidth = pts[i].w || size || 5; pctx.beginPath(); pctx.moveTo(pts[i - 1].x, pts[i - 1].y); pctx.lineTo(pts[i].x, pts[i].y); pctx.stroke(); }   // per-segment width = Apple Pencil pressure
}
/* watercolor: render the whole stroke opaque on the offscreen buffer, then lay it down as ONE translucent
   layer so a single stroke stays even while separate strokes build up. Deterministic -> syncs identically. */
function paintWater(ctx, pts, color, size) {
  if (!pts || !pts.length || !offx) { drawStroke(pts, color, size); return; }
  offx.clearRect(0, 0, offc.width, offc.height);
  offx.strokeStyle = color || '#c0425a';
  if (pts.length === 1) { offx.lineWidth = pts[0].w || size || 5; offx.beginPath(); offx.moveTo(pts[0].x, pts[0].y); offx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1); offx.stroke(); }
  else for (var i = 1; i < pts.length; i++) { offx.lineWidth = pts[i].w || size || 5; offx.beginPath(); offx.moveTo(pts[i - 1].x, pts[i - 1].y); offx.lineTo(pts[i].x, pts[i].y); offx.stroke(); }
  ctx.globalAlpha = WATER_ALPHA; ctx.drawImage(offc, 0, 0); ctx.globalAlpha = 1;
}
/* per-point width from Apple Pencil pressure (finger / mouse report ~0.5 -> a natural medium) */
function pw(e) {
  if (tool === 'erase') return drawSize;   // the eraser stays a predictable full-width nib
  var pr = (e && e.pressure > 0) ? e.pressure : 0.5;
  return Math.max(1, Math.round(drawSize * (0.5 + pr)));   // Pencil: soft ~0.55x, hard ~1.5x of the nib
}
function hexToRgb(h) {
  var m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null;
  var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/* scanline flood fill from (sx,sy); paints the region in `fill` and returns its mask + bounding box */
function floodFill(ctx, w, h, sx, sy, fill, tol) {
  var img = ctx.getImageData(0, 0, w, h), d = img.data;
  var si = (sy * w + sx) * 4, tr = d[si], tg = d[si + 1], tb = d[si + 2], ta = d[si + 3];
  if (tr === fill[0] && tg === fill[1] && tb === fill[2] && ta === 255) return null;   // already that colour
  function m(p) { var i = p * 4; return Math.abs(d[i] - tr) <= tol && Math.abs(d[i + 1] - tg) <= tol && Math.abs(d[i + 2] - tb) <= tol && Math.abs(d[i + 3] - ta) <= tol; }
  var mask = new Uint8Array(w * h), st = [sx, sy], minX = w, minY = h, maxX = 0, maxY = 0, filled = 0;   // flat number stack: no per-seed array allocation
  while (st.length) {
    var cy = st.pop(), cx = st.pop(), pm = cy * w + cx;
    if (mask[pm] || !m(pm)) continue;   // already filled or non-matching -> can't re-push / thrash even if fill is near the target
    var xl = cx; while (xl > 0 && !mask[cy * w + xl - 1] && m(cy * w + xl - 1)) xl--;
    var xr = cx; while (xr < w - 1 && !mask[cy * w + xr + 1] && m(cy * w + xr + 1)) xr++;
    for (var xx = xl; xx <= xr; xx++) {
      var q = cy * w + xx, i = q * 4; d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = 255;
      mask[q] = 1; filled++;
      if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      if (cy > 0 && !mask[q - w] && m(q - w)) { st.push(xx); st.push(cy - 1); }
      if (cy < h - 1 && !mask[q + w] && m(q + w)) { st.push(xx); st.push(cy + 1); }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { mask: mask, bx: minX, by: minY, bw: maxX - minX + 1, bh: maxY - minY + 1, filled: filled };
}
/* crop the filled region into a transparent PNG patch (solid colour -> tiny) */
function capturePatch(mask, r, fill, w) {
  var t = document.createElement('canvas'); t.width = r.bw; t.height = r.bh;
  var tx = t.getContext('2d'), im = tx.createImageData(r.bw, r.bh), dd = im.data;
  for (var yy = 0; yy < r.bh; yy++) for (var xx = 0; xx < r.bw; xx++) {
    if (mask[(r.by + yy) * w + (r.bx + xx)]) { var i = (yy * r.bw + xx) * 4; dd[i] = fill[0]; dd[i + 1] = fill[1]; dd[i + 2] = fill[2]; dd[i + 3] = 255; }
  }
  tx.putImageData(im, 0, 0);
  return t.toDataURL('image/png');
}
/* paint-bucket: flood-fill the tapped region, store it as a self-contained PNG patch (syncs pixel-identical) */
function doFill(e) {
  if (!editMode && !ddb) return;   // live needs Firestore; the editor fills locally
  var p = pxy(e);
  var sx = Math.max(0, Math.min(pad.width - 1, Math.round(p.x)));
  var sy = Math.max(0, Math.min(pad.height - 1, Math.round(p.y)));
  var fill = hexToRgb(penColor); if (!fill) return;
  var r = floodFill(pctx, pad.width, pad.height, sx, sy, fill, FILL_TOL);
  if (!r || !r.filled) return;
  var png = capturePatch(r.mask, r, fill, pad.width);
  var cid = 'f' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  if (editMode) {   // editor: append locally + decode for redraw, no Firestore (distinct 'e' cid namespace, never collides with live 'f' fills)
    var ecid = 'e' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    editItems.push({ type: 'fill', png: png, x: r.bx, y: r.by, cid: ecid });
    var eim = new Image(); imgCache[ecid] = eim; eim.onload = scheduleRepaint; eim.src = png;
    editDirty = true; return;
  }
  var item = { type: 'fill', png: png, x: r.bx, y: r.by, cid: cid, t: Date.now() };
  pendingMine.push(item);                                   // keep it painted until its doc echoes
  var im = new Image(); imgCache[cid] = im; im.onload = scheduleRepaint; im.src = png;   // decode for redraw
  dEnd._drew = true;
  var ref = ddb.collection('canvasStrokes').doc();
  undoStack.push({ cid: cid, ref: ref });
  ref.set({ type: 'fill', png: png, x: r.bx, y: r.by, by: me(), at: serverTime(), cid: cid }).catch(function () { toast("couldn't save that fill, check your connection"); });
  if (window.parvritiNotify && !dEnd._sent) { clearTimeout(dEnd._nt); dEnd._nt = setTimeout(sendDoodleNudge, 40000); }
}
function dStart(e) {
  if (drawing) return;   // one active stroke at a time - ignore a palm / second finger
  if (tool === 'fill') { e.preventDefault(); doFill(e); return; }   // fill is a tap, not a stroke
  e.preventDefault();
  activePtr = e.pointerId;
  try { pad.setPointerCapture(e.pointerId); } catch (er) {}
  drawing = true;
  curBrush = (tool === 'draw' && brushMode === 'water') ? 'water' : '';
  if (!editMode && window.parvritiActivity) { clearTimeout(dEnd._t); window.parvritiActivity('drawing'); }   // no presence while editing a kept doodle
  var p = pxy(e); p.w = pw(e); curPts = [p]; lastXY = p;
  if (curBrush === 'water') paintAll(); else drawStroke(curPts, drawColor, drawSize);
}
function dMove(e) {
  if (!drawing || e.pointerId !== activePtr) return;
  var p = pxy(e); p.w = pw(e);
  if (curPts.length >= 800) { commitStroke(); curPts = [lastXY]; }   // auto-split a very long stroke so nothing past a fixed cap is lost; the new segment continues from lastXY
  curPts.push(p);
  if (curBrush === 'water') { paintAll(); }   // watercolor can't draw incrementally at alpha; re-composite the whole stroke each move
  else { pctx.strokeStyle = drawColor; pctx.lineWidth = p.w; pctx.beginPath(); pctx.moveTo(lastXY.x, lastXY.y); pctx.lineTo(p.x, p.y); pctx.stroke(); }
  lastXY = p;
}
/* commit the current in-progress stroke to Firestore, keeping it painted (pendingMine) until it echoes */
function commitStroke() {
  if (!(curPts && curPts.length)) return;
  var pts = curPts.map(function (p) { return { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w || drawSize) }; });   // w = per-point Pencil-pressure width
  if (editMode) { var eo = { pts: pts, color: drawColor, size: drawSize }; if (curBrush === 'water') eo.brush = 'water'; editItems.push(eo); editDirty = true; return; }   // editor: append locally, no Firestore
  if (!ddb) return;
  var cid = 'c' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  var po = { pts: pts, color: drawColor, size: drawSize, cid: cid, t: Date.now() }; if (curBrush === 'water') po.brush = 'water';   // t = expiry so a stroke deleted before its echo can't ghost forever
  pendingMine.push(po);
  if (drawColor !== ERASE) dEnd._drew = true;   // an erase-only session shouldn't say "left you a doodle"
  var ref = ddb.collection('canvasStrokes').doc();
  undoStack.push({ cid: cid, ref: ref });
  var doc = { pts: pts, color: drawColor, size: drawSize, by: me(), at: serverTime(), cid: cid }; if (curBrush === 'water') doc.brush = 'water';
  ref.set(doc).catch(function () { toast("couldn't save that stroke, check your connection"); });
}
function dEnd(e) {
  if (!drawing || (e && e.pointerId != null && e.pointerId !== activePtr)) return;
  drawing = false; activePtr = null;
  commitStroke();
  curPts = null;
  if (editMode) return;   // editor: private edit, no live presence / nudge
  // let the "drawing" presence linger briefly so pauses between strokes don't flicker
  if (window.parvritiActivity) { clearTimeout(dEnd._t); dEnd._t = setTimeout(function () { window.parvritiActivity(null); }, 6000); }
  // one "left you a doodle" ping per session: ~40s after the last stroke, or on the way out
  if (window.parvritiNotify && !dEnd._sent) { clearTimeout(dEnd._nt); dEnd._nt = setTimeout(sendDoodleNudge, 40000); }
}
function sendDoodleNudge() {
  if (dEnd._sent || !dEnd._drew || !window.parvritiNotify) return;
  dEnd._sent = true; clearTimeout(dEnd._nt);
  var meP = me(), other = meP === 'parv' ? 'riti' : 'parv';
  window.parvritiNotify(other, (meP === 'parv' ? 'Parv' : 'Riti') + ' left you a doodle ✏️', '', 'https://parvriti.github.io/doodles.html?n=1', 'doodle');
}
/* undo MY last item this session: delete its doc (syncs the removal), drop it locally right away */
function undoLast() {
  if (editMode) {   // editor: pop the local list
    if (!editItems.length) { toast('nothing to undo'); return; }
    var e = editItems.pop(); if (e && e.cid) delete imgCache[e.cid];
    editDirty = true; paintAll(); return;
  }
  if (!ddb || !undoStack.length) { toast('nothing to undo'); return; }
  var last = undoStack.pop();
  undone[last.cid] = true;
  pendingMine = pendingMine.filter(function (p) { return p.cid !== last.cid; });
  strokes = strokes.filter(function (s) { return s.cid !== last.cid; });
  delete imgCache[last.cid];
  paintAll();
  last.ref.delete().then(function () { toast('undone'); }).catch(function () {
    delete undone[last.cid]; undoStack.push(last);   // undo did not persist: let the stroke come back on the next snapshot and stay re-undoable
    toast("couldn't undo, try again");
  });
}
function clearDoodle() {
  if (editMode) {   // editor: clear the local list only (never touches the live pad)
    if (!editItems.length) { toast('nothing to clear'); return; }
    if (!window.confirm('Clear this doodle?')) return;
    editItems = []; editDirty = true; paintAll(); return;
  }
  if (!ddb) { pctx.clearRect(0, 0, pad.width, pad.height); return; }
  if (!window.confirm('Wipe the doodle for both of you?')) return;
  pctx.clearRect(0, 0, pad.width, pad.height);
  pendingMine = []; imgCache = {}; undoStack = []; undone = {};   // don't let my not-yet-confirmed items repaint over a wipe; drop decoded fill patches + undo history
  clearTimeout(dEnd._nt); dEnd._sent = false; dEnd._drew = false;   // cancel a pending ping + reset "drew" so a wipe can't leave a phantom nudge
  wipeAll(2);
}
/* delete every stroke; a stroke the other device add()s between get() and the deletes survives one
   pass, so make a second pass to catch stragglers (each stroke is its own doc; WriteBatch caps at 500). */
function wipeAll(passes) {
  ddb.collection('canvasStrokes').get().then(function (snap) {
    if (snap.empty) { toast('cleared the pad'); return; }
    var docs = snap.docs, jobs = [];
    for (var i = 0; i < docs.length; i += 450) {
      var batch = ddb.batch();
      docs.slice(i, i + 450).forEach(function (d) { batch.delete(d.ref); });
      jobs.push(batch.commit());
    }
    return Promise.all(jobs).then(function () { if (passes > 1) wipeAll(passes - 1); else toast('cleared the pad'); });
  }).catch(function () { toast("couldn't clear, try again"); });
}

/* =====================================================================
   KEPT DOODLES - the shelf. Keep snapshots the live pad into savedDoodles
   (one doc: vector items + a JPEG + optional name). The shelf lists them
   (lazy listener), the viewer shares/renames/deletes/reopens, and the
   editor edits a copy LOCALLY (no live sync, no nudge) then saves back.
   Everything is Firestore-only (Spark has no Cloud Storage) + guarded to
   the 1 MiB doc ceiling, with a toast on every failure.
   ===================================================================== */
var SAVE_CAP = 950000;   // stay clear of Firestore's 1 MiB per-doc ceiling (mirrors board's photo cap)
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function personName(p) { return p === 'parv' ? 'Pavu' : 'Riti'; }
/* strip Firestore-only fields down to a plain render list for storage */
function cleanItems(src) {
  return (src || []).map(function (s) {
    if (s.png) return { type: 'fill', png: s.png, x: s.x, y: s.y };
    if (s.pts) { var o = { pts: s.pts, color: s.color, size: s.size }; if (s.brush) o.brush = s.brush; return o; }
    return null;
  }).filter(Boolean);
}
/* whatever is painted on the pad right now -> a 720x900 JPEG dataURL (grid + viewer + share all use this) */
function padImage() {
  try {
    var c = document.createElement('canvas'); c.width = pad.width; c.height = pad.height;
    var cx = c.getContext('2d'); cx.fillStyle = ERASE; cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(pad, 0, 0);
    return c.toDataURL('image/jpeg', 0.68);
  } catch (e) { return ''; }
}
function overCap(o) { try { return JSON.stringify(o).length > SAVE_CAP; } catch (e) { return false; } }
function fmtDate(ts) {
  try { var d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; } catch (e) { return ''; }
}
function fmtYear(ts) { try { var d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null); return (d || new Date()).getFullYear(); } catch (e) { return (new Date()).getFullYear(); } }

/* KEEP is a TOGGLE tied to the pad's CONTENT, not the session: each saved doodle stores a `sig`
   of its strokes, and the current pad is "kept" iff a saved doc's sig matches padSig(). The stroke
   cids are stable across reloads, so this survives reopen and you can NEVER save a duplicate. */
var shelfLoaded = false;
function padSig() {
  var cids = [];
  strokes.forEach(function (s) { if (s.cid) cids.push(s.cid); });
  pendingMine.forEach(function (p) { if (p.cid) cids.push(p.cid); });
  return cids.sort().join(',');
}
function keptDoc() {   // the saved doc matching the current pad, or null
  var sig = padSig(); if (!sig) return null;
  for (var i = 0; i < shelfDocs.length; i++) if (shelfDocs[i].sig && shelfDocs[i].sig === sig) return shelfDocs[i];
  return null;
}
function isKept() { return !!keptDoc(); }
function attachShelf() {   // listen from startup so the kept-state is known before the first Keep tap
  if (shelfUnsub || !ddb) return;
  try {
    shelfUnsub = ddb.collection('savedDoodles').orderBy('createdAt', 'desc').onSnapshot(function (snap) {
      shelfDocs = snap.docs.map(function (d) { var x = d.data() || {}; x.id = d.id; return x; });
      shelfLoaded = true; renderShelf(); updateKeepBtn();
    }, function () {
      shelfLoaded = true;
      var ov = document.getElementById('shelfOv');
      if (ov && ov.classList.contains('on')) { var b = document.getElementById('shelfBody'); if (b) b.innerHTML = '<div class="sd-empty">couldn\'t load the shelf, check your connection</div>'; }
    });
  } catch (e) {}
}
function updateKeepBtn() {
  var b = document.getElementById('keepBtn'); if (!b) return;
  var kept = isKept();
  b.classList.toggle('kept', kept);
  var lbl = kept ? 'Remove this from the shelf' : 'Keep this doodle';
  b.setAttribute('aria-label', lbl); b.setAttribute('title', lbl);
}
function keepDoodle() {
  if (editMode) { saveEditor(); return; }   // inside the editor, Keep = Save
  if (!ddb) { toast("can't keep it right now, check your connection"); return; }
  var ex = keptDoc();
  if (ex) { unkeepDoodle(ex.id); return; }   // this exact pad is already on the shelf (even across reopen) -> un-keep, never a duplicate
  var have = {}; strokes.forEach(function (s) { if (s.cid) have[s.cid] = true; });
  var extra = pendingMine.filter(function (p) { return !(p.cid && have[p.cid]); });   // include just-drawn, not-yet-echoed items; no duplicates
  var items = cleanItems(strokes.concat(extra));
  if (!items.length) { toast('draw something first, then keep it'); return; }
  var img = padImage();
  if (overCap({ items: items, img: img })) { toast("this doodle's too detailed to keep, try fewer fills"); return; }
  var sig = padSig(), by = me();
  var btn = document.getElementById('keepBtn'); if (btn) btn.classList.add('busy');
  toast('keeping...');   // immediate feedback: the first write after a cold launch can take a moment to connect
  ddb.collection('savedDoodles').add({ items: items, img: img, name: '', by: by, sig: sig, createdAt: serverTime(), updatedAt: serverTime() })
    .then(function (ref) { shelfDocs.unshift({ id: ref.id, sig: sig, img: img, name: '', by: by, createdAt: null }); toast('kept it on the shelf'); })
    .catch(function (e) { toast(e && e.code === 'permission-denied' ? "the shelf isn't enabled yet (publish the savedDoodles rule)" : "couldn't keep it, check your connection"); })
    .then(function () { if (btn) btn.classList.remove('busy'); updateKeepBtn(); });
}
function unkeepDoodle(id) {
  if (!ddb || !id) return;
  if (!window.confirm('Take this doodle off the shelf?')) return;
  var btn = document.getElementById('keepBtn'); if (btn) btn.classList.add('busy');
  ddb.collection('savedDoodles').doc(id).delete()
    .then(function () { shelfDocs = shelfDocs.filter(function (d) { return d.id !== id; }); toast('taken off the shelf'); })
    .catch(function () { toast("couldn't remove it, try again"); })
    .then(function () { if (btn) btn.classList.remove('busy'); updateKeepBtn(); });
}

/* SHELF overlay (the listener is attached at startup by attachShelf; opening just shows it) */
function openShelf() {
  var ov = document.getElementById('shelfOv'); if (!ov) return;
  ov.classList.add('on'); ov.setAttribute('aria-hidden', 'false'); document.body.classList.add('shelf-open');
  attachShelf();
  renderShelf();
}
function closeShelf() {
  var ov = document.getElementById('shelfOv'); if (!ov) return;
  ov.classList.remove('on'); ov.setAttribute('aria-hidden', 'true');
  if (!editMode) document.body.classList.remove('shelf-open');
}
function renderShelf() {
  var body = document.getElementById('shelfBody'); if (!body) return;
  if (!shelfLoaded && !shelfDocs.length) { body.innerHTML = '<div class="sd-load">opening the shelf&hellip;</div>'; return; }   // not "empty" until we've actually heard back
  if (!shelfDocs.length) { body.innerHTML = '<div class="sd-empty"><div class="sd-empty-ic">&#127800;</div>No kept doodles yet.<br>Draw on the pad, then tap Keep.</div>'; return; }
  var html = '', curYear = null;
  shelfDocs.forEach(function (d, i) {
    var y = fmtYear(d.createdAt);
    if (y !== curYear) { if (curYear !== null) html += '</div>'; html += '<div class="sd-year"><b>' + y + '</b><i></i></div><div class="sd-grid">'; curYear = y; }
    var who = d.by === 'parv' ? 'p' : 'r', tag = '<i class="sd-who ' + who + '">' + (who === 'p' ? 'P' : 'R') + '</i>';
    var named = !!(d.name && d.name.trim());
    var label = named ? esc(d.name) : (fmtDate(d.createdAt) || 'doodle');
    var meta = named ? (tag + ' ' + fmtDate(d.createdAt)) : tag;
    html += '<button class="sd-card" data-i="' + i + '" type="button"><span class="sd-nub"></span>'
      + (d.img ? '<img class="sd-thumb" src="' + d.img + '" alt="" loading="lazy">' : '<span class="sd-thumb sd-blank"></span>')
      + '<span class="sd-cap"><b>' + label + '</b><span class="sd-meta">' + meta + '</span></span></button>';
  });
  html += '</div>';
  body.innerHTML = html;
}

/* VIEWER: open one big, with resume / share / delete (rename = tap the title) */
function openViewer(d) {
  viewerDoc = d;
  var v = document.getElementById('doodleViewer'); if (!v) return;
  var named = !!(d.name && d.name.trim());
  v.innerHTML =
    '<div class="dv-scrim" id="dvClose"></div>'
    + '<div class="dv-card">'
    + '<button class="dv-x" id="dvX" type="button" aria-label="Close">&#10005;</button>'
    + (d.img ? '<img class="dv-img" src="' + d.img + '" alt="">' : '<div class="dv-img dv-blank"></div>')
    + '<div class="dv-meta"><button class="dv-name" id="dvName" type="button" title="Tap to rename">' + (named ? esc(d.name) : (fmtDate(d.createdAt) || 'untitled')) + '</button>'
    + '<div class="dv-sub">' + (named ? 'kept ' + fmtDate(d.createdAt) + ' &middot; ' : '') + 'by ' + personName(d.by) + '</div></div>'
    + '<div class="dv-actions">'
    + '<button class="dv-btn dv-primary" id="dvEdit" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> Keep drawing</button>'
    + '<button class="dv-btn dv-ghost" id="dvShare" type="button" aria-label="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg></button>'
    + '<button class="dv-btn dv-ghost dv-del" id="dvDel" type="button" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>'
    + '</div></div>';
  v.classList.add('on'); v.setAttribute('aria-hidden', 'false'); document.body.classList.add('shelf-open');
  document.getElementById('dvClose').onclick = closeViewer;
  document.getElementById('dvX').onclick = closeViewer;
  document.getElementById('dvName').onclick = function () { renameDoodle(d); };
  document.getElementById('dvEdit').onclick = function () { openEditor(d); };
  document.getElementById('dvShare').onclick = function () { shareDoodle(d); };
  document.getElementById('dvDel').onclick = function () { deleteDoodle(d); };
}
function closeViewer() {
  var v = document.getElementById('doodleViewer'); if (!v) return;
  v.classList.remove('on'); v.setAttribute('aria-hidden', 'true'); viewerDoc = null;
  var ov = document.getElementById('shelfOv');
  if (!(ov && ov.classList.contains('on')) && !editMode) document.body.classList.remove('shelf-open');
}
/* rename via an INLINE input (window.prompt is blocked in iOS standalone PWAs, so it silently no-ops there) */
function renameDoodle(d) {
  var el = document.getElementById('dvName'); if (!el || el.tagName === 'INPUT') return;
  var input = document.createElement('input');
  input.type = 'text'; input.className = 'dv-name-input'; input.id = 'dvName';
  input.value = d.name || ''; input.maxLength = 40; input.placeholder = 'name it (optional)';
  input.setAttribute('enterkeyhint', 'done'); input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'off');
  el.parentNode.replaceChild(input, el);
  try { input.focus(); input.select(); } catch (e) {}
  var done = false;
  function commit() {
    if (done) return; done = true;
    var v = (input.value || '').trim().slice(0, 40);
    var b = document.createElement('button');
    b.id = 'dvName'; b.className = 'dv-name'; b.type = 'button'; b.title = 'Tap to rename';
    b.textContent = v || (fmtDate(d.createdAt) || 'untitled');
    b.onclick = function () { renameDoodle(d); };
    if (input.parentNode) input.parentNode.replaceChild(b, input);
    if (v === (d.name || '')) return;   // unchanged: don't write
    if (!ddb) { toast("can't rename right now, check your connection"); return; }
    ddb.collection('savedDoodles').doc(d.id).update({ name: v, updatedAt: serverTime() })
      .then(function () { d.name = v; toast(v ? 'renamed' : 'name cleared'); })
      .catch(function () { toast("couldn't rename, try again"); });
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
}
function deleteDoodle(d) {
  if (!ddb) { toast("can't delete right now, check your connection"); return; }
  if (!window.confirm('Take this doodle off the shelf?')) return;
  ddb.collection('savedDoodles').doc(d.id).delete()
    .then(function () { shelfDocs = shelfDocs.filter(function (x) { return x.id !== d.id; }); updateKeepBtn(); toast('taken off the shelf'); closeViewer(); })
    .catch(function () { toast("couldn't delete, try again"); });
}

/* SHARE: hand the JPEG to the OS share sheet (must build the File synchronously inside the tap) */
function dataURLtoBlob(u) {
  try {
    var a = u.split(','), m = (a[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var b = atob(a[1]), n = b.length, u8 = new Uint8Array(n);
    while (n--) u8[n] = b.charCodeAt(n);
    return new Blob([u8], { type: m });
  } catch (e) { return null; }
}
function shareDoodle(d) {
  if (!d.img) { toast('nothing to share yet'); return; }
  var fname = ((d.name || 'doodle').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'doodle') + '.jpg';
  var blob = dataURLtoBlob(d.img);
  if (blob && navigator.canShare) {
    try {
      var file = new File([blob], fname, { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: d.name || 'a doodle for you' })
          .catch(function (err) { if (err && err.name === 'AbortError') return; toast("couldn't open the share sheet"); });
        return;
      }
    } catch (e) {}
  }
  try {   // desktop / no file-share: download it
    var a = document.createElement('a'); a.href = d.img; a.download = fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('saved the image');
  } catch (e) { toast("couldn't share on this device"); }
}

/* EDITOR: reopen a kept doodle and carry on drawing (local copy, no live sync) */
function openEditor(d) {
  closeViewer(); closeShelf();
  editMode = true; editingId = d.id || null; editName = (d.name || ''); editDirty = false;
  editItems = (d.items || []).map(function (it) {
    if (it && it.png) return { type: 'fill', png: it.png, x: it.x, y: it.y, cid: 'e' + Math.random().toString(36).slice(2) };   // fresh cid so paintItem decodes each into imgCache
    var o = { pts: (it && it.pts) || [], color: (it && it.color) || '#c0425a', size: (it && it.size) || 6 };
    if (it && it.brush) o.brush = it.brush;   // keep watercolor strokes watercolor when re-opened
    return o;
  });
  document.body.classList.add('editing-doodle');
  var nm = document.getElementById('editNameLbl'); if (nm) nm.textContent = editName || 'untitled';
  paintAll();
  toast('editing this one, draw then Save');
}
function saveEditor() {
  if (!editMode) return;
  if (!ddb) { toast("can't save right now, check your connection"); return; }
  var items = cleanItems(editItems);
  if (!items.length) { toast("nothing to save, this doodle is empty"); return; }   // never blank an existing kept doodle
  var img = padImage();
  if (overCap({ items: items, img: img, name: editName })) { toast("too detailed to save, try fewer fills"); return; }
  var esv = document.getElementById('editSave'); if (esv) esv.classList.add('busy');
  var done = function () { if (esv) esv.classList.remove('busy'); };
  var ok = function () { editDirty = false; toast('saved'); done(); };
  var fail = function (e) { toast(e && e.code === 'permission-denied' ? "the shelf isn't enabled yet (publish the savedDoodles rule)" : "couldn't save, check your connection"); done(); };
  if (editingId) ddb.collection('savedDoodles').doc(editingId).update({ items: items, img: img, sig: '', updatedAt: serverTime() }).then(ok).catch(fail);   // sig cleared: an edited doodle no longer corresponds to any live pad
  else ddb.collection('savedDoodles').add({ items: items, img: img, name: editName || '', by: me(), createdAt: serverTime(), updatedAt: serverTime() })
    .then(function (ref) { editingId = ref.id; ok(); }).catch(fail);
}
function closeEditor() {
  if (!editMode) return;
  if (editDirty && !window.confirm('Leave without saving your changes?')) return;
  // drop the editor's decoded fill patches so they don't linger in imgCache
  editItems.forEach(function (it) { if (it && it.cid) delete imgCache[it.cid]; });
  editMode = false; editingId = null; editName = ''; editItems = []; editDirty = false;
  document.body.classList.remove('editing-doodle'); document.body.classList.remove('shelf-open');
  paintAll();   // restore the live shared pad
}

if (window.__parvritiAuthed) startDoodle();
else window.addEventListener('parvriti-authed', startDoodle, { once: true });
