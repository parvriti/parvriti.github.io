/* =====================================================================
   open-when.js : the "Open When…" collection (open-when.html)

   Each envelope is an EMOTION that holds a dated STACK of notes, so you can
   watch a feeling grow over the years. The original letters are hardcoded
   seeds (sealed, read-only, with their real dates). New notes live in
   Firestore and sync between phones in real time.

   Sides (author is implied by the tab, each writes on their own):
     · riti = Parv's letters for Riti  (seeds 14 Aug 2026, have voice)
     · parv = Riti's letters for Parv  (seeds 10 Dec 2020, no voice)

   New notes always stamp a live date at creation; editing never changes it.
   ===================================================================== */

/* ── Firebase (compat SDK loaded via <script> in the HTML) ── */
const firebaseConfig = {
  apiKey: "AIzaSyBW_EMfKIkIJDNSMPUp6UeHOGtIdv26Wpk",
  authDomain: "parvriti.firebaseapp.com",
  projectId: "parvriti",
  storageBucket: "parvriti.firebasestorage.app",
  messagingSenderId: "598106428796",
  appId: "1:598106428796:web:bcb49b129377d9a5d6c0f9"
};
let db = null;
try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);   // common.js usually inits first
    db = firebase.firestore();
  }
} catch (e) { console.warn('Firebase init failed', e); }

function serverTime() {
  try { return firebase.firestore.FieldValue.serverTimestamp(); } catch (e) { return Date.now(); }
}

/* We only start listening once the sign-in gate (common.js) has confirmed an
   allowed account, so the Firestore read carries an auth token. */
let liveNotes = [];   // notes from Firestore (both sides)
let seedReads = {};   // openWhenReads/seeds: which hardcoded seed letters the recipient has opened
let seedReadsLoaded = false;   // don't sparkle seeds until we actually know their read state
let notesStarted = false;
function startNotes() {
  if (notesStarted || !db) return;
  notesStarted = true;
  try {
    db.collection('notes').onSnapshot(function (snap) {
      liveNotes = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      onLive();
    }, function (err) { console.warn('notes listen error', err); });
    db.collection('openWhenReads').doc('seeds').onSnapshot(function (snap) {
      seedReads = (snap.exists && snap.data()) ? snap.data() : {};
      seedReadsLoaded = true;
      onLive();
    }, function () { seedReadsLoaded = true; onLive(); });
  } catch (e) { console.warn('subscribe failed', e); }
}
if (window.__parvritiAuthed) startNotes();
else window.addEventListener('parvriti-authed', startNotes, { once: true });

/* =====================  seed letters (sealed)  ===================== */
/* Riti's side: Parv → Riti. Dated 14 Aug 2026. Each has voice/<key>.m4a. */
const SEED_RITI = [
  { emotion:'missing', emoji:'💌', title:'Missing me', date:'2026-08-14', voiceFile:'voice/missing.m4a',
    body:`Jaan meri, bas ab thode time ki baat hai fir shadi krke saara din terko hi chipte rehna hai maine. kabhi akela chodna hi ni ki terko meri yaad aaye, sara din aapke pass hi baitha milunga.` },
  { emotion:'wet', emoji:'🔥', title:'Wet', date:'2026-08-14', voiceFile:'voice/wet.m4a',
    body:`Tera pati to tere liye humesha hard rehta hai meri jaan, mai to aapke iloveyou pe hi itna hard hojata ki aapke liye merko hard krna sbse easy kaam hai. aap to jab jab wet ho, bas mere kaan me iloveyou whisper krdia krro mai ussi second aapke liye hard hoke aapko fuck krega.` },
  { emotion:'crying', emoji:'🤍', title:'crying', date:'2026-08-14', voiceFile:'voice/crying.m4a',
    body:`Mere hote hue bhi aap akele ro rhe ho fir to mai gnda pati hua. Mere hote hue aap kabhi akele me mat rona meri beti, bas aake merko sab bta dena jis baat se bhi pareshan hue ho, jo bhi hoga mai sab theek krdega aur aapko bada saara pyaar krega.` },
  { emotion:'angry', emoji:'😤', title:'Angry', date:'2026-08-14', voiceFile:'voice/angry.m4a',
    body:`Ab meri beti merse gussa hai to maine gnd to kuch pkka machaya hoga, pr apne tote se aise zyada der naraz mat rehna, tota mana to raha hoga aapko bht, maan jaana na jaldi jaldi, aapme to jaan basti oi, aap naraz hojao to zindagi sooni sooni hojati. tu to merko bas apne sath hasta khelta chahiye hota hai, terko itna pyaar krru bas ki kabhi gussa hone hi na du terko to mai.` },
  { emotion:'nonini', emoji:'🌙', title:'No nini', date:'2026-08-14', voiceFile:'voice/nonini.m4a',
    body:`Pehle to tu ye baat chod de ki mai so rha hou raat ko to utha ni skte. Terko saare haq aise hi thodi de rkhe oi, tu to merko jab mann krre tab utha skta. jab bhi terko aise neend na aarhi ho tu bas humesha mere pass aajaya kar, merko utha ke merese saari raat baate kar, merse khush dekhio koi ni hoga.` },
  { emotion:'anxious', emoji:'💖', title:'Anxious', date:'2026-08-14', voiceFile:'voice/anxious.m4a',
    body:`Meri jaan, jabse maine khud anxiety face krri hai na mai smjh gya hu ki ye sbse gndi cheez hoti, aur isme agar aise lag bhi rha ho na ki baat krke kuch theek hoga fir bhi humesha krna, terko pata ni betu pr jo insaan tumse bht pyaar krta hota na usse baat krna har cheez me help krega aur humesha krega fir chahe anxiety hui ho kisi baat ko lekar ya kuch aur bhi hua ho, tu bas mere pass aake merko zor se hug krlio aur jo dimaag me chal rha ho bta diyo sab.` },
  { emotion:'reassurance', emoji:'🎀', title:'Reassurance', date:'2026-08-14', voiceFile:'voice/reassurance.m4a',
    body:`Merko pata hai tu alag alag time pr kuch cheezo ko lekr bht pareshan rha hai jo bhi aapko reasons lagte the jinki vajah se mai chod skta aapko. par terko idea bhi ni hai meri jaan tu mere liye kitna upar hai, yaha mai saari zindagi tera dhyaan teri sehat ka dhyaan rkhne ko taiyaar hu, aur terko lagta terko koi choti si dikkat hogi health wise aur mai chodna consider krlunga? mai kehta hu na terko ki aise koi reason bana hi ni hai, jo merko terko chodne vaali cheez consider bhi karvaade. Mai to bhagwan se bhi ladd jau bas terse alag hone ki ni soch skta kabhi bhi.` },
  { emotion:'puppy', emoji:'🌸', title:'Puppy', date:'2026-08-14', voiceFile:'voice/puppy.m4a',
    body:`Tu to life bhar ke liye meri whore ban rhi hai, terko to pata ni kis kis cheez ke liye train krna hai maine saari zindagi. tere saath ek bucket list bnani hai alag alag countries jaake puri krenge jo ek ek krke. itni alag alag balconies me terko fuck krna hai, terse dick suck krvaani hai, terko lick krna hai. Saari life ye cheeze khtm ni honi, ek list khtm hogi to dusri bnaa lenge. kabhi kabhi to sochta hu kitna lucky rha hu mai jo meri whore aur biwi dono itni pyaari mili.` },
  { emotion:'happy', emoji:'🌅', title:'Happy', date:'2026-08-14', voiceFile:'voice/happy.m4a',
    body:`Aaj tota khush hai itna to ye to mera favourite din hua. terko pata hai mera mood to khud itna dependant rehta hai terpe ki jis din tu khush khush hota hai aise mai apne aap khush hojaata hu. terko khush dekhta hu to andar se ek alag tarah ki satisfaction aajati hai aur mann krta bas tu aise hi rahe humesha. chehekta hua bauu pyara lagta.` },
  { emotion:'periods', emoji:'🌊', title:'Periods', date:'2026-08-14', voiceFile:'voice/periods.m4a',
    body:`Merko pata hai terko bht dard horha hota, mai dard to theek ni kar skta pr mai jo jo kr skta hounga na tu dekhio mai sab krega. mai tere per bhi dabayega jaha jaha terko dard hoga vaha massage krega, pura din terko bottle garam krke dega terko ek baar bhi khud ni uthne dega. Abhi to merko khana bnaana ni aata to vo terko khud bna ke ni deskta pr aage jaake vo bhi seekhega taaki terko mere hote hue zara sa bhi pareshan na hona pade. mai hi tera itna acha dhyan rkhlu ki tere liye dard jhelna asaan kar paau.<br><br>teri dolo bnna hai merko xD` },
  { emotion:'owner', emoji:'🩷', title:'Owner', date:'2026-08-14', voiceFile:'voice/owner.m4a',
    body:`Maine na kabhi apne andar ye cheez tere aane se pehle feel ni ki thi, pr terse jo merko andha pyaar hai na vo merko itna vulnerable krdeta hai ki mera khud andar se surrender krne ka mann krta hai. Meri puri body meri sunna chod ke tere order manti hai us moment me aur merko vo itna precious lagta hai na jab mai feel krra hota. Aise emotions feel krvaye hai na tune jo merko pata bhi ni tha mere andar exist bhi krte hai. Mai sirf horny hoke terko owner ni bolta, mai vo cheez feel krta hu ki jab jab tu control leta mera mind actual me control chodta hai. Terko ko official contract sign krke bhi dedena hai maine ki mai pura sirf riti ka hu, khud ki koi identity ni hai bas meri riti ka hu mai.<br><br>mai pavu ni hu, mai riti's pavu hu.` },
  { emotion:'marriage', emoji:'💍', title:'Marriage', date:'2026-08-14', voiceFile:'voice/marriage.m4a',
    body:`fatafat shadi krlo na merse please, merse zara wait ni hota ab. mai na subha uthte hi terko dhundta hu, office se aake tu chahiye hota hai. Tu apna kaam bhi krta rhe na ghar pe tab bhi ek alag tarah ki completeness feel hota hai, tu nai hota na bada adhoora adhoora lagta. Tere bina bilkul acha ni lagrha hota, tu badi zor se chahiye hota hai ab mujhe.<br><br>kisi sundar se pahad pe lejaake merse shadi krlo jaldi jaldi plis.` }
];

/* Parv's side: Riti → Parv. Dated 10 Dec 2020. No voice. */
const SEED_PARV = [
  { emotion:'p_missing', emoji:'💌', title:'Missing Me', date:'2020-12-10',
    body:`Oyi pagal<br><br>Yaad aa rhi h terko meri. Koi na, thodi der main tere pass hi hounga. Muh tod liyo fir mera. Terko pta toh h teri bndi badtameez h phone khi bhi rkh ke bhaag jaati h. Phone dekhte hi terko call krna h sbse phle.<br><br>Miss you more :)` },
  { emotion:'p_separated', emoji:'🤍', title:'Separated', date:'2020-12-10',
    body:`Mujhe pta h ye letter kbhi kholne ki zrurat hi nhi pdegi apko. Hum alag ho hi nhi skte.` },
  { emotion:'p_birthday', emoji:'🎂', title:'Birthday', date:'2020-12-10',
    body:`Happy Birthday my love<br><br>I know tere sath nhi hu physically but aage aane wale life ke sare birthday apko mere sath hi manane h. I promise apki wife apka hr birthday bhut special bnaegi. Tu na jaan se zyda pyra h mujhe. Mn toh mera bhi bhoot tha tere pass hone ka but koi nhi, aage aane wale sare special days sath honge.` },
  { emotion:'p_angry', emoji:'😤', title:'Angry', date:'2020-12-10',
    body:`Bcha gussa h merse<br><br>Sorry bche, glti krdi hogi na maine koi. Please maaf krdo na bche ko. Sorry love. Aage se apko pareshan nhi krunga.` },
  { emotion:'p_parvie', emoji:'💙', title:'Parvie', date:'2020-12-10',
    body:`Parvie<br><br>I know tujhe ye chiz bdi vague si lgti h, kpde as a gift lena. But I won't be there on your birthday with you. Mujhe kuch esa dena tha jo tujhe meri presence vha feel krwa pae, my warmth, and I know jacket aap pehnoge toh woh chiz feel kr paoge that I am there around you.<br><br>Teri Riti` },
  { emotion:'p_sex', emoji:'🔥', title:'Sex', date:'2020-12-10',
    body:`You horny fuck!<br><br>Gurgaon aaja fir bada sara sex krenge!` },
  { emotion:'p_happy', emoji:'😊', title:'Happy', date:'2020-12-10',
    body:`Hi love,<br><br>Dekh mujhe reason to nhi pata ap kyo khush hoge jb ye letter khologo but I know sbse phle share merse hi karte ho. Sath hue toh acha se time spend krenge, sath main aur sath nhi hua toh phone par toh hounga hi. Tujhe khush dekhna h esse humesha. You know na how much I love you &lt;3` },
  { emotion:'p_fight', emoji:'🌩️', title:'Fight', date:'2020-12-10',
    body:`Ladai hogyi humari. Merko pta h glti bhi meri hogi, ladai bhi mene ki hogi. Pgal bche udas na ho, abhi aa jana h maine tere pass. Reh hi nhi skti tere bina. Tujhe pta h tu zindagi h meri, zyada dur dur nhi reh paunga.` },
  { emotion:'p_sad', emoji:'🫂', title:'Sad', date:'2020-12-10',
    body:`Jaan Meri<br><br>Ese udas nhi hote, main hu na apke pass. Apke pass toh itna bda reason h khush hone ka. Sath hounga na, apne bche ko hug krke thk krdunga. Pareshan toh psnd hi nhi h tu. Ab aise shant shant na reh aur jldi se mere pass aaja, main khush krdunga bche ko.<br><br>iloveyou` },
  { emotion:'p_hungry', emoji:'🍜', title:'Hungry', date:'2020-12-10',
    body:`Call me!<br><br>You promised mujhe btaega kuch yummy sa khilata hu baby ko.` }
];

/* =====================  helpers  ===================== */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtDate(iso) {
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const p = String(iso || '').split('-');
  if (p.length !== 3) return iso || '';
  return parseInt(p[2], 10) + ' ' + (m[parseInt(p[1], 10) - 1] || '') + ' ' + p[0];
}
function todayStr() {
  const d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function newKey() { return 'e' + Date.now().toString(36); }

/* milestone tags: shown only on NEW notes written on these dates */
function ordinal(n) { const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function milestoneTag(iso) {
  const p = String(iso || '').split('-'); if (p.length !== 3) return null;
  const md = p[1] + '-' + p[2], y = parseInt(p[0], 10);
  if (md === '12-10') return { emoji: '🎂', label: "Parv's birthday" };
  if (md === '04-20') return { emoji: '🎂', label: "Ritika's birthday" };
  if (md === '07-29') { const n = y - 2019; if (n >= 1) return { emoji: '💍', label: ordinal(n) + ' anniversary' }; }
  return null;
}

/* "new" badge: envelopes with notes the viewer has not opened yet (per device) */
function loadSeen() { try { return JSON.parse(localStorage.getItem('owseen') || '{}'); } catch (e) { return {}; } }
function markSeen(side, emotion) {
  const m = loadSeen(); m[side + '|' + emotion] = Date.now();
  try { localStorage.setItem('owseen', JSON.stringify(m)); } catch (e) {}
}

/* who is looking (from the sign-in): 'parv' | 'riti' | null */
function mePerson() { return (window.__parvritiUser && window.__parvritiUser.person) || null; }

/* time-capsule: a note with a future openDate stays sealed, even for its writer */
function isSealed(e) { return !e.seed && e.openDate && todayStr() < e.openDate; }
function sealCountdown(openDate) {
  const p = String(openDate).split('-'); if (p.length !== 3) return '';
  const target = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.round((target - now) / 86400000);
  if (days <= 0) return 'opens today';
  if (days === 1) return 'opens tomorrow';
  return 'opens in ' + days + ' days';
}
/* each person unseals a ripe capsule themselves (their own unwrapping moment), remembered per device */
function loadUnsealed() { try { return JSON.parse(localStorage.getItem('owunsealed') || '{}'); } catch (e) { return {}; } }
function markUnsealed(id) { const m = loadUnsealed(); m[id] = Date.now(); try { localStorage.setItem('owunsealed', JSON.stringify(m)); } catch (e) {} }
/* 'none' (not a capsule) · 'future' (still locked) · 'ripe' (date reached, not yet opened here) · 'opened' */
function capsuleState(e, unsealed) {
  if (e.seed || !e.openDate) return 'none';
  if (todayStr() < e.openDate) return 'future';
  return (unsealed && unsealed[e.id]) ? 'opened' : 'ripe';
}
function envIsLocked(env, unsealed) {
  return env.entries.length > 0 && env.entries.every(function (e) {
    const s = capsuleState(e, unsealed);
    return s === 'future' || s === 'ripe';
  });
}
function envHasRipe(env, unsealed) {
  return env.entries.some(function (e) { return capsuleState(e, unsealed) === 'ripe'; });
}
const LOCK_SVG = '<svg viewBox="0 0 24 24" class="lock-ic" aria-hidden="true"><path d="M12 1a5 5 0 0 0-5 5v4H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 9H9V6a3 3 0 0 1 6 0v4z"/></svg>';

/* "read with love" receipt */
function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? ' min ago' : ' mins ago');
  const h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.floor(h / 24); if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
  return fmtDate(new Date(ms).toISOString().slice(0, 10));
}
/* Read receipt: a note counts as "read" only when its RECIPIENT — the person
   whose tab it lives on (e.side) — opens it, never its author. So a note Parv
   wrote for Riti reads when Riti opens it; a note Riti wrote for Parv reads
   when Parv opens it. The receipt names that recipient. */
function seedReadKey(e) { return e.side + '_' + e.emotion; }
function receiptFor(e) {
  var at = null, read = false;
  if (e.seed) { var rd = seedReads[seedReadKey(e)]; if (rd) { read = true; at = rd.at; } }
  else if (e.id && e.readAt) { read = true; at = e.readAt; }
  if (!read) return '';
  var who = e.side === 'parv' ? 'Parv' : 'Riti';   // recipient of this side = the reader
  var atMs = at ? (at.seconds ? at.seconds * 1000 : (typeof at === 'number' ? at : 0)) : 0;
  var when = atMs ? ' · ' + timeAgo(atMs) : '';   // we may not know when the pre-existing ones were read
  return '<div class="ow-receipt read">💗 ' + who + ' opened this' + when + '</div>';
}
const openNotified = {};   // guard against firing twice before the snapshot lands
var loadedVoiceKey = null; // which voice clip the <audio> currently holds (so a snapshot re-render doesn't reset playback)
var envPushSent = false;   // one "opened your letter" push per envelope-open (reset on each open)
function maybeNotifyOpen(e, env) {
  if (!e || isSealed(e)) return;
  if (mePerson() !== e.side) return;             // only the RECIPIENT of this side, never the author
  var reader = mePerson(), author = reader === 'parv' ? 'riti' : 'parv';
  var guard = e.seed ? ('seed_' + seedReadKey(e)) : e.id;
  if (!guard || openNotified[guard]) return;
  if (e.seed) {
    if (seedReads[seedReadKey(e)]) return;       // already opened
    openNotified[guard] = true;
    if (db) { var patch = {}; patch[seedReadKey(e)] = { by: reader, at: Date.now() }; db.collection('openWhenReads').doc('seeds').set(patch, { merge: true }).catch(function (err) { console.warn(err); }); }
  } else {
    if (e.readAt) return;                         // first open only
    openNotified[guard] = true;
    if (db) db.collection('notes').doc(e.id).update({ readAt: serverTime(), readBy: reader }).catch(function (err) { console.warn(err); });
  }
  if (envPushSent) return;                        // read receipt is written per note above; the PUSH fires once per envelope-open so paging a stack doesn't storm the author
  envPushSent = true;
  var name = reader === 'parv' ? 'Parv' : 'Riti';
  var url = 'https://parvriti.github.io/open-when.html?open=' + encodeURIComponent(e.emotion || env.emotion || '') + '&side=' + e.side;
  if (window.parvritiNotify) window.parvritiNotify(author, name + ' opened your letter - ' + env.title + ' 💌', '', url, 'read');
}

/* "on this day, a year ago…" - surfaces past notes sharing today's month + day */
function renderOnThisDay() {
  const host = document.getElementById('owOnThisDay'); if (!host) return;
  const t = todayStr().split('-'), md = t[1] + '-' + t[2], y = parseInt(t[0], 10);
  const all = [];
  ['riti', 'parv'].forEach(function (side) {
    seedsFor(side).forEach(function (s) { all.push({ side: side, date: s.date, emotion: s.emotion, title: s.title }); });
  });
  liveNotes.forEach(function (n) { if (!isSealed(n)) all.push({ side: n.side, date: n.date, emotion: n.emotion, title: n.title }); });
  const matches = all.filter(function (e) {
    const p = String(e.date || '').split('-');
    return p.length === 3 && (p[1] + '-' + p[2]) === md && parseInt(p[0], 10) < y;
  });
  if (!matches.length) { host.style.display = 'none'; host.innerHTML = ''; return; }
  matches.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  const m = matches[0];
  const yrs = y - parseInt(m.date.split('-')[0], 10);
  const when = yrs === 1 ? 'a year ago today' : yrs + ' years ago today';
  const more = matches.length > 1 ? ' <span class="otd-more">+' + (matches.length - 1) + ' more</span>' : '';
  // the tab a note lives on is the RECIPIENT; the author is the other person. Only say
  // "you wrote" when the viewer really is that author, else name them (Pavu / Riti).
  const authorSide = m.side === 'riti' ? 'parv' : 'riti';
  const wrote = (mePerson() === authorSide) ? 'you wrote' : (authorSide === 'parv' ? 'Pavu' : 'Riti') + ' wrote';
  host.style.display = '';
  host.innerHTML = '<button type="button" class="otd-card"><div class="otd-k">🌸 On this day, ' + when + more + '</div><div class="otd-t">' + wrote + ' “' + escapeHtml(m.title) + '”</div></button>';
  host.querySelector('.otd-card').addEventListener('click', function () {
    if (currentSide !== m.side) setSide(m.side);
    var env = envelopesFor(m.side).find(function (e) { return e.emotion === m.emotion; });   // open straight to the surfaced note, not entry 0
    var idx = env ? env.entries.findIndex(function (en) { return en.date === m.date && en.title === m.title; }) : -1;
    openEnvelope(m.emotion, idx >= 0 ? idx : 0);
  });
}

let currentSide = 'riti';
/* deep link from a notification tap: open-when.html?open=<emotion>&side=<side> */
let deepOpen = null, deepSide = null;
(function () {
  try {
    var p = new URLSearchParams(location.search);
    var o = p.get('open'), s = p.get('side');
    if (o) { deepOpen = o; deepSide = (s === 'parv' || s === 'riti') ? s : null; history.replaceState(null, '', location.pathname); }
  } catch (e) {}
})();
function seedsFor(side) { return side === 'parv' ? SEED_PARV : SEED_RITI; }

/* group seeds + live notes into ordered envelopes (one per emotion) */
function envelopesFor(side) {
  const order = [], map = {};
  function ensure(emotion, emoji, title) {
    if (!map[emotion]) { map[emotion] = { emotion: emotion, emoji: emoji, title: title, entries: [] }; order.push(emotion); }
    return map[emotion];
  }
  seedsFor(side).forEach(function (s) { ensure(s.emotion, s.emoji, s.title).entries.push(Object.assign({ seed: true, side: side }, s)); });
  liveNotes.filter(function (n) { return n.side === side; }).forEach(function (n) {
    ensure(n.emotion, n.emoji, n.title).entries.push(Object.assign({}, n, { seed: false }));   // hard-force seed:false LAST so a live note's own seed:true can never flip it to raw-HTML rendering
  });
  order.forEach(function (k) {
    map[k].entries.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const at = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
      const bt = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
      return at - bt;
    });
  });
  return order.map(function (k) { return map[k]; });
}

/* =====================  grid  ===================== */
function setSide(side) {
  closeWhen();
  closeAdd();
  currentSide = side;
  document.body.classList.toggle('side-parv', side === 'parv');
  document.querySelectorAll('.ow-side').forEach(function (el) {
    el.classList.toggle('active', el.dataset.side === side);
  });
  document.getElementById('owKicker').textContent =
    side === 'parv' ? 'Written by Riti · for you' : 'Written by Pavu · for you';
  document.getElementById('owNote').textContent = '';
  buildGrid();
}

function buildGrid() {
  const grid = document.getElementById('owGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const seal = currentSide === 'parv' ? '💙' : '❤';
  const unsealed = loadUnsealed();
  envelopesFor(currentSide).forEach(function (env, i) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ow-card';
    b.style.animationDelay = (i * 0.04) + 's';
    const count = env.entries.length > 1 ? '<span class="ow-count">' + env.entries.length + '</span>' : '';
    /* ✨ = the recipient (this tab's side) hasn't opened it yet: a seed not in
       seedReads, or a live note with no readAt. */
    const isNew = env.entries.some(function (e) {
      if (isSealed(e)) return false;
      if (e.seed) return seedReadsLoaded && !seedReads[currentSide + '_' + e.emotion];   // wait for read state → no false flash
      return !e.readAt;
    });
    const newB = isNew ? '<span class="ow-new">✨</span>' : '';
    const locked = envIsLocked(env, unsealed);
    b.innerHTML = '<div class="mini-env' + (locked ? ' locked' : '') + '">' + count + newB +
      '<div class="mini-seal' + (locked ? ' locked' : '') + '">' + (locked ? LOCK_SVG : seal) + '</div></div>' +
      '<div class="ow-cap">' + escapeHtml(env.title) + '</div>';
    b.addEventListener('click', function () { openEnvelope(env.emotion); });
    grid.appendChild(b);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'ow-add-card';
  add.innerHTML = '<div class="ow-add-env">＋</div><div class="ow-cap">New envelope</div>';
  add.addEventListener('click', function () { openForm('new'); });
  grid.appendChild(add);
}

/* =====================  reader (dated stack)  ===================== */
let openEmotion = null, entryIdx = 0, owTimer = null;
function currentEnv() {
  if (!openEmotion) return null;
  return envelopesFor(currentSide).find(function (e) { return e.emotion === openEmotion; }) || null;
}

function openEnvelope(emotion, idx) {
  openEmotion = emotion;
  entryIdx = idx || 0;   // open straight to a specific note (deep links land on the newest)
  const env = currentEnv();
  if (!env) return;
  const unsealed = loadUnsealed();
  const doUnseal = envIsLocked(env, unsealed) && envHasRipe(env, unsealed);
  if (doUnseal) {
    env.entries.forEach(function (e) { if (capsuleState(e, unsealed) === 'ripe') markUnsealed(e.id); });
  }
  markSeen(currentSide, emotion);
  if (window.parvritiSetLastOpened) window.parvritiSetLastOpened(env.title);   // for the other's "last opened" line
  if (window.parvritiActivity) window.parvritiActivity('reading', env.title);   // live "reading X" presence
  buildGrid();
  if (doUnseal) playUnseal(openReaderNow);   // the lock breaks into the heart, then the letter opens
  else openReaderNow();
}

function openReaderNow() {
  envPushSent = false;   // a fresh open of this envelope may send one read-receipt push
  const reader = document.getElementById('owReader');
  const stage = document.getElementById('envStage');
  const envEl = document.getElementById('env');
  const paper = document.getElementById('owPaper');
  paper.classList.remove('show');
  stage.classList.remove('done');
  envEl.classList.remove('open');
  reader.classList.add('active');
  reader.scrollTop = 0;
  renderEntry();
  if (window.parvritiHaptic) window.parvritiHaptic();
  if (navigator.vibrate) navigator.vibrate(18);
  void envEl.offsetWidth;
  envEl.classList.add('open');
  clearTimeout(owTimer);
  owTimer = setTimeout(function () { stage.classList.add('done'); paper.classList.add('show'); }, 1520);
}

/* the unsealing ceremony: a themed lock shakes, bursts, and becomes the heart */
function playUnseal(cb) {
  const seal = currentSide === 'parv' ? '💙' : '❤';
  const ov = document.createElement('div');
  ov.className = 'ow-unseal';
  ov.innerHTML = '<div class="unseal-stage"><span class="unseal-lock">' + LOCK_SVG + '</span><span class="unseal-heart">' + seal + '</span></div>';
  document.body.appendChild(ov);
  requestAnimationFrame(function () { ov.classList.add('go'); });
  if (window.parvritiSfx) window.parvritiSfx.chime();
  if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
  setTimeout(function () {
    ov.classList.remove('go');
    if (cb) cb();
    setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 420);
  }, 1050);
}

function renderEntry() {
  const env = currentEnv();
  if (!env) return;
  if (entryIdx > env.entries.length - 1) entryIdx = env.entries.length - 1;
  if (entryIdx < 0) entryIdx = 0;
  const e = env.entries[entryIdx], total = env.entries.length;
  const sealed = isSealed(e);
  maybeNotifyOpen(e, env);   // recipient opening the other's letter → nudge its author (once)
  const pager = total > 1
    ? '<div class="ow-pager"><button type="button" class="ow-pg" data-act="prev"' + (entryIdx === 0 ? ' disabled' : '') + '>‹</button>' +
      '<span class="ow-pg-lbl">' + (entryIdx + 1) + ' of ' + total + '</span>' +
      '<button type="button" class="ow-pg" data-act="next"' + (entryIdx === total - 1 ? ' disabled' : '') + '>›</button></div>'
    : '';
  // sealed notes can be deleted (a mistaken capsule) but not edited or read early
  const editDel = !e.seed
    ? '<div class="ow-entry-actions">' + (sealed ? '' : '<button type="button" data-act="edit">edit</button><span class="sep">·</span>') + '<button type="button" data-act="delete">delete</button></div>'
    : '';
  const addHere = '<button type="button" class="ow-add-here" data-act="addhere">＋ add a note to ' + escapeHtml(env.title) + '</button>';

  let mid;
  if (sealed) {
    mid = '<div class="ow-seal-lock">🔒</div>' +
      '<div class="ow-sealed-msg">Sealed until ' + fmtDate(e.openDate) + '</div>' +
      '<div class="ow-countdown">' + sealCountdown(e.openDate) + '</div>';
  } else {
    const bodyHtml = e.seed ? e.body : escapeHtml(e.body).replace(/\n/g, '<br>');
    const voiceLbl = currentSide === 'parv' ? 'Play her voice' : 'Play his voice';
    const voiceHtml = (e.voiceFile || e.voice)
      ? '<div class="ow-voice"><button type="button" class="voice-btn" data-act="play"><span class="voice-ic">▶</span><span class="voice-lbl">' + voiceLbl + '</span></button></div>'
      : '';
    const ms = !e.seed ? milestoneTag(e.date) : null;
    const msHtml = ms ? '<div class="ow-milestone">' + ms.emoji + ' ' + ms.label + '</div>' : '';
    mid = msHtml + '<div class="ow-paper-rule"></div>' + voiceHtml +
      '<div class="ow-paper-body">' + bodyHtml + '</div>' + receiptFor(e);
  }

  document.getElementById('owPaperContent').innerHTML =
    '<div class="ow-paper-emoji">' + escapeHtml(env.emoji) + '</div>' +
    '<div class="ow-paper-title">' + escapeHtml(env.title) + '</div>' +
    '<div class="ow-paper-date">' + fmtDate(e.date) + '</div>' +
    mid + editDel + pager + addHere;

  // Only (re)load the <audio> when the clip actually changes. A Firestore snapshot echo
  // (e.g. this note's own read-receipt write) re-runs renderEntry for the SAME entry; without
  // this guard it would pause+rewind the voice note she just tapped play on.
  const a = document.getElementById('owAudio');
  const vkey = sealed ? '' : (e.voiceFile ? 'f:' + e.voiceFile : (e.voice ? 'b:' + (e.id || e.emotion) + ':' + e.date : ''));
  if (vkey !== loadedVoiceKey) {
    a.pause(); a.currentTime = 0;
    if (!sealed && e.voiceFile) a.src = e.voiceFile;
    else if (!sealed && e.voice) a.src = 'data:' + (e.voiceType || 'audio/mp4') + ';base64,' + e.voice;
    else a.removeAttribute('src');
    loadedVoiceKey = vkey;
  }
}

function closeWhen() {
  clearTimeout(owTimer);
  const a = document.getElementById('owAudio');
  if (a) a.pause();
  loadedVoiceKey = null;   // next open reloads the clip fresh (from 0)
  document.getElementById('owReader').classList.remove('active');
  document.getElementById('env').classList.remove('open');
  document.getElementById('envStage').classList.remove('done');
  document.getElementById('owPaper').classList.remove('show');
  openEmotion = null;
  if (window.parvritiActivity) window.parvritiActivity(null);   // stop showing "reading"
}

/* reader button actions (delegated) */
document.getElementById('owReader').addEventListener('click', function (ev) {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.getAttribute('data-act');
  const env = currentEnv();
  if (act === 'play') togglePlay(btn);
  else if (act === 'prev') { entryIdx--; renderEntry(); }
  else if (act === 'next') { entryIdx++; renderEntry(); }
  else if (act === 'edit' && env) openForm('edit', env.entries[entryIdx]);
  else if (act === 'delete' && env) delEntry(env.entries[entryIdx]);
  else if (act === 'addhere' && env) openForm('add', env);
});

/* swipe through the stack on mobile */
(function () {
  const paper = document.getElementById('owPaper');
  let sx = 0;
  paper.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
  paper.addEventListener('touchend', function (e) {
    const dx = e.changedTouches[0].clientX - sx;
    const env = currentEnv();
    if (!env || env.entries.length < 2 || Math.abs(dx) < 45) return;
    if (dx < 0 && entryIdx < env.entries.length - 1) { entryIdx++; renderEntry(); }
    else if (dx > 0 && entryIdx > 0) { entryIdx--; renderEntry(); }
  }, { passive: true });
})();

/* =====================  voice playback (seed clips)  ===================== */
function togglePlay(btn) {
  const a = document.getElementById('owAudio');
  const ic = btn.querySelector('.voice-ic'), lbl = btn.querySelector('.voice-lbl');
  if (a.paused) {
    a.play().then(function () { btn.classList.add('playing'); ic.textContent = '❚❚'; lbl.textContent = 'Playing…'; })
      .catch(function () { btn.classList.remove('playing'); ic.textContent = '▶'; lbl.textContent = "couldn't play, tap to try again"; });
  } else { a.pause(); }
}
(function () {
  const a = document.getElementById('owAudio');
  function reset() {
    const b = document.querySelector('#owPaperContent .voice-btn');
    if (b) { b.classList.remove('playing'); b.querySelector('.voice-ic').textContent = '▶'; b.querySelector('.voice-lbl').textContent = currentSide === 'parv' ? 'Play her voice' : 'Play his voice'; }
  }
  a.addEventListener('pause', reset);
  a.addEventListener('ended', reset);
})();

/* =====================  add / edit / delete  ===================== */
let formMode = null, formEnv = null, formEntry = null, pendingOpen = null;

function openForm(mode, ctx) {
  formMode = mode; formEnv = null; formEntry = null;
  const heading = document.getElementById('owFormHeading');
  const titleWrap = document.getElementById('owTitleWrap');
  const inTitle = document.getElementById('owInTitle');
  const inEmoji = document.getElementById('owInEmoji');
  const inBody = document.getElementById('owInBody');
  const forWho = currentSide === 'parv' ? 'for Parv' : 'for Riti';
  const sealField = document.getElementById('owSealField');
  const inOpen = document.getElementById('owInOpen');
  if (inOpen) {
    inOpen.value = '';
    var tmr = new Date(); tmr.setDate(tmr.getDate() + 1);   // only a future date seals, so block today/past in the picker (was silently ignored)
    inOpen.min = tmr.getFullYear() + '-' + ('0' + (tmr.getMonth() + 1)).slice(-2) + '-' + ('0' + tmr.getDate()).slice(-2);
  }
  document.getElementById('owFormErr').textContent = '';
  if (mode === 'new') {
    titleWrap.style.display = '';
    inTitle.value = ''; inEmoji.value = currentSide === 'parv' ? '💙' : '💌'; inBody.value = '';
    heading.textContent = 'New envelope ' + forWho;
    if (sealField) sealField.style.display = '';
    resetRecorderUI();
  } else if (mode === 'add') {
    formEnv = ctx; titleWrap.style.display = 'none'; inBody.value = '';
    heading.textContent = 'Add a note to ' + ctx.title;
    if (sealField) sealField.style.display = '';
    resetRecorderUI();
  } else if (mode === 'edit') {
    formEntry = ctx; formEnv = currentEnv(); titleWrap.style.display = 'none'; inBody.value = ctx.body || '';
    heading.textContent = 'Edit your note';
    if (sealField) sealField.style.display = 'none';
    if (ctx.voice) { recData = ctx.voice; recType = ctx.voiceType || 'audio/mp4'; showRecState('have'); document.getElementById('owRecHint').textContent = 'saved recording'; }
    else resetRecorderUI();
  }
  document.getElementById('owAddOverlay').classList.add('active');
  document.getElementById('owForm').classList.add('show');
  setTimeout(function () { inBody.focus(); }, 60);
}
function closeAdd() {
  cancelRec();   // never leave the mic running if the form is closed mid-record
  document.getElementById('owAddOverlay').classList.remove('active');
  document.getElementById('owForm').classList.remove('show');
  if (window.parvritiTyping) window.parvritiTyping(false);
}

function saveForm(ev) {
  if (ev) ev.preventDefault();
  const err = document.getElementById('owFormErr');
  const body = document.getElementById('owInBody').value.replace(/\s+$/, '');
  if (!body.trim()) { err.textContent = 'Write a few words 💛'; return false; }
  if (!db) { err.textContent = 'No connection right now, give it a second and try again.'; return false; }
  const done = function () { closeAdd(); };
  const fail = function (e) { console.warn(e); err.textContent = 'Could not save, please try again.'; };

  const voice = recData || null;
  const voiceType = recData ? recType : null;
  const openRaw = document.getElementById('owInOpen') ? document.getElementById('owInOpen').value : '';
  const openDate = (openRaw && openRaw > todayStr()) ? openRaw : null;   // only seal a future date

  // push the other person a nudge (never to yourself); a sealed capsule teases without spoiling
  const notifyRecipient = function (noteTitle, emotion) {
    const meP = mePerson();
    if (!meP || currentSide === meP || !window.parvritiNotify) return;
    const who = meP === 'parv' ? 'Parv' : 'Riti';
    const url = 'https://parvriti.github.io/open-when.html?open=' + encodeURIComponent(emotion || '') + '&side=' + currentSide;
    if (openDate) {
      window.parvritiNotify(currentSide, who + ' left you a time capsule ⏳', 'Sealed until ' + fmtDate(openDate) + '. Good things take time.', url, 'openwhen');
    } else {
      window.parvritiNotify(currentSide, who + ' left you a note 💌', noteTitle || '', url, 'openwhen');
    }
  };

  if (formMode === 'edit') {
    db.collection('notes').doc(formEntry.id).update({ body: body, voice: voice, voiceType: voiceType, editedAt: serverTime() }).then(done).catch(fail);
  } else if (formMode === 'add') {
    db.collection('notes').add({
      side: currentSide, emotion: formEnv.emotion, emoji: formEnv.emoji, title: formEnv.title,
      body: body, voice: voice, voiceType: voiceType, openDate: openDate, date: todayStr(), createdAt: serverTime(), editedAt: null
    }).then(function () { pendingOpen = formEnv.emotion; notifyRecipient(formEnv.title, formEnv.emotion); done(); }).catch(fail);   // set pendingOpen only on success, else a failed save leaves it to auto-open later
  } else {
    const title = document.getElementById('owInTitle').value.trim();
    const emoji = document.getElementById('owInEmoji').value.trim() || (currentSide === 'parv' ? '💙' : '💌');
    if (!title) { err.textContent = 'Give it a title 💛'; return false; }
    const key = newKey();
    db.collection('notes').add({
      side: currentSide, emotion: key, emoji: emoji, title: title,
      body: body, voice: voice, voiceType: voiceType, openDate: openDate, date: todayStr(), createdAt: serverTime(), editedAt: null
    }).then(function () { pendingOpen = key; notifyRecipient(title, key); done(); }).catch(fail);
  }
  return false;
}

function delEntry(entry) {
  if (!entry || entry.seed || !entry.id || !db) return;
  if (!window.confirm('Delete this note? This cannot be undone.')) return;
  db.collection('notes').doc(entry.id).delete().catch(function (e) { console.warn(e); alert("couldn't delete right now, try again"); });
}

/* =====================  live refresh  ===================== */
function onLive() {
  buildGrid();
  renderOnThisDay();
  if (!onLive._deep && deepOpen) {   // first load from a notification tap
    onLive._deep = true;
    if (deepSide && deepSide !== currentSide) setSide(deepSide);   // switch to the right tab
    pendingOpen = deepOpen; deepOpen = null;
  }
  if (pendingOpen) {
    const env = envelopesFor(currentSide).find(function (e) { return e.emotion === pendingOpen; });
    if (env) {
      const last = env.entries.length - 1;
      const readerOpen = document.getElementById('owReader').classList.contains('active');
      if (readerOpen && openEmotion === pendingOpen) { entryIdx = last; renderEntry(); }
      else { openEnvelope(pendingOpen, last); }   // opens straight to the newest note (no phantom receipt on note 0)
      pendingOpen = null;
      return;
    }
  }
  if (openEmotion) {
    const env = currentEnv();
    if (!env) closeWhen();
    else { if (entryIdx > env.entries.length - 1) entryIdx = env.entries.length - 1; renderEntry(); }
  }
}

/* Esc closes an open note or the form */
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape' && e.key !== 'Esc') return;
  if (document.getElementById('owAddOverlay').classList.contains('active')) closeAdd();
  else if (document.getElementById('owReader').classList.contains('active')) closeWhen();
});

/* =====================  voice recorder (new / edited notes)  ===================== */
let mediaRec = null, recChunks = [], recInterval = null, recSeconds = 0, recStream = null;
let recData = null, recType = null;
const REC_MAX = 60;

function fmtSec(s) { const m = Math.floor(s / 60), ss = s % 60; return m + ':' + (ss < 10 ? '0' : '') + ss; }
function showRecState(s) {
  document.getElementById('owRecIdle').style.display = s === 'idle' ? '' : 'none';
  document.getElementById('owRecActive').style.display = s === 'rec' ? '' : 'none';
  document.getElementById('owRecHave').style.display = s === 'have' ? '' : 'none';
}
function resetRecorderUI() {
  recData = null; recType = null;
  showRecState('idle');
  document.getElementById('owRecHint').textContent = '';
  document.getElementById('owRecTimer').textContent = '0:00';
}
async function startRec() {
  const hint = document.getElementById('owRecHint');
  hint.textContent = '';
  if (!navigator.mediaDevices || !window.MediaRecorder) { hint.textContent = 'Recording is not supported on this browser.'; return; }
  try { recStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { hint.textContent = 'Please allow the microphone to record.'; return; }
  recChunks = [];
  try { mediaRec = new MediaRecorder(recStream, { audioBitsPerSecond: 64000 }); }
  catch (e) { mediaRec = new MediaRecorder(recStream); }
  recType = mediaRec.mimeType || 'audio/mp4';
  mediaRec.ondataavailable = function (ev) { if (ev.data && ev.data.size) recChunks.push(ev.data); };
  mediaRec.onstop = finishRec;
  mediaRec.start();
  recSeconds = 0;
  showRecState('rec');
  document.getElementById('owRecTimer').textContent = fmtSec(0);
  recInterval = setInterval(function () {
    recSeconds++; document.getElementById('owRecTimer').textContent = fmtSec(recSeconds);
    if (recSeconds >= REC_MAX) stopRec();
  }, 1000);
}
function stopRec() {
  if (recInterval) { clearInterval(recInterval); recInterval = null; }
  if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();
  if (recStream) { recStream.getTracks().forEach(function (t) { t.stop(); }); recStream = null; }
}
/* abandon an in-progress recording (form closed): kill the mic, don't save */
function cancelRec() {
  if (recInterval) { clearInterval(recInterval); recInterval = null; }
  if (mediaRec && mediaRec.state !== 'inactive') { mediaRec.onstop = null; try { mediaRec.stop(); } catch (e) {} }
  if (recStream) { recStream.getTracks().forEach(function (t) { t.stop(); }); recStream = null; }
  mediaRec = null;
}
function finishRec() {
  const hint = document.getElementById('owRecHint');
  const blob = new Blob(recChunks, { type: recType });
  const fr = new FileReader();
  fr.onloadend = function () {
    const b64 = String(fr.result).split(',')[1] || '';
    if (b64.length > 900000) { hint.textContent = 'That clip is a bit long to save. Please keep it under ~45 seconds.'; resetRecorderUI(); return; }
    recData = b64;
    showRecState('have');
    hint.textContent = fmtSec(recSeconds) + ' recorded';
  };
  fr.readAsDataURL(blob);
}
function playRec() {
  if (!recData) return;
  const a = document.getElementById('owRecAudio');
  a.src = 'data:' + (recType || 'audio/mp4') + ';base64,' + recData;
  a.play();
}
(function () {
  const start = document.getElementById('owRecStart');
  if (!start) return;
  start.addEventListener('click', startRec);
  document.getElementById('owRecStop').addEventListener('click', stopRec);
  document.getElementById('owRecPlay').addEventListener('click', playRec);
  document.getElementById('owRecRedo').addEventListener('click', function () { resetRecorderUI(); startRec(); });
  document.getElementById('owRecDel').addEventListener('click', resetRecorderUI);
})();

/* toggle the Riti / Parv side */
document.querySelectorAll('.ow-side').forEach(function (el) {
  el.addEventListener('click', function () { setSide(el.dataset.side); });
});

/* edit mode: author controls (add / edit / delete / new envelope) only
   appear while this is on, so the default is a pristine reading experience */
document.getElementById('owEditToggle').addEventListener('click', function () {
  const on = document.body.classList.toggle('editing');
  this.classList.toggle('on', on);
  this.textContent = on ? '📖 Read' : '✎ Edit';
});

/* typing shimmer: let the other person feel you writing them something */
(function () {
  const ta = document.getElementById('owInBody');
  if (!ta) return;
  const fire = function () { if (window.parvritiTyping) window.parvritiTyping(true); };
  ta.addEventListener('input', fire);
  ta.addEventListener('focus', fire);
  ta.addEventListener('blur', function () { if (window.parvritiTyping) window.parvritiTyping(false); });
})();

buildGrid();
renderOnThisDay();
