/* =====================================================================
   open-when.js — the "Open When…" collection (open-when.html)
     Builds the grid of sealed envelopes, opens one into a parchment
     letter with an envelope animation, and plays a per-note voice clip.

   ✍️  The letter WORDS live in ../open-when-letters.md (the source of truth).
       Entries below carry no `body`, so every note shows PLACEHOLDER_BODY
       until Parv's real text from that file is copied in here.

   Voice: each note plays voice/<key>.m4a. Drop a recording there (same
   name) to replace the placeholder, or add an `audio:` field to override.
   ===================================================================== */

const PLACEHOLDER_BODY =
  '💌<br><br>Pavu\'s real words for this one are coming soon — ' +
  'he\'s writing it himself, just for you.';

const OPEN_WHEN = [
  { key:'miss',     emoji:'💌', cap:'Open when you miss me',              title:'When you miss me' },
  { key:'horny',    emoji:'🔥', cap:"Open when you're needy for me",      title:"When you're needy for me" },
  { key:'sad',      emoji:'🤍', cap:"Open when you're crying",            title:"When you're crying" },
  { key:'mad',      emoji:'😤', cap:"Open when you're mad at me",         title:"When you're mad at me" },
  { key:'sleep',    emoji:'🌙', cap:"Open when you can't sleep",          title:"When you can't sleep" },
  { key:'insecure', emoji:'💖', cap:"Open when you feel not-enough",      title:"When you feel not-enough" },
  { key:'owned',    emoji:'🎀', cap:'Open when you want to feel mine',    title:'When you want to feel mine' },
  { key:'smile',    emoji:'🌸', cap:'Open when you need to smile',        title:'When you need to smile' },
  { key:'wake',     emoji:'🌅', cap:'Open when you wake up',              title:'When you wake up' },
  { key:'stressed', emoji:'🌊', cap:"Open when it's all too much",        title:"When it's all too much" },
  { key:'period',   emoji:'🩷', cap:"Open when your body's fighting you", title:"When your body's fighting you" },
  { key:'forever',  emoji:'💍', cap:'Open when you doubt us',             title:'When you doubt us' }
];

function buildOpenWhen() {
  const grid = document.getElementById('owGrid');
  grid.innerHTML = '';
  OPEN_WHEN.forEach(function (l, i) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ow-card';
    b.style.animationDelay = (i * 0.045) + 's';
    b.innerHTML =
      '<div class="mini-env"><div class="mini-seal">❤</div></div>' +
      '<div class="ow-cap">' + l.cap + '</div>';
    b.addEventListener('click', function () { openEnvelope(l.key); });
    grid.appendChild(b);
  });
}

let owTimer = null;
function openEnvelope(key) {
  const l = OPEN_WHEN.find(function (x) { return x.key === key; });
  if (!l) return;

  document.getElementById('owPaperEmoji').textContent = l.emoji;
  document.getElementById('owPaperTitle').textContent = l.title;
  document.getElementById('owPaperBody').innerHTML = l.body || PLACEHOLDER_BODY;

  // per-note voice — defaults to voice/<key>.m4a; set entry.audio to override
  const a = document.getElementById('owAudio');
  a.pause(); a.currentTime = 0;
  a.src = l.audio || ('voice/' + l.key + '.m4a');
  document.getElementById('owVoiceHint').textContent = '';
  setVoiceUI(false);

  const reader = document.getElementById('owReader');
  const stage  = document.getElementById('envStage');
  const env    = document.getElementById('env');
  const paper  = document.getElementById('owPaper');

  paper.classList.remove('show');
  stage.classList.remove('done');
  env.classList.remove('open');

  reader.classList.add('active');
  reader.scrollTop = 0;

  if (navigator.vibrate) navigator.vibrate(18); // wax-crack

  void env.offsetWidth; // restart the opening animation
  env.classList.add('open');

  clearTimeout(owTimer);
  owTimer = setTimeout(function () {
    stage.classList.add('done');
    paper.classList.add('show');
  }, 1520);
}

function closeWhen() {
  clearTimeout(owTimer);
  document.getElementById('owAudio').pause();
  setVoiceUI(false);
  document.getElementById('owReader').classList.remove('active');
  document.getElementById('env').classList.remove('open');
  document.getElementById('envStage').classList.remove('done');
  document.getElementById('owPaper').classList.remove('show');
}

/* ── per-note voice note ── */
function setVoiceUI(playing) {
  document.getElementById('owPlayBtn').classList.toggle('playing', playing);
  document.getElementById('owPlayIc').textContent = playing ? '❚❚' : '▶';
  document.getElementById('owPlayLbl').textContent = playing ? 'Playing…' : 'Play his voice';
}
function toggleVoice() {
  const a = document.getElementById('owAudio');
  if (a.paused) {
    a.play().then(function () { setVoiceUI(true); }).catch(function () {
      setVoiceUI(false);
      document.getElementById('owVoiceHint').textContent = 'voice note coming soon 💛';
    });
  } else {
    a.pause();
    setVoiceUI(false);
  }
}
document.getElementById('owAudio').addEventListener('ended', function () { setVoiceUI(false); });

buildOpenWhen();
