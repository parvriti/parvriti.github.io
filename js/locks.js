/* =====================================================================
   locks.js — the entry ritual on index.html
     Intro → Lock 1 (dial) → Lock 2 (flower) → Vows → letter.html
   On a correct signature we mark the session unlocked and hand off to
   the letter page (common.js's guard checks that flag).
   ===================================================================== */

/* subtle synthesized sound (defined in common.js); silent if unavailable */
function sfx(n) { if (window.parvritiSfx && window.parvritiSfx[n]) window.parvritiSfx[n](); }

/* ── screen navigation + bloom transition ── */
function goTo(id) {
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}
function bloom(cb) {
  var o = document.getElementById('bloomOv');
  o.classList.add('go');
  setTimeout(cb, 620);
  setTimeout(function () { o.classList.remove('go'); }, 1100);
}

/* ─────────────────────────────────
   LOCK 1 | COMBINATION DIAL — PIN: 7692
───────────────────────────────── */
const L1 = [7, 6, 9, 2];
let dVal = 0, dStep = 0, dEntry = [];

function drawDial() {
  const cv = document.getElementById('dialCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const cx = 110, cy = 110, R = 92;
  ctx.clearRect(0, 0, 220, 220);

  const grd = ctx.createRadialGradient(cx, cy, 55, cx, cy, R);
  grd.addColorStop(0, 'rgba(192,66,90,.13)');
  grd.addColorStop(1, 'rgba(192,66,90,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(192,66,90,.28)'; ctx.lineWidth = 1; ctx.stroke();

  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2 + (dVal / 10) * Math.PI * 2;
    const active = (i === 0);
    const ix = cx + Math.cos(angle) * R, iy = cy + Math.sin(angle) * R;
    const ox = cx + Math.cos(angle) * (R - 20), oy = cy + Math.sin(angle) * (R - 20);
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ox, oy);
    ctx.strokeStyle = active ? '#f9c6c6' : 'rgba(192,66,90,.35)';
    ctx.lineWidth = active ? 2.5 : 1; ctx.stroke();
    const tx = cx + Math.cos(angle) * (R - 33), ty = cy + Math.sin(angle) * (R - 33);
    ctx.font = "300 13px 'Cormorant Garamond', serif";
    ctx.fillStyle = 'rgba(192,66,90,.55)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i), tx, ty);
  }

  ctx.beginPath(); ctx.arc(cx, cy, 33, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(192,66,90,.18)'; ctx.lineWidth = 1; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 9, cy - R + 2);
  ctx.lineTo(cx, cy - R + 15);
  ctx.lineTo(cx + 9, cy - R + 2);
  ctx.closePath();
  ctx.fillStyle = '#c0425a'; ctx.fill();
}

function rotateDial(dir) {
  dVal = (dVal - dir + 10) % 10;
  document.getElementById('dialNum').childNodes[0].textContent = String(dVal);
  drawDial();
  const w = document.getElementById('dialWrap');
  w.style.transform = 'scale(1.03)';
  setTimeout(function () { w.style.transform = ''; }, 80);
}

// swipe support on dial
(function () {
  let startX = 0;
  const wrap = document.getElementById('dialWrap');
  if (!wrap) return;
  wrap.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
  wrap.addEventListener('touchend', function (e) {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 12) rotateDial(dx > 0 ? 1 : -1);
  }, { passive: true });
})();

function confirmDigit() {
  dEntry.push(dVal);
  const sl = document.getElementById('cs' + (dEntry.length - 1));
  sl.textContent = dVal; sl.classList.add('set');
  sfx('tick');
  dStep++;
  if (dStep < 4) {
    document.getElementById('dialStep').textContent = `digit ${dStep + 1} / 4`;
    dVal = 0;
    document.getElementById('dialNum').childNodes[0].textContent = '0';
    drawDial();
  } else {
    if (dEntry.every(function (v, i) { return v === L1[i]; })) {
      sfx('chime');
      bloom(function () { goTo('s-lock2'); initFlower(); });
    } else {
      sfx('err');
      document.querySelectorAll('.combo-slot').forEach(function (s) { s.classList.add('wrong'); });
      setTimeout(function () {
        dEntry = []; dStep = 0; dVal = 0;
        document.querySelectorAll('.combo-slot').forEach(function (s) {
          s.textContent = '—'; s.classList.remove('set', 'wrong');
        });
        document.getElementById('dialStep').textContent = 'digit 1 / 4';
        document.getElementById('dialNum').childNodes[0].textContent = '0';
        drawDial();
      }, 700);
    }
  }
}

drawDial();

/* ─────────────────────────────────
   LOCK 2 | FLOWER PETAL PLUCK — order idx 0(7) → 2(9) → 4(8) → 6(5)
───────────────────────────────── */
const PETAL_VALS = [7, 3, 9, 1, 8, 6, 5, 2];
const PETAL_ORDER = [0, 2, 4, 6];
const FW = 270, FH = 270, FCX = 135, FCY = 135;
const PETAL_DIST = 74, PETAL_RX = 13, PETAL_RY = 42;

let petalProgress = 0;
let petalLocked = false;
let petalStates = Array(8).fill('present'); // present | plucking | plucked | growing
let petalAnimT = new Array(8).fill(0);
let flowerRaf = null;
let lastFlowerTs = null;

function buildPluckPips() {
  const c = document.getElementById('pluckPips');
  c.innerHTML = '';
  PETAL_ORDER.forEach(function (_, i) {
    const p = document.createElement('div');
    p.className = 'pluck-pip'; p.id = 'pp' + i;
    c.appendChild(p);
  });
}

function drawFlower() {
  const cv = document.getElementById('flowerCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, FW, FH);

  const g = ctx.createRadialGradient(FCX, FCY, 10, FCX, FCY, 90);
  g.addColorStop(0, 'rgba(192,66,90,.16)');
  g.addColorStop(1, 'rgba(192,66,90,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(FCX, FCY, 90, 0, Math.PI * 2); ctx.fill();

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const state = petalStates[i];
    const t = petalAnimT[i];
    if (state === 'plucked') continue;

    let scale = 1, alpha = 1, driftX = 0, driftY = 0, extraRot = 0;
    if (state === 'plucking') {
      scale = 1 - t; alpha = 1 - t;
      driftX = Math.cos(angle) * 35 * t;
      driftY = Math.sin(angle) * 35 * t;
      extraRot = t * Math.PI * 0.8;
    } else if (state === 'growing') {
      scale = t; alpha = t;
    }

    const px = FCX + Math.cos(angle) * PETAL_DIST + driftX;
    const py = FCY + Math.sin(angle) * PETAL_DIST + driftY;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    ctx.rotate(angle + Math.PI / 2 + extraRot);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.ellipse(0, 0, PETAL_RX, PETAL_RY, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#c0425a';
    ctx.shadowBlur = 0;
    ctx.fill();
    ctx.strokeStyle = 'rgba(192,66,90,.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.rotate(-(angle + Math.PI / 2 + extraRot));
    ctx.font = "500 15px 'Cormorant Garamond', serif";
    ctx.fillStyle = '#ffd0d8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(PETAL_VALS[i]), 0, 0);
    ctx.restore();
  }

  ctx.beginPath(); ctx.arc(FCX, FCY, 22, 0, Math.PI * 2);
  ctx.fillStyle = '#7a1f3a'; ctx.fill();
  ctx.strokeStyle = 'rgba(192,66,90,.45)';
  ctx.lineWidth = 1.5; ctx.stroke();
  ctx.font = "16px serif";
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🌸', FCX, FCY);
}

const ANIM_SPEED = 2.4;

function flowerLoop(ts) {
  if (!lastFlowerTs) lastFlowerTs = ts;
  const dt = Math.min((ts - lastFlowerTs) / 1000, 0.05);
  lastFlowerTs = ts;

  let anyActive = false;
  for (let i = 0; i < 8; i++) {
    const state = petalStates[i];
    if (state === 'plucking' || state === 'growing') {
      petalAnimT[i] = Math.min(petalAnimT[i] + dt * ANIM_SPEED, 1);
      if (petalAnimT[i] >= 1) {
        if (state === 'plucking') { petalStates[i] = 'plucked'; petalAnimT[i] = 1; }
        else if (state === 'growing') { petalStates[i] = 'present'; petalAnimT[i] = 0; }
      } else {
        anyActive = true;
      }
    }
  }

  drawFlower();

  if (anyActive) {
    flowerRaf = requestAnimationFrame(flowerLoop);
  } else {
    flowerRaf = null;
    lastFlowerTs = null;
  }
}

function startFlowerAnim() {
  if (!flowerRaf) {
    lastFlowerTs = null;
    flowerRaf = requestAnimationFrame(flowerLoop);
  }
}

function tapPetal(idx) {
  if (petalLocked) return;
  if (petalStates[idx] !== 'present') return;
  if (flowerRaf) return;

  const expected = PETAL_ORDER[petalProgress];

  if (idx === expected) {
    petalStates[idx] = 'plucking';
    petalAnimT[idx] = 0;
    sfx('pluck');
    document.getElementById('pp' + petalProgress).classList.add('done');
    petalProgress++;
    startFlowerAnim();

    if (petalProgress === PETAL_ORDER.length) {
      petalLocked = true;
      document.getElementById('flowerStatus').textContent = '🌸 All petals plucked! Unlocked!';
      sfx('chime');
      setTimeout(function () { bloom(function () { goTo('s-vows'); }); }, 900);
    } else {
      const msgs = ['Beautiful! Keep going ✦', 'Two more... ✦', 'Last one! ✦'];
      document.getElementById('flowerStatus').textContent = msgs[petalProgress - 1] || 'Keep going ✦';
    }
  } else {
    petalLocked = true;
    sfx('err');
    document.getElementById('flowerStatus').textContent = 'Oops! They\'re growing back... 🌱';
    petalStates[idx] = 'plucking';
    petalAnimT[idx] = 0;
    startFlowerAnim();
    setTimeout(function () {
      for (let i = 0; i < 8; i++) {
        if (petalStates[i] === 'plucked' || petalStates[i] === 'plucking') {
          petalStates[i] = 'growing';
          petalAnimT[i] = 0;
        }
      }
      petalProgress = 0;
      buildPluckPips();
      startFlowerAnim();
      setTimeout(function () {
        petalLocked = false;
        document.getElementById('flowerStatus').textContent = 'Tap the petals in the right order ✦';
      }, 700);
    }, 500);
  }
}

function initFlower() {
  petalProgress = 0;
  petalLocked = false;
  petalStates = Array(8).fill('present');
  petalAnimT = new Array(8).fill(0);
  if (flowerRaf) { cancelAnimationFrame(flowerRaf); flowerRaf = null; }
  lastFlowerTs = null;
  buildPluckPips();
  document.getElementById('flowerStatus').textContent = 'Tap the petals in the right order ✦';

  const cv = document.getElementById('flowerCanvas');
  const newCv = cv.cloneNode(true); // drop old listeners
  cv.parentNode.replaceChild(newCv, cv);

  requestAnimationFrame(function () { drawFlower(); });

  newCv.addEventListener('click', function (e) {
    const rect = newCv.getBoundingClientRect();
    const scaleX = FW / rect.width, scaleY = FH / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const px = FCX + Math.cos(angle) * PETAL_DIST;
      const py = FCY + Math.sin(angle) * PETAL_DIST;
      if (Math.sqrt((mx - px) ** 2 + (my - py) ** 2) < 40) {
        tapPetal(i); return;
      }
    }
  });
}

/* ─────────────────────────────────
   VOWS / SIGN → unlock → letter.html
───────────────────────────────── */
function checkSign() {
  const v = document.getElementById('signInput').value.trim();
  const err = document.getElementById('signErr');
  if (v.toLowerCase() === 'ritika bajaj') {
    err.textContent = '';
    sfx('chime');
    try { sessionStorage.setItem('riti_open', '1'); } catch (e) {}
    bloom(function () { location.href = 'letter.html'; });
  } else {
    err.textContent = v.length === 0 ? 'Please sign your name ✦' : 'That doesn\'t look right, try again 🌸';
    const inp = document.getElementById('signInput');
    inp.style.borderColor = 'rgba(255,80,80,.5)';
    setTimeout(function () { inp.style.borderColor = ''; }, 900);
  }
}
document.getElementById('signInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); checkSign(); }
});
