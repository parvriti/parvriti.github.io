/* =====================================================================
   doodle.js — "Doodles" (doodles.html)

   A shared sketch pad. Whatever one of you draws appears on the other's
   screen, live. A clear button wipes it for both. NO notification is ever
   sent — it's just for fun.
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

var pad, pctx, strokes = [], drawColor = '#c0425a', drawSize = 5, drawing = false, curPts = null, lastXY = null;

function startDoodle() {
  pad = document.getElementById('pad'); if (!pad) return;
  pctx = pad.getContext('2d'); pctx.lineCap = 'round'; pctx.lineJoin = 'round';

  document.querySelectorAll('.swatch').forEach(function (sw) {
    sw.addEventListener('click', function () {
      document.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
      sw.classList.add('sel'); drawColor = sw.dataset.c;
    });
  });
  document.querySelectorAll('.nib').forEach(function (nb) {
    nb.addEventListener('click', function () {
      document.querySelectorAll('.nib').forEach(function (x) { x.classList.remove('sel'); });
      nb.classList.add('sel'); drawSize = +nb.dataset.s;
    });
  });
  var cl = document.getElementById('clearPad'); if (cl) cl.addEventListener('click', clearDoodle);

  pad.addEventListener('pointerdown', dStart);
  pad.addEventListener('pointermove', dMove);
  pad.addEventListener('pointerup', dEnd);
  pad.addEventListener('pointercancel', dEnd);

  if (ddb) {
    try {
      ddb.collection('canvasStrokes').orderBy('at', 'asc').onSnapshot(function (snap) {
        strokes = snap.docs.map(function (d) { return d.data(); });
        redraw();
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
function dStart(e) { e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (er) {} drawing = true; var p = pxy(e); curPts = [p]; lastXY = p; pctx.strokeStyle = drawColor; pctx.lineWidth = drawSize; drawStroke(curPts, drawColor, drawSize); }
function dMove(e) { if (!drawing) return; var p = pxy(e); if (curPts.length < 500) curPts.push(p); pctx.strokeStyle = drawColor; pctx.lineWidth = drawSize; pctx.beginPath(); pctx.moveTo(lastXY.x, lastXY.y); pctx.lineTo(p.x, p.y); pctx.stroke(); lastXY = p; }
function dEnd() {
  if (!drawing) return; drawing = false;
  if (curPts && curPts.length && ddb) {
    var pts = curPts.map(function (p) { return { x: Math.round(p.x), y: Math.round(p.y) }; });
    ddb.collection('canvasStrokes').add({ pts: pts, color: drawColor, size: drawSize, by: me(), at: serverTime() }).catch(function () {});
  }
  curPts = null;
}
function clearDoodle() {
  if (!ddb) { pctx.clearRect(0, 0, pad.width, pad.height); return; }
  if (!window.confirm('Wipe the doodle for both of you?')) return;
  pctx.clearRect(0, 0, pad.width, pad.height);
  ddb.collection('canvasStrokes').get().then(function (snap) {
    var batch = ddb.batch(); snap.docs.forEach(function (d) { batch.delete(d.ref); }); return batch.commit();
  }).then(function () { toast('cleared the pad'); }).catch(function () {});
}

if (window.__parvritiAuthed) startDoodle();
else window.addEventListener('parvriti-authed', startDoodle, { once: true });
