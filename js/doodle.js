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

function startDoodle() {
  pad = document.getElementById('pad'); if (!pad) return;
  pctx = pad.getContext('2d'); pctx.lineCap = 'round'; pctx.lineJoin = 'round';

  var eraseBtn = document.getElementById('eraseTool'), fillBtn = document.getElementById('fillTool');
  function setTool(t) {   // colour (swatch) and tool (pen/erase/fill) are orthogonal
    tool = t;
    if (eraseBtn) eraseBtn.classList.toggle('on', t === 'erase');
    if (fillBtn) fillBtn.classList.toggle('on', t === 'fill');
    drawColor = (t === 'erase') ? ERASE : penColor;
  }
  document.querySelectorAll('.swatch').forEach(function (sw) {
    sw.addEventListener('click', function () {
      document.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
      sw.classList.add('sel'); penColor = sw.dataset.c; setTool('draw');   // picking a colour returns to the pen
    });
  });
  document.querySelectorAll('.nib').forEach(function (nb) {
    nb.addEventListener('click', function () {   // nib sets size for pen AND eraser
      document.querySelectorAll('.nib').forEach(function (x) { x.classList.remove('sel'); });
      nb.classList.add('sel'); drawSize = +nb.dataset.s;
    });
  });
  if (eraseBtn) eraseBtn.addEventListener('click', function () { setTool('erase'); });
  if (fillBtn) fillBtn.addEventListener('click', function () { setTool('fill'); });   // fill uses the selected swatch colour; tap the canvas to flood a region
  var cl = document.getElementById('clearPad'); if (cl) cl.addEventListener('click', clearDoodle);

  pad.addEventListener('pointerdown', dStart);
  pad.addEventListener('pointermove', dMove);
  pad.addEventListener('pointerup', dEnd);
  pad.addEventListener('pointercancel', dEnd);
  window.addEventListener('pointerup', dEnd); window.addEventListener('pointercancel', dEnd);   // safety net: end the stroke even if a release lands off the pad or setPointerCapture failed (else drawing stays stuck true)
  window.addEventListener('pagehide', sendDoodleNudge);   // doodle-and-leave still nudges (don't rely only on the 40s timer)
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') sendDoodleNudge(); });   // iOS PWA backgrounds via visibilitychange, not pagehide

  if (ddb) {
    try {
      ddb.collection('canvasStrokes').orderBy('at', 'asc').onSnapshot(function (snap) {
        strokes = snap.docs.map(function (d) { return d.data(); });
        if (!strokes.length) { pendingMine = []; }   // a wipe (or empty pad): drop my unconfirmed strokes so none can ghost past a clear
        else if (pendingMine.length) {   // drop mine that echoed back (cid), or expired after ~12s (e.g. deleted before its echo)
          var have = {}, cutoff = Date.now() - 12000;
          strokes.forEach(function (s) { if (s.cid) have[s.cid] = true; });
          pendingMine = pendingMine.filter(function (p) { return !have[p.cid] && p.t > cutoff; });
        }
        paintAll();   // redraw strokes + fills in order, then my not-yet-confirmed items + the in-progress line
        var last = strokes.length ? strokes[strokes.length - 1] : null;
        var by = document.getElementById('padBy');
        if (by) by.textContent = last ? ('last doodled by ' + (last.by === 'parv' ? 'Pavu' : 'Riti')) : 'draw something silly together';
      }, function (e) { console.warn('strokes', e); });
    } catch (e) { console.warn(e); }
  }
}
function pxy(e) { var r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height) }; }
/* draw one item in order: a fill patch (stamp its cached PNG) or a stroke */
function paintItem(it) {
  if (!it) return;
  if (it.png) {   // a fill patch
    var im = imgCache[it.cid];
    if (!im) { im = new Image(); imgCache[it.cid] = im; im.onload = paintAll; im.src = it.png; }   // decode async, then repaint
    if (im.complete && im.naturalWidth) pctx.drawImage(im, it.x, it.y);
  } else if (it.pts) {
    drawStroke(it.pts, it.color, it.size);
  }
}
function redraw() {
  pctx.clearRect(0, 0, pad.width, pad.height);
  strokes.forEach(paintItem);
}
function paintAll() {
  redraw();
  pendingMine.forEach(paintItem);   // my not-yet-confirmed strokes + fills
  if (drawing && curPts && curPts.length) drawStroke(curPts, drawColor, drawSize);
}
function drawStroke(pts, color, size) {
  if (!pts || !pts.length) return;
  pctx.strokeStyle = color || '#c0425a'; pctx.lineWidth = size || 5;
  pctx.beginPath(); pctx.moveTo(pts[0].x, pts[0].y);
  for (var i = 1; i < pts.length; i++) pctx.lineTo(pts[i].x, pts[i].y);
  if (pts.length === 1) pctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
  pctx.stroke();
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
  function m(i) { return Math.abs(d[i] - tr) <= tol && Math.abs(d[i + 1] - tg) <= tol && Math.abs(d[i + 2] - tb) <= tol && Math.abs(d[i + 3] - ta) <= tol; }
  var mask = new Uint8Array(w * h), st = [[sx, sy]], minX = w, minY = h, maxX = 0, maxY = 0, filled = 0;
  while (st.length) {
    var pt = st.pop(), cx = pt[0], cy = pt[1];
    if (!m((cy * w + cx) * 4)) continue;
    var xl = cx; while (xl > 0 && m((cy * w + xl - 1) * 4)) xl--;
    var xr = cx; while (xr < w - 1 && m((cy * w + xr + 1) * 4)) xr++;
    for (var xx = xl; xx <= xr; xx++) {
      var i = (cy * w + xx) * 4; d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = 255;
      mask[cy * w + xx] = 1; filled++;
      if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      if (cy > 0 && m(((cy - 1) * w + xx) * 4)) st.push([xx, cy - 1]);
      if (cy < h - 1 && m(((cy + 1) * w + xx) * 4)) st.push([xx, cy + 1]);
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
  if (!ddb) return;
  var p = pxy(e);
  var sx = Math.max(0, Math.min(pad.width - 1, Math.round(p.x)));
  var sy = Math.max(0, Math.min(pad.height - 1, Math.round(p.y)));
  var fill = hexToRgb(penColor); if (!fill) return;
  var r = floodFill(pctx, pad.width, pad.height, sx, sy, fill, FILL_TOL);
  if (!r || !r.filled) return;
  var png = capturePatch(r.mask, r, fill, pad.width);
  var cid = 'f' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  var item = { type: 'fill', png: png, x: r.bx, y: r.by, cid: cid, t: Date.now() };
  pendingMine.push(item);                                   // keep it painted until its doc echoes
  var im = new Image(); imgCache[cid] = im; im.onload = paintAll; im.src = png;   // decode for redraw
  dEnd._drew = true;
  ddb.collection('canvasStrokes').add({ type: 'fill', png: png, x: r.bx, y: r.by, by: me(), at: serverTime(), cid: cid }).catch(function () {});
  if (window.parvritiNotify && !dEnd._sent) { clearTimeout(dEnd._nt); dEnd._nt = setTimeout(sendDoodleNudge, 40000); }
}
function dStart(e) {
  if (drawing) return;   // one active stroke at a time - ignore a palm / second finger
  if (tool === 'fill') { e.preventDefault(); doFill(e); return; }   // fill is a tap, not a stroke
  e.preventDefault();
  activePtr = e.pointerId;
  try { pad.setPointerCapture(e.pointerId); } catch (er) {}
  drawing = true;
  if (window.parvritiActivity) { clearTimeout(dEnd._t); window.parvritiActivity('drawing'); }
  var p = pxy(e); curPts = [p]; lastXY = p;
  pctx.strokeStyle = drawColor; pctx.lineWidth = drawSize; drawStroke(curPts, drawColor, drawSize);
}
function dMove(e) {
  if (!drawing || e.pointerId !== activePtr) return;
  var p = pxy(e);
  if (curPts.length >= 800) { commitStroke(); curPts = [lastXY]; }   // auto-split a very long stroke so nothing past a fixed cap is lost; the new segment continues from lastXY
  curPts.push(p);
  pctx.strokeStyle = drawColor; pctx.lineWidth = drawSize;
  pctx.beginPath(); pctx.moveTo(lastXY.x, lastXY.y); pctx.lineTo(p.x, p.y); pctx.stroke();
  lastXY = p;
}
/* commit the current in-progress stroke to Firestore, keeping it painted (pendingMine) until it echoes */
function commitStroke() {
  if (!(curPts && curPts.length && ddb)) return;
  var pts = curPts.map(function (p) { return { x: Math.round(p.x), y: Math.round(p.y) }; });
  var cid = 'c' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  pendingMine.push({ pts: pts, color: drawColor, size: drawSize, cid: cid, t: Date.now() });   // t = expiry so a stroke deleted before its echo can't ghost forever
  if (drawColor !== ERASE) dEnd._drew = true;   // an erase-only session shouldn't say "left you a doodle"
  ddb.collection('canvasStrokes').add({ pts: pts, color: drawColor, size: drawSize, by: me(), at: serverTime(), cid: cid }).catch(function () {});
}
function dEnd(e) {
  if (!drawing || (e && e.pointerId != null && e.pointerId !== activePtr)) return;
  drawing = false; activePtr = null;
  commitStroke();
  curPts = null;
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
function clearDoodle() {
  if (!ddb) { pctx.clearRect(0, 0, pad.width, pad.height); return; }
  if (!window.confirm('Wipe the doodle for both of you?')) return;
  pctx.clearRect(0, 0, pad.width, pad.height);
  pendingMine = []; imgCache = {};   // don't let my not-yet-confirmed items repaint over a wipe; drop decoded fill patches
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
  }).catch(function () { toast('could not clear'); });
}

if (window.__parvritiAuthed) startDoodle();
else window.addEventListener('parvriti-authed', startDoodle, { once: true });
