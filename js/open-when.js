/* =====================================================================
   open-when.js — the "Open When…" collection (open-when.html)
     Builds the grid of sealed envelopes, opens one into a parchment
     letter with an envelope animation, and plays a per-note voice clip.

   To edit: change the text below. Each note's voice defaults to
   voice/<key>.m4a — drop a recording there (same name) to replace the
   placeholder, or add an `audio:` field to point somewhere else.
   ===================================================================== */

const OPEN_WHEN = [
  { key:'miss', emoji:'💌', cap:'Open when you miss me',
    title:'When you miss me',
    body:`Meri Toti,<br><br>
Agar tu ye padh rahi hai, matlab abhi main tere paas nahi hoon — aur mujhe pehle se pata hai, main bhi tujhe utna hi miss kar raha hounga.<br><br>
Aankhein band kar ek second. Main yahin hoon. Wahi haath jo tere baalon mein chalte hain, wahi seene pe teri jagah, wahi "good morning totijaan". Sab tera hai, chahe main kitni bhi door hoon.<br><br>
Distance sirf kilometre hai, jaan. Mera pura din tere hi aas-paas ghoomta rehta hai.<br><br>
Ab paani pi, ek lambi saans le, aur yaad rakh — main laut ke aa raha hoon. Hamesha aata hoon. Tere paas hi toh aana hai.
<span class="ow-paper-sig">— Tera Pavu 💕</span>` },

  { key:'horny', emoji:'🔥', cap:"Open when you're needy for me",
    title:"When you're needy for me",
    body:`Toti… itni buri ladki ho tum.<br><br>
Matlab abhi tu apne pati ko soch rahi hai, hmm? Achha kar rahi ho — tera hi toh haq hai mujh pe.<br><br>
Aankhein band kar. Socho main peeche se aaya, tera gala halke se pakda, kaan mein dheere se poocha — "meri ho na tum?" Aur tu already pighalne lagi.<br><br>
Main jaanta hoon tujhe kaise chahiye — thoda rough, thoda slow, aur poora poora mera. Aaj bas meri hoke wait kar. Jab main aaunga na, tujhe achhe se yaad dilaunga ki tu kiski hai.<br><br>
Tab tak achhi ladki ban ke rehna. Sirf mere liye.
<span class="ow-paper-sig">— Tera Pavu 🔥</span>` },

  { key:'sad', emoji:'🤍', cap:"Open when you're crying",
    title:"When you're crying",
    body:`Meri jaan, aa idhar.<br><br>
Sabse pehle ye — jo bhi ho raha hai, tu akeli nahi hai. Main hoon. Poora hoon.<br><br>
Ro le agar rona hai. Main tere aansu pochne ke liye hi toh banaya gaya hoon. Mere saamne "strong" banne ki koi zaroorat nahi.<br><br>
Ek kaam kar — teen baar gehri saans le. Andar… bahar. Imagine kar main tere saath saans le raha hoon.<br><br>
Ye feeling permanent nahi hai, jaan. Bas ek phase hai, aur main iske aar-paar tere saath khada hoon. Tujhe kuch nahi hone dunga.<br><br>
I love you. Aur abhi ke abhi tujhe seene se laga lena chahta hoon.
<span class="ow-paper-sig">— Tera Pavu 🤍</span>` },

  { key:'mad', emoji:'😤', cap:"Open when you're mad at me",
    title:"When you're mad at me",
    body:`Haan, mujhe pata hai. Maine kuch kiya hoga, ya kaha hoga, ya woh nahi kiya jo karna chahiye tha.<br><br>
Toti, tu naaraz ho — poora haq hai tera. Main tera gussa deserve karta hoon, aur main bhaagunga nahi.<br><br>
Bas itna yaad rakhna: main tere against kabhi nahi hoon, chahe hum kitna bhi lad lein. Tu meri team hai, meri opponent nahi.<br><br>
Jab thodi shaant ho jaaye, mujhse baat karna. Chilla lena mujh pe agar chahiye — main sunuga, poora sunuga.<br><br>
Aur phir main tujhe manaunga, jitni baar manana pade. Kyunki tere bina ka ek din bhi mujhe manzoor nahi.<br><br>
Sorry, meri jaan. Main behtar karunga.
<span class="ow-paper-sig">— Tera Pavu</span>` },

  { key:'sleep', emoji:'🌙', cap:"Open when you can't sleep",
    title:"When you can't sleep",
    body:`Ssshh. Ab phone neeche rakhne wali ho tum.<br><br>
Aankhein band. Main tere saath let raha hoon, tera sar apne seene pe rakh raha hoon. Sunn — meri dhadkan. Ussi ke saath saans le.<br><br>
Andar… ek… do… teen… chaar. Bahar… ek… do… teen… chaar. Bas aise hi, dheere dheere.<br><br>
Kal ki tension kal dekhenge, jaan. Abhi bas ye raat hai, aur main tujhe hold kar raha hoon.<br><br>
Tu safe hai. Tu meri ho. So ja meri totijaan.<br><br>
Good night, meri jaan. Sapno mein bhi tere paas hi hoon.
<span class="ow-paper-sig">— Tera Pavu 🌙</span>` },

  { key:'insecure', emoji:'💖', cap:"Open when you feel not-enough",
    title:"When you feel not-enough",
    body:`Ruk. Sheeshe ke saamne jaa, aur meri aankhon se khud ko dekh.<br><br>
Toti, tu koi "kaafi hoon ya nahi" waala sawaal nahi ho. Tu jawab ho — mere har sawaal ka.<br><br>
Jo tujhe apni khaami lagti hai na, main aksar ussi ko sabse zyada pyaar karta hoon. Teri hasi, teri chaal, tere sochne ka tareeka, tera thoda sa pagalpan — sab.<br><br>
Duniya kuch bhi bole. Mere liye tu sabse khoobsurat thi, hai, aur rahegi. Ye compliment nahi, seedha fact hai.<br><br>
Tu meri wife ho. Main lucky hoon. Aur ye main roz sochta hoon.
<span class="ow-paper-sig">— Tera Pavu 💖</span>` },

  { key:'owned', emoji:'🎀', cap:'Open when you want to feel mine',
    title:'When you want to feel mine',
    body:`Meri achhi ladki.<br><br>
Tu jaanti hai na tu kiski ho? Bol — kiski ho tum?<br><br>
Sar se paer tak, andar se bahar tak — har inch teri meri hai. Aur main poora tera.<br><br>
Aaj bas mere hone ka feel kar. Meri koi shirt pehen le, wahi jo mujhse smell karti hai. Meri hoke reh thodi der.<br><br>
Jab main aaunga na, main tujhe khud yaad dilaunga — dheere dheere, aaram se. Tab tak achhi ladki ban ke wait kar.<br><br>
Good girl. Meri hi rehna.
<span class="ow-paper-sig">— Tera Pavu 🎀</span>` },

  { key:'smile', emoji:'🌸', cap:'Open when you need to smile',
    title:'When you need to smile',
    body:`Oye Toti. Haan tujhe hi bol raha hoon. Muskura zara.<br><br>
Yaad hai tu kaise naak sikodti hai jab zor se hasti hai? Main abhi wahi soch ke smile kar raha hoon.<br><br>
Tu is puri duniya mein meri favourite jagah hai. Meri favourite awaaz. Mera favourite pareshaan karne waala insaan. 😌<br><br>
Bas itna sun le: tu is universe ki sabse cute, sabse pagal, sabse meri ladki ho. Aur main har roz tujhe choose karta hoon — aankh band karke.<br><br>
Ab ja, ek selfie bhej mujhe. Order hai. 📸
<span class="ow-paper-sig">— Tera Pavu 🌸</span>` },

  { key:'wake', emoji:'🌅', cap:'Open when you wake up',
    title:'When you wake up',
    body:`Good morning, meri totijaan. 🌅<br><br>
Haan tujhe hi. Aankhein malte hue, baalon ka woh haal — aur phir bhi meri favourite tasveer.<br><br>
Aaj ka din tere liye thoda aur soft ho. Chai garam ho, dhoop halki ho, aur tu yaad rakhna ki koi tujhe subah se raat tak beintehaa pyaar karta hai.<br><br>
Kuch bhi ho aaj, main tere corner mein hoon. Jeet aaye toh saath, thak jaaye toh bhi saath.<br><br>
Ja, duniya ko dikha de aaj tu kya cheez hai. Aur haan — nashta zaroor karna, warna daantunga. 😌
<span class="ow-paper-sig">— Tera Pavu 🌅</span>` },

  { key:'stressed', emoji:'🌊', cap:"Open when it's all too much",
    title:"When it's all too much",
    body:`Ruk, jaan. Ek second. Saans.<br><br>
Sab kuch ek saath karne ki zaroorat nahi hai. Duniya do minute ruk le, kuch nahi girega.<br><br>
Ek kaam kar — jo cheez sabse zyada bhaari lag rahi hai, sirf ussi ka pehla chhota sa step soch. Bas ek. Baaki baad mein.<br><br>
Aur agar phir bhi zyada ho, toh mujhe call kar. Main sab drop karke sununga. Tera load thoda mera bhi hai.<br><br>
Tu bahut strong hai, meri jaan — par mere saamne strong banne ki zaroorat nahi. Tik lag ja mujh pe thodi der.
<span class="ow-paper-sig">— Tera Pavu 🌊</span>` },

  { key:'period', emoji:'🩷', cap:"Open when your body's fighting you",
    title:"When your body's fighting you",
    body:`Aa, idhar aa. Garam paani wali bottle le li? Nahi? Ja pehle — main wait karta hoon.<br><br>
Meri jaan, aaj tera body thoda zyada maang raha hai — rest, kuch meetha, aur bilkul bhi guilt nahi.<br><br>
Chidchidi ho toh ho ja. Rona ho toh ro le. Kuch mangna ho toh mang le — main na nahi bolta tujhe, aaj toh bilkul nahi.<br><br>
Kaash abhi main hota — tera pet dabata, baal sahlata, aur tujhe kuch karne hi nahi deta.<br><br>
Aaram kar, meri totijaan. Tu is time bhi utni hi khoobsurat hai. Sach mein.
<span class="ow-paper-sig">— Tera Pavu 🩷</span>` },

  { key:'forever', emoji:'💍', cap:'Open when you doubt us',
    title:'When you doubt us',
    body:`Agar kabhi ek pal ke liye bhi lage ki "kya hum forever hain?" — toh ye padh.<br><br>
Haan. Hum forever hain. Ye koi mood ya phase nahi, ye faisla hai — jo main roz, poore hosh mein, dobara leta hoon.<br><br>
Ladenge, roothenge, thakenge — par main jaa nahi raha kahin. Tu meri aadat nahi, tu meri choice hai. Har baar.<br><br>
Har universe mein maine tujhe hi dhoonda hoga, aur is waale mein tu mil gayi. Main isse zyada lucky aur kya hi hounga.<br><br>
Bas mere paas rehna, Toti. Baaki sab main sambhaal lunga.
<span class="ow-paper-sig">— Tera Pavu 💍</span>` }
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
  document.getElementById('owPaperBody').innerHTML = l.body;

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
