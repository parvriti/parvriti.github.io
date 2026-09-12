let webkit;
try { ({ webkit } = require('playwright-core')); }
catch (e) { console.log('SKIP: playwright-core is not installed. Run: npm install --prefix tests'); process.exit(0); }
const fs = require('fs');
const REPO_ROOT = require('path').join(__dirname, '..');
const src = fs.readFileSync(REPO_ROOT + '/js/doodle.js', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('slice miss: ' + a); return src.slice(i, j); };
const paintBlock = cut('/* draw one item in order:', 'function drawStroke(pts, color, size) {');   // paintItem, redraw, captureBase, paintAll, scheduleRepaint
const drawBlock  = cut('function drawStroke(pts, color, size) {', '/* per-point width from Apple Pencil');
/* A synthetic pad that MATCHES the real one in the ways that matter to this test:
   19 watercolor strokes at the same canvas size, similar point counts and widths.
   Deterministic (seeded), so a failure is always reproducible, and it keeps real
   doodles out of the repo. */
function syntheticPad() {
  let seed = 20260912;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const colors = ['#c0425a', '#e07090', '#3a7bd5', '#4a9c6d', '#d4a017'];
  const out = [];
  for (let i = 0; i < 19; i++) {
    const n = 40 + Math.floor(rnd() * 110);
    const x0 = 60 + rnd() * 520, y0 = 80 + rnd() * 680, amp = 20 + rnd() * 70, step = 2 + rnd() * 4;
    const pts = [];
    for (let j = 0; j < n; j++) pts.push({ x: Math.round(x0 + j * step), y: Math.round(y0 + Math.sin(j / (4 + rnd() * 6)) * amp), w: 6 + Math.round(rnd() * 12) });
    out.push({ pts, color: colors[i % colors.length], size: 8 + Math.round(rnd() * 8), brush: 'water' });
  }
  return out;
}
const strokes = JSON.stringify(syntheticPad());

const page = `<!doctype html><body><canvas id="pad" width="720" height="900"></canvas><script>
  var pad = document.getElementById('pad'), pctx = pad.getContext('2d'); pctx.lineCap='round'; pctx.lineJoin='round';
  var offc = document.createElement('canvas'); offc.width=720; offc.height=900; var offx = offc.getContext('2d'); offx.lineCap='round'; offx.lineJoin='round';
  var WATER_ALPHA = 0.34, ERASE = '#fdf6ee', imgCache = {};
  var strokes = ${strokes}, pendingMine = [], editItems = [], editMode = false;
  var drawing = false, curPts = null, curBrush = '', drawColor = '#c0425a', drawSize = 12;
  ${paintBlock}
  ${drawBlock}
  // the OLD implementation, verbatim in behaviour, as the reference to compare against
  function reference() {
    redraw();
    if (!editMode) pendingMine.forEach(paintItem);
    if (drawing && curPts && curPts.length) { if (curBrush === 'water') paintWater(pctx, curPts, drawColor, drawSize); else drawStroke(curPts, drawColor, drawSize); }
  }
  var REF = document.createElement('canvas'); REF.width=720; REF.height=900;
  function snapshot(to) { to.getContext('2d').drawImage(pad, 0, 0); }
  function diffAgainstRef() {
    var a = pad.getContext('2d').getImageData(0,0,720,900).data, b = REF.getContext('2d').getImageData(0,0,720,900).data;
    var px = 0, max = 0;
    for (var i = 0; i < a.length; i += 4) {
      var d = Math.max(Math.abs(a[i]-b[i]), Math.abs(a[i+1]-b[i+1]), Math.abs(a[i+2]-b[i+2]), Math.abs(a[i+3]-b[i+3]));
      if (d) { px++; if (d > max) max = d; }
    }
    return { px: px, max: max };
  }
  function mkCur(n) { var p = []; for (var i=0;i<n;i++) p.push({x:130+i*4, y:330+Math.sin(i/6)*100, w:10+(i%4)}); return p; }
  function flush(){ pctx.getImageData(0,0,1,1); }

  window.T = {
    // a watercolor stroke growing move by move must match the old renderer exactly
    growing: function () {
      var out = [];
      drawing = true; curBrush = 'water'; invalidateBase();
      [1, 20, 60, 120, 200].forEach(function (n) {
        curPts = mkCur(n);
        reference(); snapshot(REF);        // what the old code would paint
        paintAll();                         // what the new code paints (blit + live stroke)
        out.push({ n: n, d: diffAgainstRef() });
      });
      drawing = false; curPts = null; return out;
    },
    // THE case that would break it: her stroke lands while my stroke is in progress
    remoteMidStroke: function () {
      drawing = true; curBrush = 'water'; invalidateBase();
      curPts = mkCur(40); paintAll();                       // base captured here
      strokes.push({ pts: mkCur(30).map(function (p) { return { x: p.x + 300, y: p.y - 180, w: 14 }; }), color: '#3a7bd5', size: 14, brush: 'water' });
      invalidateBase();                                      // exactly what the snapshot handler does
      curPts = mkCur(60);
      reference(); snapshot(REF);
      paintAll();
      var d = diffAgainstRef();
      strokes.pop(); drawing = false; curPts = null; invalidateBase();
      return d;
    },
    // if the live stroke were ever baked into the buffer it would darken as it grows
    notBaked: function () {
      drawing = true; curBrush = 'water'; invalidateBase();
      curPts = mkCur(80); paintAll(); paintAll(); paintAll(); paintAll();   // repaint the same stroke repeatedly
      reference(); snapshot(REF);
      curPts = mkCur(80); paintAll();
      var d = diffAgainstRef();
      drawing = false; curPts = null; invalidateBase(); return d;
    },
    penUnchanged: function () {
      drawing = true; curBrush = ''; curPts = mkCur(90); invalidateBase();
      reference(); snapshot(REF); paintAll();
      var d = diffAgainstRef(); drawing = false; curPts = null; return d;
    },
    idleUnchanged: function () {   // not drawing at all: must take the old path
      drawing = false; curPts = null; invalidateBase();
      reference(); snapshot(REF); paintAll();
      return diffAgainstRef();
    },
    editorMode: function () {
      editMode = true; editItems = strokes.slice(0, 8);
      drawing = true; curBrush = 'water'; curPts = mkCur(50); invalidateBase();
      reference(); snapshot(REF); paintAll();
      var d = diffAgainstRef();
      editMode = false; editItems = []; drawing = false; curPts = null; invalidateBase(); return d;
    },
    speed: function () {
      drawing = true; curBrush = 'water'; curPts = mkCur(120); invalidateBase(); paintAll(); flush();
      var t = performance.now(); for (var i=0;i<40;i++) { paintAll(); flush(); } var fast = (performance.now()-t)/40;
      t = performance.now(); for (var j=0;j<40;j++) { reference(); flush(); } var slow = (performance.now()-t)/40;
      drawing = false; curPts = null; invalidateBase();
      return { before: +slow.toFixed(2), after: +fast.toFixed(2) };
    }
  };
</script></body>`;
(async () => {
  let b;
  try { b = await webkit.launch(); }
  catch (e) { console.log('SKIP: no webkit browser build. Run: npx playwright install webkit'); return; } const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setContent(page);
  const r = await p.evaluate(() => ({ growing: T.growing(), remote: T.remoteMidStroke(), notBaked: T.notBaked(), pen: T.penUnchanged(), idle: T.idleUnchanged(), editor: T.editorMode(), speed: T.speed() }));
  await b.close();
  let pass = 0, fail = 0;
  const ck = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ FAIL ') + n + (ok || !x ? '' : '  [' + x + ']')); };
  ck('no script errors', errs.length === 0, errs.join('|'));
  r.growing.forEach(g => ck('watercolor stroke at ' + g.n + ' points is pixel-identical', g.d.px === 0, JSON.stringify(g.d)));
  ck('her stroke arriving MID-STROKE appears immediately', r.remote.px === 0, JSON.stringify(r.remote));
  ck('the live stroke is never baked into the buffer (no darkening)', r.notBaked.px === 0, JSON.stringify(r.notBaked));
  ck('pen strokes take the untouched old path', r.pen.px === 0, JSON.stringify(r.pen));
  ck('idle repaints take the untouched old path', r.idle.px === 0, JSON.stringify(r.idle));
  ck('editing a kept doodle still renders correctly', r.editor.px === 0, JSON.stringify(r.editor));
  ck('and it is much faster: ' + r.speed.before + 'ms -> ' + r.speed.after + 'ms per move', r.speed.after < r.speed.before / 5, JSON.stringify(r.speed));
  console.log('\nPASS ' + pass + '  FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})();
