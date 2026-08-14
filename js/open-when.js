/* =====================================================================
   open-when.js — the "Open When…" collection (open-when.html)

   Two sides, toggled at the top of the page:
     · Riti  — notes written by Parv, for Riti (words live in
               ../open-when-letters.md; bodies here are empty →
               PLACEHOLDER_BODY until his real text is copied in). Each
               has a voice clip at voice/<key>.m4a.
     · Parv  — notes handwritten by Riti, for Parv (transcribed verbatim
               from her cards; line breaks preserved exactly). No audio.

   Either of them can also add a new note (title + body) via the "＋"
   card. Added notes are saved with saveUserNotes() — currently
   localStorage (per device). Swap that one function for a shared backend
   to sync between phones.
   ===================================================================== */

const PLACEHOLDER_BODY =
  '💌<br><br>Pavu\'s real words for this one are coming soon. ' +
  'He\'s writing it himself, just for you.';

/* ── Riti's side: Parv → Riti (placeholders for now) ── */
const OPEN_WHEN = [
  { key:'miss', emoji:'💌', cap:'Open when you miss me',              title:'When you miss me' },
  { key:'horny', emoji:'🔥', cap:"Open when you're needy for me",      title:"When you're needy for me" },
  { key:'sad', emoji:'🤍', cap:"Open when you're crying",             title:"When you're crying" },
  { key:'mad', emoji:'😤', cap:"Open when you're mad at me",          title:"When you're mad at me" },
  { key:'sleep', emoji:'🌙', cap:"Open when you can't sleep",          title:"When you can't sleep" },
  { key:'insecure', emoji:'💖', cap:"Open when you feel not-enough",   title:"When you feel not-enough" },
  { key:'owned', emoji:'🎀', cap:'Open when you want to feel mine',    title:'When you want to feel mine' },
  { key:'smile', emoji:'🌸', cap:'Open when you need to smile',        title:'When you need to smile' },
  { key:'wake', emoji:'🌅', cap:'Open when you wake up',              title:'When you wake up' },
  { key:'stressed', emoji:'🌊', cap:"Open when it's all too much",     title:"When it's all too much" },
  { key:'period', emoji:'🩷', cap:"Open when your body's fighting you",title:"When your body's fighting you" },
  { key:'forever', emoji:'💍', cap:'Open when you doubt us',           title:'When you doubt us' }
];

/* ── Parv's side: Riti → Parv (verbatim; line breaks preserved) ── */
const RITI_LETTERS = [
  { emoji:'💌', title:'Missing Me',
    body:`Oyi pagal<br><br>Yaad aa rhi h terko meri. Koi na, thodi der main tere pass hi hounga.<br>Muh tod liyo fir mera. Terko pta toh h teri bndi badtameez h phone khi bhi rkh ke bhaag<br>jaati h. Phone dekhte hi terko call krna h sbse phle.<br><br>Miss you more :)` },

  { emoji:'🤍', title:'Separated',
    body:`Mujhe pta h ye letter kbhi kholne ki zrurat hi nhi pdegi apko.<br>Hum alag ho hi nhi skte.` },

  { emoji:'🎂', title:'Birthday',
    body:`Happy Birthday my love<br><br>I know tere sath nhi hu physically but aage aane wale life ke sare<br>birthday apko mere sath hi manane h.<br>I promise apki wife apka hr birthday bhut special bnaegi.<br>Tu na jaan se zyda pyra h mujhe. Mn toh mera bhi bhoot tha tere pass<br>hone ka but koi nhi, aage aane wale sare special days sath honge.` },

  { emoji:'😤', title:'Angry',
    body:`Bcha gussa h merse<br>Sorry bche, glti krdi hogi na maine koi. Please maaf krdo na bche ko.<br>Sorry love.<br>Aage se apko pareshan nhi krunga.` },

  { emoji:'💙', title:'Parvie',
    body:`Parvie<br><br>I know tujhe ye chiz bdi vague si lgti h, kpde as a gift lena. But I<br>won't be there on your birthday with you.<br>Mujhe kuch esa dena tha jo tujhe meri presence vha feel krwa pae, my warmth,<br>and I know jacket aap pehnoge toh woh chiz feel kr paoge<br>that I am there around you.<br><br>Teri Riti` },

  { emoji:'🔥', title:'Sex',
    body:`You horny fuck!<br>Gurgaon aaja fir bada sara sex krenge!` },

  { emoji:'😊', title:'Happy',
    body:`Hi love,<br><br>Dekh mujhe reason to nhi pata ap kyo khush hoge jb ye letter khologo<br>but I know sbse phle share merse hi karte ho. Sath hue toh acha se<br>time spend krenge, sath main aur sath nhi hua toh phone par toh hounga<br>hi. Tujhe khush dekhna h esse humesha. You know na how much I love<br>you &lt;3` },

  { emoji:'🌩️', title:'Fight',
    body:`Ladai hogyi humari. Merko pta h glti bhi meri hogi, ladai bhi mene ki<br>hogi. Pgal bche udas na ho, abhi aa jana h maine tere pass.<br>Reh hi nhi skti tere bina. Tujhe pta h tu zindagi h meri, zyada dur dur nhi<br>reh paunga.` },

  { emoji:'🫂', title:'Sad',
    body:`Jaan Meri<br><br>Ese udas nhi hote, main hu na apke pass. Apke pass toh itna bda<br>reason h khush hone ka. Sath hounga na, apne bche ko hug krke thk<br>krdunga. Pareshan toh psnd hi nhi h tu. Ab aise shant shant na reh<br>aur jldi se mere pass aaja, main khush krdunga bche ko.<br><br>iloveyou` },

  { emoji:'🍜', title:'Hungry',
    body:`Call me!<br>You promised mujhe btaega kuch yummy sa khilata hu baby ko.` }
];

/* =====================  storage (per side)  =====================
   Swap these two functions for a shared backend to sync devices. */
function loadUserNotes(side) {
  try { return JSON.parse(localStorage.getItem('ownotes_' + side) || '[]'); }
  catch (e) { return []; }
}
function saveUserNotes(side, arr) {
  try { localStorage.setItem('ownotes_' + side, JSON.stringify(arr)); }
  catch (e) {}
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let currentSide = 'riti';
function sideBase() { return currentSide === 'parv' ? RITI_LETTERS : OPEN_WHEN; }
function sideData() { return sideBase().concat(loadUserNotes(currentSide)); }

function setSide(side) {
  closeWhen();   // don't leave a note/overlay from the other side open
  closeAdd();
  currentSide = side;
  document.body.classList.toggle('side-parv', side === 'parv');
  document.querySelectorAll('.ow-side').forEach(function (el) {
    el.classList.toggle('active', el.dataset.side === side);
  });
  if (side === 'parv') {
    document.getElementById('owKicker').textContent = 'Written by Riti · for you';
    document.getElementById('owNote').textContent = 'Her little letters, one for every feeling. 💙';
  } else {
    document.getElementById('owKicker').textContent = 'Sealed · for the right moment';
    document.getElementById('owNote').textContent = '';
  }
  buildGrid();
}

function buildGrid() {
  const grid = document.getElementById('owGrid');
  grid.innerHTML = '';
  const seal = currentSide === 'parv' ? '💙' : '❤';
  sideData().forEach(function (l, i) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ow-card';
    b.style.animationDelay = (i * 0.045) + 's';
    b.innerHTML =
      '<div class="mini-env"><div class="mini-seal">' + seal + '</div></div>' +
      '<div class="ow-cap">' + escapeHtml(l.cap || l.title) + '</div>';
    b.addEventListener('click', function () { openEnvelope(i); });
    grid.appendChild(b);
  });
  // trailing "add a note" card
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'ow-add-card';
  add.innerHTML = '<div class="ow-add-env">＋</div><div class="ow-cap">Add a note</div>';
  add.addEventListener('click', openAdd);
  grid.appendChild(add);
}

let owTimer = null;
let currentNoteId = null; // set when an added (deletable) note is open
function openEnvelope(i) {
  const l = sideData()[i];
  if (!l) return;
  currentNoteId = l.user ? l.id : null;

  document.getElementById('owPaperEmoji').textContent = l.emoji || (currentSide === 'parv' ? '💙' : '💌');
  document.getElementById('owPaperTitle').textContent = l.title;
  document.getElementById('owPaperBody').innerHTML =
    l.user ? escapeHtml(l.body).replace(/\n/g, '<br>') : (l.body || PLACEHOLDER_BODY);
  document.getElementById('owNoteDel').style.display = l.user ? 'block' : 'none';

  // voice: only Parv's original notes to Riti carry clips
  const voice = document.querySelector('.ow-voice');
  const a = document.getElementById('owAudio');
  if (currentSide === 'riti' && l.key) {
    voice.style.display = '';
    a.pause(); a.currentTime = 0;
    a.src = 'voice/' + l.key + '.m4a';
    document.getElementById('owVoiceHint').textContent = '';
    setVoiceUI(false);
  } else {
    a.pause();
    voice.style.display = 'none';
  }

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

/* =====================  add / delete a note  ===================== */
function openAdd() {
  document.getElementById('owInTitle').value = '';
  document.getElementById('owInBody').value = '';
  document.getElementById('owFormErr').textContent = '';
  document.getElementById('owFormWho').textContent = currentSide === 'parv' ? 'for Parv' : 'for Riti';
  document.getElementById('owAddOverlay').classList.add('active');
  document.getElementById('owForm').classList.add('show');
}
function closeAdd() {
  document.getElementById('owAddOverlay').classList.remove('active');
  document.getElementById('owForm').classList.remove('show');
}
function saveNote(e) {
  if (e) e.preventDefault();
  const title = document.getElementById('owInTitle').value.trim();
  const body  = document.getElementById('owInBody').value.replace(/\s+$/, '');
  if (!title || !body.trim()) {
    document.getElementById('owFormErr').textContent = 'Add a title and a few words 💛';
    return false;
  }
  const notes = loadUserNotes(currentSide);
  notes.push({ id: 'u' + Date.now(), user: true, emoji: currentSide === 'parv' ? '💙' : '💌', title: title, body: body });
  saveUserNotes(currentSide, notes);
  closeAdd();
  buildGrid();
  openEnvelope(sideData().length - 1); // open the note we just added
  return false;
}
function deleteCurrentNote() {
  if (!currentNoteId) return;
  const notes = loadUserNotes(currentSide).filter(function (n) { return n.id !== currentNoteId; });
  saveUserNotes(currentSide, notes);
  currentNoteId = null;
  closeWhen();
  buildGrid();
}

/* ── per-note voice note (Riti's side only) ── */
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

/* wire the Riti / Parv toggle */
document.querySelectorAll('.ow-side').forEach(function (el) {
  el.addEventListener('click', function () { setSide(el.dataset.side); });
});

buildGrid();
