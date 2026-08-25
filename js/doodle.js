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

function startDoodle() {
  pad = document.getElementById('pad'); if (!pad) return;
  pctx = pad.getContext('2d'); pctx.lineCap = 'round'; pctx.lineJoin = 'round';

  var eraseBtn = document.getElementById('eraseTool');
  document.querySelectorAll('.swatch').forEach(function (sw) {
    sw.addEventListener('click', function () {
      document.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
      if (eraseBtn) eraseBtn.classList.remove('on');   // picking a colour leaves erase mode
      sw.classList.add('sel'); drawColor = sw.dataset.c;
    });
  });
  document.querySelectorAll('.nib').forEach(function (nb) {
    nb.addEventListener('click', function () {   // nib sets size for both drawing AND erasing
      document.querySelectorAll('.nib').forEach(function (x) { x.classList.remove('sel'); });
      nb.classList.add('sel'); drawSize = +nb.dataset.s;
    });
  });
  if (eraseBtn) eraseBtn.addEventListener('click', function () {
    document.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
    eraseBtn.classList.add('on'); drawColor = ERASE;   // erase = paint in the paper colour; syncs + covers like any stroke
  });
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
        redraw();
        pendingMine.forEach(function (p) { drawStroke(p.pts, p.color, p.size); });   // keep my not-yet-confirmed strokes painted so a redraw can't erase them
        if (drawing && curPts && curPts.length) drawStroke(curPts, drawColor, drawSize);   // keep your in-progress line visible over a concurrent remote redraw
        var last = strokes.length ? strokes[strokes.length - 1] : null;
        var by = document.getElementById('padBy');
        if (by) by.textContent = last ? ('last doodled by ' + (last.by === 'parv' ? 'Pavu' : 'Riti')) : 'draw something silly together';
      }, function (e) { console.warn('strokes', e); });
    } catch (e) { console.warn(e); }
  }
}
function pxy(e) { var r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height) }; }
function redraw() {
  pctx.clearRect(0, 0, pad.width, pad.height);
  strokes.forEach(function (s) { drawStroke(s.pts, s.color, s.size); });
}
function drawStroke(pts, color, size) {
  if (!pts || !pts.length) return;
  pctx.strokeStyle = color || '#c0425a'; pctx.lineWidth = size || 5;
  pctx.beginPath(); pctx.moveTo(pts[0].x, pts[0].y);
  for (var i = 1; i < pts.length; i++) pctx.lineTo(pts[i].x, pts[i].y);
  if (pts.length === 1) pctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
  pctx.stroke();
}
function dStart(e) {
  if (drawing) return;   // one active stroke at a time - ignore a palm / second finger
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
  pendingMine = [];   // don't let my not-yet-confirmed strokes repaint over a wipe
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
