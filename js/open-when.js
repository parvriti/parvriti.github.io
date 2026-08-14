/* =====================================================================
   open-when.js : the "Open When…" collection (open-when.html)

   Two sides, toggled at the top of the page:
     · Riti  = notes written by Parv, for Riti. Source words in
               ../open-when-letters.md. Each note has a voice clip at
               voice/<key>.m4a.
     · Parv  = notes handwritten by Riti, for Parv (transcribed verbatim
               from her cards). No audio.

   Either of them can also add a new note (title + body) via the "＋"
   card. Added notes are saved with saveUserNotes(), currently
   localStorage (per device). Swap that one function for a shared backend
   to sync between phones.
   ===================================================================== */

const PLACEHOLDER_BODY =
  '💌<br><br>Pavu\'s real words for this one are coming soon. ' +
  'He\'s writing it himself, just for you.';

/* ── Riti's side: Parv → Riti (his letters + voice; body line breaks tuned for the UI) ── */
const OPEN_WHEN = [
  { key:'missing', emoji:'💌', title:'Missing me',
    body:`Jaan meri, bas ab thode time ki baat hai fir shadi krke saara din terko hi chipte rehna hai maine. kabhi akela chodna hi ni ki terko meri yaad aaye, sara din aapke pass hi baitha milunga.` },

  { key:'wet', emoji:'🔥', title:'Wet',
    body:`Tera pati to tere liye humesha hard rehta hai meri jaan, mai to aapke iloveyou pe hi itna hard hojata ki aapke liye merko hard krna sbse easy kaam hai. aap to jab jab wet ho, bas mere kaan me iloveyou whisper krdia krro mai ussi second aapke liye hard hoke aapko fuck krega.` },

  { key:'crying', emoji:'🤍', title:'crying',
    body:`Mere hote hue bhi aap akele ro rhe ho fir to mai gnda pati hua. Mere hote hue aap kabhi akele me mat rona meri beti, bas aake merko sab bta dena jis baat se bhi pareshan hue ho, jo bhi hoga mai sab theek krdega aur aapko bada saara pyaar krega.` },

  { key:'angry', emoji:'😤', title:'Angry',
    body:`Ab meri beti merse gussa hai to maine gnd to kuch pkka machaya hoga, pr apne tote se aise zyada der naraz mat rehna, tota mana to raha hoga aapko bht, maan jaana na jaldi jaldi, aapme to jaan basti oi, aap naraz hojao to zindagi sooni sooni hojati. tu to merko bas apne sath hasta khelta chahiye hota hai, terko itna pyaar krru bas ki kabhi gussa hone hi na du terko to mai.` },

  { key:'nonini', emoji:'🌙', title:'No nini',
    body:`Pehle to tu ye baat chod de ki mai so rha hou raat ko to utha ni skte. Terko saare haq aise hi thodi de rkhe oi, tu to merko jab mann krre tab utha skta. jab bhi terko aise neend na aarhi ho tu bas humesha mere pass aajaya kar, merko utha ke merese saari raat baate kar, merse khush dekhio koi ni hoga.` },

  { key:'anxious', emoji:'💖', title:'Anxious',
    body:`Meri jaan, jabse maine khud anxiety face krri hai na mai smjh gya hu ki ye sbse gndi cheez hoti, aur isme agar aise lag bhi rha ho na ki baat krke kuch theek hoga fir bhi humesha krna, terko pata ni betu pr jo insaan tumse bht pyaar krta hota na usse baat krna har cheez me help krega aur humesha krega fir chahe anxiety hui ho kisi baat ko lekar ya kuch aur bhi hua ho, tu bas mere pass aake merko zor se hug krlio aur jo dimaag me chal rha ho bta diyo sab.` },

  { key:'reassurance', emoji:'🎀', title:'Reassurance',
    body:`Merko pata hai tu alag alag time pr kuch cheezo ko lekr bht pareshan rha hai jo bhi aapko reasons lagte the jinki vajah se mai chod skta aapko. par terko idea bhi ni hai meri jaan tu mere liye kitna upar hai, yaha mai saari zindagi tera dhyaan teri sehat ka dhyaan rkhne ko taiyaar hu, aur terko lagta terko koi choti si dikkat hogi health wise aur mai chodna consider krlunga? mai kehta hu na terko ki aise koi reason bana hi ni hai, jo merko terko chodne vaali cheez consider bhi karvaade. Mai to bhagwan se bhi ladd jau bas terse alag hone ki ni soch skta kabhi bhi.` },

  { key:'puppy', emoji:'🌸', title:'Puppy',
    body:`Tu to life bhar ke liye meri whore ban rhi hai, terko to pata ni kis kis cheez ke liye train krna hai maine saari zindagi. tere saath ek bucket list bnani hai alag alag countries jaake puri krenge jo ek ek krke. itni alag alag balconies me terko fuck krna hai, terse dick suck krvaani hai, terko lick krna hai. Saari life ye cheeze khtm ni honi, ek list khtm hogi to dusri bnaa lenge. kabhi kabhi to sochta hu kitna lucky rha hu mai jo meri whore aur biwi dono itni pyaari mili.` },

  { key:'happy', emoji:'🌅', title:'Happy',
    body:`Aaj tota khush hai itna to ye to mera favourite din hua. terko pata hai mera mood to khud itna dependant rehta hai terpe ki jis din tu khush khush hota hai aise mai apne aap khush hojaata hu. terko khush dekhta hu to andar se ek alag tarah ki satisfaction aajati hai aur mann krta bas tu aise hi rahe humesha. chehekta hua bauu pyara lagta.` },

  { key:'periods', emoji:'🌊', title:'Periods',
    body:`Merko pata hai terko bht dard horha hota, mai dard to theek ni kar skta pr mai jo jo kr skta hounga na tu dekhio mai sab krega. mai tere per bhi dabayega jaha jaha terko dard hoga vaha massage krega, pura din terko bottle garam krke dega terko ek baar bhi khud ni uthne dega. Abhi to merko khana bnaana ni aata to vo terko khud bna ke ni deskta pr aage jaake vo bhi seekhega taaki terko mere hote hue zara sa bhi pareshan na hona pade. mai hi tera itna acha dhyan rkhlu ki tere liye dard jhelna asaan kar paau.<br><br>teri dolo bnna hai merko xD` },

  { key:'owner', emoji:'🩷', title:'Owner',
    body:`Maine na kabhi apne andar ye cheez tere aane se pehle feel ni ki thi, pr terse jo merko andha pyaar hai na vo merko itna vulnerable krdeta hai ki mera khud andar se surrender krne ka mann krta hai. Meri puri body meri sunna chod ke tere order manti hai us moment me aur merko vo itna precious lagta hai na jab mai feel krra hota. Aise emotions feel krvaye hai na tune jo merko pata bhi ni tha mere andar exist bhi krte hai. Mai sirf horny hoke terko owner ni bolta, mai vo cheez feel krta hu ki jab jab tu control leta mera mind actual me control chodta hai. Terko ko official contract sign krke bhi dedena hai maine ki mai pura sirf riti ka hu, khud ki koi identity ni hai bas meri riti ka hu mai.<br><br>mai pavu ni hu, mai riti's pavu hu.` },

  { key:'marriage', emoji:'💍', title:'Marriage',
    body:`fatafat shadi krlo na merse please, merse zara wait ni hota ab. mai na subha uthte hi terko dhundta hu, office se aake tu chahiye hota hai. Tu apna kaam bhi krta rhe na ghar pe tab bhi ek alag tarah ki completeness feel hota hai, tu nai hota na bada adhoora adhoora lagta. Tere bina bilkul acha ni lagrha hota, tu badi zor se chahiye hota hai ab mujhe.<br><br>kisi sundar se pahad pe lejaake merse shadi krlo jaldi jaldi plis.` }
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
  } else {
    document.getElementById('owKicker').textContent = 'Written by Pavu · for you';
  }
  document.getElementById('owNote').textContent = '';
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
  // "Add a note" card is disabled for now. localStorage only saves on one
  // device, so notes could not actually be shared between phones. Re-enable
  // once there is a shared backend by uncommenting the block below.
  // const add = document.createElement('button');
  // add.type = 'button';
  // add.className = 'ow-add-card';
  // add.innerHTML = '<div class="ow-add-env">＋</div><div class="ow-cap">Add a note</div>';
  // add.addEventListener('click', openAdd);
  // grid.appendChild(add);
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

/* Esc closes an open note (or the add form) */
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape' && e.key !== 'Esc') return;
  if (document.getElementById('owReader').classList.contains('active')) closeWhen();
  if (document.getElementById('owAddOverlay').classList.contains('active')) closeAdd();
});

/* wire the Riti / Parv toggle */
document.querySelectorAll('.ow-side').forEach(function (el) {
  el.addEventListener('click', function () { setSide(el.dataset.side); });
});

buildGrid();
