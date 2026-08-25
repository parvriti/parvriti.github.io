/* =====================================================================
   push-worker — a tiny Cloudflare Worker that sends a push notification
   to the OTHER person's devices.

   It is the one piece that has to live on a server, because a phone can
   only receive a push, never send one directly (Google shut the client
   path down in 2024). Nothing here is secret in the code itself; the
   secrets are set as Worker variables (see push-worker/README.md).

   Flow when the site calls POST <worker-url>:
     1. Verify the caller is one of the three allowed accounts (their
        Firebase ID token, checked with Google).
     2. Mint a short-lived Google access token from the service account.
     3. Look up the recipient's device tokens in Firestore.
     4. Send each one an FCM push; prune any that have died.

   Secrets / vars to set (dashboard → Settings → Variables, or wrangler):
     SERVICE_ACCOUNT  (secret) = the whole Firebase service-account JSON
     FIREBASE_API_KEY (var)    = the public web API key (used to verify callers)
   ===================================================================== */

const PROJECT_ID = 'parvriti';
const ALLOWED = ['parvbajaj2000@gmail.com', 'aritika2000@gmail.com', 'parvbajaj2480@gmail.com'];
const SITE = 'https://parvriti.github.io';
const CORS = {
  'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const path = new URL(request.url).pathname;
    // "Arrive home" iPhone automations hit this; auth is a per-person secret,
    // NOT a Firebase token, because a Shortcut cannot mint one.
    if (path === '/automation/home') return handleHomeArrival(request, env);
    // everything else is the site's own "send a push to the other person" call.
    return handlePush(request, env);
  },

  /* Two Cron Triggers:
       "30 18 * * *" = 00:00 IST -> birthday / anniversary wish to BOTH phones.
       "30 3 * * *"  = 09:00 IST -> cycle heads-up (upcoming period + phase changes),
                                    per person, gated on their own Periods visibility.
     Add the 09:00 trigger in Cloudflare (Workers -> the worker -> Triggers -> Cron)
     the same way the midnight one was added. Until it exists, cycle nudges never run. */
  async scheduled(event, env, ctx) {
    if (event.cron === '30 3 * * *') ctx.waitUntil(runCycleNudges(event, env));
    else ctx.waitUntil(runCelebration(event, env));
  }
};

/* ══════════════ the site's push (caller proven by their Firebase ID token) ══════════════ */
async function handlePush(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const to = body && body.to;
  const title = body && body.title;
  const text = (body && body.body) || '';
  let link = (body && body.url) || (SITE + '/open-when.html');
  // a notification tap must only ever open our own origin. Accept exactly SITE or SITE + '/...'
  // (the trailing-slash check blocks a look-alike like https://parvriti.github.io.evil.com).
  if (typeof link !== 'string' || (link !== SITE && link.indexOf(SITE + '/') !== 0)) link = SITE + '/open-when.html';
  if (!to || !title) return json({ error: 'missing to/title' }, 400);

  // 1) the caller must be one of us
  const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!idToken) return json({ error: 'no token' }, 401);
  const v = await verifyCaller(idToken, env.FIREBASE_API_KEY);
  if (!v.email) return json({ error: 'verify', detail: v.detail }, 403);
  if (ALLOWED.indexOf(v.email.toLowerCase()) === -1) return json({ error: 'notallowed', email: v.email }, 403);

  // 2) service-account access token
  let sa;
  try { sa = JSON.parse(env.SERVICE_ACCOUNT); } catch (e) { return json({ error: 'no service account' }, 500); }
  const accessToken = await getAccessToken(sa);
  if (!accessToken) return json({ error: 'auth failed' }, 500);

  // 2b) respect the recipient's per-type toggle + the master mute (Settings matrix)
  const type = body && body.type;
  const gate = await getNotif(accessToken);
  if (gate.muteAll) { console.log('push: muted-all'); return json({ ok: true, muted: 'all' }); }
  if (type && gate.n['n_' + type + '_' + to] === false) { console.log('push: ' + type + '->' + to + ' opted out'); return json({ ok: true, muted: type }); }

  // 3) recipient device tokens
  const devices = await getTokens(to, accessToken);
  if (!devices.length) return json({ ok: true, sent: 0 });

  // 4) send; prune ONLY tokens FCM says are dead (never on a transient error)
  let sent = 0;
  for (const d of devices) {
    const res = await sendPush(accessToken, d.token, title, text, link);
    if (res.ok) sent++;
    else if (res.dead) await deleteDoc(d.name, accessToken);
  }
  return json({ ok: true, sent });
}

/* ══════════════ "got home safe" (POST /automation/home) ══════════════
   An iPhone "Arrive" automation calls this when Riti or Parv reaches one of
   their homes. WHO arrived is decided ONLY by which secret matched, so a
   client cannot spoof identity with a body field. The Shortcut also sends a
   coarse { "home": "parv-gurugram" | "parv-rohtak" | "riti-noida" | "riti-gurugram" }
   label (unique per place, so the two Gurugram homes never collide) — never
   coordinates — used only to answer "are we together?" (same place, both
   present) and never put in the notification.

   Default rule is "apart, one per day":
     • this arrival puts you TOGETHER (partner's last arrival is the SAME place,
       recent, and after their last leave) -> stay silent, you're in the same
       room. A stale partner arrival is treated as unknown and DOES ping — a
       redundant ping beats a missed one;
     • otherwise -> notify, but at most the FIRST arrival per IST day, so a
       daytime travel arrival still pings while errand in/out doesn't spam.
   The rule ('always'|'apart'|'evening'|'off'), the one-per-day flag, an evening
   cutoff hour, the "together" freshness window, and per-home mutes are all read
   live from settings/app, so the
   admin Settings page can retune this with no redeploy. Repeated geofence fires
   within DEDUP_MS are swallowed as bounces. Nothing is stored beyond the coarse
   current-home label used for the together-check. */
const DEDUP_MS = 10 * 60 * 1000;   // 10 minutes
/* Unique per-place labels, so his Gurugram and her Gurugram never collide (both
   sending bare "gurugram" used to read as "together" when they were actually
   apart). Each phone's Arrive automation sends the label for the place it fires
   at. The two shared spots — parv-gurugram and riti-noida — have an automation
   on BOTH phones, which is the ONLY way the worker can ever know you're together
   there. A place unknown to the sender is dropped. */
const HOMES = {
  parv: ['parv-gurugram', 'parv-rohtak', 'riti-noida'],
  riti: ['riti-noida', 'riti-gurugram', 'parv-gurugram']
};

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* everything in Asia/Kolkata (UTC+5:30); Workers run in UTC. */
function istShift(ms) { return new Date(ms + 5.5 * 3600 * 1000); }
function istDay(ms) { const d = istShift(ms); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
function istHour(ms) { return istShift(ms).getUTCHours(); }
function fval(v) {
  if (!v) return undefined;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('stringValue' in v) return v.stringValue;
  if ('doubleValue' in v) return v.doubleValue;
  return undefined;
}

/* live home-safe config from settings/app (flat fields), with safe defaults so
   the feature works fully before the Settings page ever writes the doc. */
async function getHomeCfg(accessToken) {
  const d = {
    enabled: true, rule: 'apart', onePerDay: true, afterHour: 18, togetherHrs: 6,
    homes: { 'riti-noida': true, 'riti-gurugram': true, 'parv-rohtak': true, 'parv-gurugram': true },
    muteAll: false, nHome: { riti: true, parv: true }
  };
  try {
    const r = await fetch(DOCS + '/settings/app', { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!r.ok) return d;
    const f = (await r.json()).fields || {};
    if ('hsEnabled' in f) d.enabled = fval(f.hsEnabled) !== false;
    if ('hsRule' in f) d.rule = fval(f.hsRule) || d.rule;
    if ('hsOnePerDay' in f) d.onePerDay = fval(f.hsOnePerDay) !== false;
    if ('hsAfterHour' in f) { const v = fval(f.hsAfterHour); if (typeof v === 'number' && v >= 0 && v <= 23) d.afterHour = v; }
    if ('hsTogetherHrs' in f) d.togetherHrs = fval(f.hsTogetherHrs) || d.togetherHrs;
    const map = { hsHomeRitiNoida: 'riti-noida', hsHomeRitiGurugram: 'riti-gurugram', hsHomeParvRohtak: 'parv-rohtak', hsHomeParvGurugram: 'parv-gurugram' };
    for (const k in map) if (k in f) d.homes[map[k]] = fval(f[k]) !== false;
    d.muteAll = fval(f.muteAll) === true;
    if ('n_home_riti' in f) d.nHome.riti = fval(f.n_home_riti) !== false;
    if ('n_home_parv' in f) d.nHome.parv = fval(f.n_home_parv) !== false;
  } catch (e) {}
  return d;
}

/* the site's per-type notification gate (Settings matrix). n_<type>_<recipient>
   booleans + a master muteAll. Absent key = allowed (on by default). */
async function getNotif(accessToken) {
  const d = { muteAll: false, n: {} };
  try {
    const r = await fetch(DOCS + '/settings/app', { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!r.ok) return d;
    const f = (await r.json()).fields || {};
    d.muteAll = fval(f.muteAll) === true;
    for (const k in f) if (k.indexOf('n_') === 0) d.n[k] = fval(f[k]);
  } catch (e) {}
  return d;
}

async function handleHomeArrival(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const secret = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!secret) { console.log('home: missing key'); return json({ error: 'unauthorized' }, 401); }

  // identity is derived from the secret alone
  let sender = null;
  if (timingSafeEqual(secret, env.HOME_SECRET_RITI || '')) sender = 'riti';
  else if (timingSafeEqual(secret, env.HOME_SECRET_PARV || '')) sender = 'parv';
  if (!sender) { console.log('home: bad key'); return json({ error: 'unauthorized' }, 401); }

  const recipient = sender === 'riti' ? 'parv' : 'riti';
  const title = (sender === 'riti' ? 'Riti' : 'Parv') + ' got home safe 🏡';

  // coarse home label from the body + optional event ('arrive' default, or
  // 'leave' from the silent Leave automations). Read the body once.
  let home = '', event = 'arrive';
  try {
    const b = await request.json();
    if (b) {
      if (typeof b.home === 'string') home = b.home.toLowerCase().trim();
      if (typeof b.event === 'string') event = b.event.toLowerCase().trim();
    }
  } catch (e) {}
  if (home && HOMES[sender].indexOf(home) === -1) home = '';

  let sa;
  try { sa = JSON.parse(env.SERVICE_ACCOUNT); } catch (e) { console.log('home: no service account'); return json({ error: 'server' }, 500); }
  const accessToken = await getAccessToken(sa);
  if (!accessToken) { console.log('home: no access token'); return json({ error: 'server' }, 500); }

  const now = Date.now();

  // "leave" is silent: it only flips the home/away state for the ambient line.
  if (event === 'leave') {
    await setHomeState(sender, false, now, accessToken);
    await setArrival(sender, { leftAt: now }, accessToken);
    await setTogether(false, now, accessToken);   // leaving anywhere ends "together"
    console.log('home: ' + sender + ' left ' + (home || '?'));
    return json({ ok: true, left: true });
  }

  const cfg = await getHomeCfg(accessToken);
  const state = await getArrival(sender, accessToken);

  // swallow geofence double-fires; keep current-home fresh
  if (state.at && (now - state.at) < DEDUP_MS) {
    if (home && home !== state.home) await setArrival(sender, { at: now, home: home }, accessToken);
    console.log('home: ' + sender + ' deduped bounce');
    return json({ ok: true, deduped: true });
  }
  // record the arrival (time + current home) whether or not we notify
  await setArrival(sender, home ? { at: now, home: home } : { at: now }, accessToken);
  await setHomeState(sender, true, now, accessToken);   // for the optional home/away line

  // Are we together? True only when the partner's last arrival is the SAME place,
  // they arrived MORE recently than they left, and recently enough to trust
  // (iOS Leave automations are unreliable, so a stale arrival is not proof).
  // Because a place label is globally unique, this can only ever be true at a
  // spot BOTH phones have a geofence for (parv-gurugram, riti-noida).
  let together = false;
  if (home) {
    const partner = await getArrival(recipient, accessToken);
    const freshMs = (cfg.togetherHrs || 6) * 3600 * 1000;
    if (partner.home === home && partner.at > (partner.leftAt || 0) && (now - partner.at) < freshMs) together = true;
  }
  await setTogether(together, now, accessToken);   // drives the "Together right now" line for both

  // Settings matrix: master mute + this recipient's "got home safe" toggle
  if (cfg.muteAll) { console.log('home: muted-all'); return json({ ok: true, muted: 'all' }); }
  if (!cfg.nHome[recipient]) { console.log('home: ' + recipient + ' opted out'); return json({ ok: true, muted: 'recipient' }); }
  if (!cfg.enabled || cfg.rule === 'off') { console.log('home: off'); return json({ ok: true, muted: 'off' }); }
  if (home && cfg.homes[home] === false) { console.log('home: ' + home + ' muted'); return json({ ok: true, muted: 'home' }); }

  // "apart" rule: if this arrival puts you together, stay silent — no point
  // announcing "got home safe" to someone already in the same room.
  if (cfg.rule === 'apart' && together) {
    console.log('home: together at ' + home + ', silent');
    return json({ ok: true, muted: 'together' });
  }
  // "evening" — only after the cutoff hour
  if (cfg.rule === 'evening' && istHour(now) < cfg.afterHour) { console.log('home: before ' + cfg.afterHour + ':00 IST'); return json({ ok: true, muted: 'early' }); }
  // at most one ping per IST day
  if (cfg.onePerDay && state.sentDay === istDay(now)) { console.log('home: already sent today'); return json({ ok: true, muted: 'already-today' }); }

  const devices = await getTokens(recipient, accessToken);
  const link = SITE + '/index.html?moment=home&who=' + sender;   // tap -> Home plays the "got home safe" animation
  let sent = 0;
  for (const d of devices) {
    const res = await sendPush(accessToken, d.token, title, '', link);
    if (res.ok) sent++;
    else if (res.dead) await deleteDoc(d.name, accessToken);
  }
  if (sent > 0 && cfg.onePerDay) await setArrival(sender, { sentDay: istDay(now) }, accessToken);
  console.log('home: ' + sender + '(' + (home || '?') + ') -> ' + recipient + ' sent ' + sent + '/' + devices.length);
  return json({ ok: true, sent });
}

/* homeArrivals/<person>: { at (ms), home (coarse label), sentDay (IST date) }.
   No coordinates, ever. Written by the service account, so no client rule is
   needed (the app never touches this collection). */
async function getArrival(person, accessToken) {
  try {
    const r = await fetch(DOCS + '/homeArrivals/' + person, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!r.ok) return { at: 0, home: '', sentDay: '' };
    const f = (await r.json()).fields || {};
    return {
      at: f.at && f.at.integerValue ? parseInt(f.at.integerValue, 10) : 0,
      home: f.home && f.home.stringValue ? f.home.stringValue : '',
      sentDay: f.sentDay && f.sentDay.stringValue ? f.sentDay.stringValue : '',
      leftAt: f.leftAt && f.leftAt.integerValue ? parseInt(f.leftAt.integerValue, 10) : 0
    };
  } catch (e) { return { at: 0, home: '', sentDay: '', leftAt: 0 }; }
}
async function setArrival(person, obj, accessToken) {
  try {
    const fields = {}, mask = [];
    if ('at' in obj) { fields.at = { integerValue: String(obj.at) }; mask.push('at'); }
    if ('home' in obj) { fields.home = { stringValue: obj.home }; mask.push('home'); }
    if ('sentDay' in obj) { fields.sentDay = { stringValue: obj.sentDay }; mask.push('sentDay'); }
    if ('leftAt' in obj) { fields.leftAt = { integerValue: String(obj.leftAt) }; mask.push('leftAt'); }
    if (!mask.length) return;
    const q = mask.map(function (m) { return 'updateMask.fieldPaths=' + m; }).join('&');
    await fetch(DOCS + '/homeArrivals/' + person + '?' + q, {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: fields })
    });
  } catch (e) {}
}

/* homeState/<person> = { atHome, since } — the ONLY home data the app reads (via
   a read-only rule). Just a boolean + timestamp, never a location. Written here
   on every arrive (true) and leave (false). */
async function setHomeState(person, atHome, ms, accessToken) {
  try {
    await fetch(DOCS + '/homeState/' + person + '?updateMask.fieldPaths=atHome&updateMask.fieldPaths=since', {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { atHome: { booleanValue: !!atHome }, since: { integerValue: String(ms) } } })
    });
  } catch (e) {}
}

/* homeState/together = { together, since } — a shared boolean (never a location)
   that BOTH apps read to show the "Together right now" line. Written true on an
   arrival that puts you at the same place as your partner, false on every leave
   and on any arrival that does not. The same read-only /homeState rule covers it. */
async function setTogether(on, ms, accessToken) {
  try {
    await fetch(DOCS + '/homeState/together?updateMask.fieldPaths=together&updateMask.fieldPaths=since', {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { together: { booleanValue: !!on }, since: { integerValue: String(ms) } } })
    });
  } catch (e) {}
}

/* ══════════════ midnight birthday / anniversary push ══════════════ */
function pad2(n) { return (n < 10 ? '0' : '') + n; }

function celebrationTitle(event) {
  var when = (event && event.scheduledTime) ? event.scheduledTime : Date.now();
  var ist = new Date(when + 5.5 * 3600 * 1000);   // shift so UTC getters read IST wall-clock
  var y = ist.getUTCFullYear();
  var md = pad2(ist.getUTCMonth() + 1) + '-' + pad2(ist.getUTCDate());
  if (md === '04-20') return { id: 'riti-' + y, title: 'Happy Riti Day 🎂❤️' };
  if (md === '12-10') return { id: 'parv-' + y, title: 'Happy Pavu Day 🎂❤️' };
  if (md === '07-29') return { id: 'anniv-' + y, title: 'Happy ' + (y - 2019) + ' years, my love 🐣' };
  return null;
}

async function runCelebration(event, env) {
  const occ = celebrationTitle(event);
  if (!occ) return;                                 // nothing to celebrate today
  let sa;
  try { sa = JSON.parse(env.SERVICE_ACCOUNT); } catch (e) { return; }
  const accessToken = await getAccessToken(sa);
  if (!accessToken) return;
  if (await celebrationDone(occ.id, accessToken)) return;   // never send the same one twice
  const devices = (await getTokens('parv', accessToken)).concat(await getTokens('riti', accessToken));
  for (const d of devices) {
    const res = await sendPush(accessToken, d.token, occ.title, '', SITE + '/index.html?moment=celebrate');   // tap -> Home shows the takeover
    if (!res.ok && res.dead) await deleteDoc(d.name, accessToken);
  }
  await celebrationMark(occ.id, accessToken);
}

async function celebrationDone(id, accessToken) {
  try {
    const r = await fetch(DOCS + '/celebrations/' + id, { headers: { Authorization: 'Bearer ' + accessToken } });
    return r.ok;   // 200 = the doc exists = already sent today
  } catch (e) { return false; }   // on error, better to allow the wish than skip it
}
async function celebrationMark(id, accessToken) {
  try {
    await fetch(DOCS + '/celebrations?documentId=' + encodeURIComponent(id), {
      method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { at: { integerValue: String(Date.now()) } } })
    });
  } catch (e) {}
}

/* ══════════════ cycle heads-up (upcoming period + phase changes) ══════════════
   Runs at 09:00 IST. Rebuilds her cycle day, the predicted period window, and the
   current phase server-side from settings/app + the latest logged period (the same
   model periods.js draws on-screen). For EACH person it is gated on THEIR OWN Periods
   visibility (Parv sees Periods by default; Riti only if she turned it on) plus their
   own toggles — all OFF by default — plus the master mute. At most one period heads-up
   per cycle and one note per phase per cycle (a cycleNudges marker guards repeats).
   Tapping opens straight to the Periods tab. No location; nothing stored but the marker. */
const CY_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];   // 'Sep' to match periods.js SHORTM (the app the notification opens)
function isoToMs(iso) { const p = String(iso).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function isoAdd(iso, n) { const d = new Date(isoToMs(iso) + n * 86400000); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
function isoDiff(a, b) { return Math.round((isoToMs(b) - isoToMs(a)) / 86400000); }
function cyFmt(iso) { const p = String(iso).split('-'); return (+p[2]) + ' ' + CY_MON[+p[1] - 1]; }

/* the same phase boundaries periods.js derives from EXPECT. Only the five real phases
   are ever notified; due/late/overdue collapse to 'due' (not in the notify set). */
function cyPhase(day, len, expect) {
  const RANGE = 2, open = expect - RANGE, ov = expect - 14;
  const fFrom = Math.max(len + 1, ov - 3), fTo = Math.max(fFrom, ov + 3);
  if (day <= len) return 'menstrual';
  if (day < fFrom) return 'follicular';
  if (day <= fTo) return 'fertile';
  if (day < open - 2) return 'luteal';
  if (day < open) return 'pms';
  return 'due';
}
/* the four phases detected by a day-to-day transition. Menstrual is handled separately
   below (it is not a "transition" — day 1's previous day is also menstrual): it fires
   once per cycle on the first 9am tick where the period is logged and still ongoing, so
   it lands whether the drop was tapped before or after 9am (the copy says "has started"
   rather than "today", so it reads right on day 1 or day 2). */
const CY_NOTIFY = { follicular: 1, fertile: 1, luteal: 1, pms: 1 };

/* recipient-aware, purely informative copy (agreed with Parv: no advice, no poetry). */
function cyPhaseMsg(recipient, phase, day) {
  const Her = recipient === 'parv' ? 'Her' : 'Your';
  const poss = recipient === 'parv' ? 'her' : 'your';
  if (phase === 'menstrual') return { title: Her + ' period has started 🌊', body: 'Cycle day ' + day + '. A new cycle begins.' };
  if (phase === 'follicular') return { title: 'Follicular phase started 🌱', body: 'Cycle day ' + day + '. Post-period, before ovulation.' };
  if (phase === 'fertile') return { title: 'Fertile window started ☀️', body: 'Cycle day ' + day + '. ' + Her + ' most fertile days (ovulation).' };
  if (phase === 'luteal') return { title: 'Luteal phase started 🌙', body: 'Cycle day ' + day + '. After ovulation, before ' + poss + ' period.' };
  return { title: 'PMS phase started 💜', body: 'Cycle day ' + day + '. The final stretch before ' + poss + ' period.' };
}
function cyPeriodMsg(recipient, lead, openIso, closeIso) {
  const Her = recipient === 'parv' ? 'Her' : 'Your';
  const title = lead === 0
    ? Her + ' period window opens today 💗'
    : Her + ' period is about ' + lead + (lead === 1 ? ' day' : ' days') + ' away 💗';
  return { title: title, body: 'Predicted window: ' + cyFmt(openIso) + ' to ' + cyFmt(closeIso) + '.' };
}

/* per-person cycle config from settings/app. Visibility defaults match the app:
   Parv sees Periods unless turned off; Riti only if turned on. All toggles OFF. */
async function getCycleCfg(accessToken) {
  const d = {
    muteAll: false, cyLen: 31,
    vis: { parv: true, riti: false },
    period: { parv: false, riti: false },
    phase: { parv: false, riti: false },
    lead: 2
  };
  try {
    const r = await fetch(DOCS + '/settings/app', { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!r.ok) return d;
    const f = (await r.json()).fields || {};
    d.muteAll = fval(f.muteAll) === true;
    if ('cyLen' in f) { const v = fval(f.cyLen); if (typeof v === 'number' && v >= 18 && v <= 45) d.cyLen = Math.round(v); }
    d.vis.parv = fval(f.v_periods_parv) !== false;
    d.vis.riti = fval(f.v_periods_riti) === true;
    d.period.parv = fval(f.cyNotifPeriod_parv) === true;
    d.period.riti = fval(f.cyNotifPeriod_riti) === true;
    d.phase.parv = fval(f.cyNotifPhase_parv) === true;
    d.phase.riti = fval(f.cyNotifPhase_riti) === true;
    { const v = fval(f.cyNotifLead); if (typeof v === 'number' && v >= 0 && v <= 7) d.lead = Math.round(v); }
  } catch (e) {}
  return d;
}

/* the latest logged period (doc id = start date). Returns { start, len } or null. */
async function getLastCycle(accessToken) {
  try {
    const r = await fetch(DOCS + ':runQuery', {
      method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'cycle' }],
          orderBy: [{ field: { fieldPath: 'start' }, direction: 'DESCENDING' }],
          limit: 5
        }
      })
    });
    if (!r.ok) return null;
    const rows = await r.json();
    for (const row of rows) {
      if (row.document && row.document.fields && row.document.fields.start) {
        const f = row.document.fields;
        const start = f.start.stringValue;
        let len = f.len && f.len.integerValue ? parseInt(f.len.integerValue, 10) : (f.len && f.len.doubleValue ? Math.round(f.len.doubleValue) : 4);
        if (!(len > 0 && len < 15)) len = 4;
        // regex + round-trip: reject an impossible date (e.g. 2026-02-30) that the regex passes but
        // Date rolls over. periods.js rejects these too, so the two must agree on "the latest period".
        // rows are start-DESC, so the first valid one is the newest valid period.
        if (/^\d{4}-\d{2}-\d{2}$/.test(start || '') && isoAdd(start, 0) === start) return { start: start, len: len };
      }
    }
    return null;
  } catch (e) { return null; }
}

async function cyMarked(id, accessToken) {
  try { const r = await fetch(DOCS + '/cycleNudges/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + accessToken } }); return r.ok; }
  catch (e) { return true; }   // on error, skip rather than risk a duplicate
}
async function cyMark(id, accessToken) {
  try {
    await fetch(DOCS + '/cycleNudges?documentId=' + encodeURIComponent(id), {
      method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { at: { integerValue: String(Date.now()) } } })
    });
  } catch (e) {}
}

async function cySendTo(person, msg, accessToken) {
  const devices = await getTokens(person, accessToken);
  const link = SITE + '/periods.html?n=1';   // tap -> opens straight to the Periods tab
  let sent = 0;
  for (const d of devices) {
    const res = await sendPush(accessToken, d.token, msg.title, msg.body, link);
    if (res.ok) sent++;
    else if (res.dead) await deleteDoc(d.name, accessToken);
  }
  return sent;
}

async function runCycleNudges(event, env) {
  let sa;
  try { sa = JSON.parse(env.SERVICE_ACCOUNT); } catch (e) { return; }
  const accessToken = await getAccessToken(sa);
  if (!accessToken) return;

  const cfg = await getCycleCfg(accessToken);
  if (cfg.muteAll) { console.log('cycle: muted-all'); return; }

  const last = await getLastCycle(accessToken);
  if (!last) { console.log('cycle: no logs'); return; }

  const now = (event && event.scheduledTime) ? event.scheduledTime : Date.now();
  const todayIso = istDay(now);
  const EXPECT = cfg.cyLen, RANGE = 2, len = last.len;
  const day = isoDiff(last.start, todayIso) + 1;        // cycle day 1 = the start date
  if (day < 1) { console.log('cycle: future start?'); return; }

  const openIso = isoAdd(last.start, EXPECT - RANGE - 1);   // window bounds match periods.js
  const closeIso = isoAdd(last.start, EXPECT + RANGE - 1);
  const phaseToday = cyPhase(day, len, EXPECT);
  const phaseYest = cyPhase(day - 1, len, EXPECT);
  // menstrual fires once per cycle while the period is ongoing (reliable whether the
  // drop was tapped before or after 9am); the other four fire on their transition day.
  const startedPhase = (day <= len) ? 'menstrual'
    : ((phaseToday !== phaseYest && CY_NOTIFY[phaseToday]) ? phaseToday : null);

  for (const person of ['parv', 'riti']) {
    if (!cfg.vis[person]) continue;   // Periods hidden for them -> self-muted

    if (cfg.period[person] && isoDiff(todayIso, openIso) === cfg.lead) {
      const id = 'period-' + person + '-' + last.start;
      if (!(await cyMarked(id, accessToken))) {
        const n = await cySendTo(person, cyPeriodMsg(person, cfg.lead, openIso, closeIso), accessToken);
        if (n > 0) await cyMark(id, accessToken);   // only mark once actually delivered (mirrors the got-home sentDay guard), so a device registered later that day still gets this cycle's nudge
        console.log('cycle: period -> ' + person + ' sent ' + n);
      }
    }

    if (cfg.phase[person] && startedPhase) {
      const id = 'phase-' + person + '-' + last.start + '-' + startedPhase;
      if (!(await cyMarked(id, accessToken))) {
        const n = await cySendTo(person, cyPhaseMsg(person, startedPhase, day), accessToken);
        if (n > 0) await cyMark(id, accessToken);   // only mark once actually delivered (mirrors the got-home sentDay guard), so a device registered later that day still gets this cycle's nudge
        console.log('cycle: phase ' + startedPhase + ' -> ' + person + ' sent ' + n);
      }
    }
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
}

/* verify the site visitor's Firebase ID token via Google (no crypto needed).
   Returns { email, detail } so a failure explains itself instead of a blank 403. */
async function verifyCaller(idToken, apiKey) {
  try {
    if (!apiKey) return { email: null, detail: 'FIREBASE_API_KEY missing in Worker' };
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + apiKey, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { email: null, detail: 'lookup ' + r.status + ': ' + ((d.error && d.error.message) || 'unknown') };
    const u = d.users && d.users[0];
    const email = u && u.email;
    if (email && u.emailVerified === false) return { email: null, detail: 'email not verified' };   // don't trust an unverified email (defense-in-depth if a non-Google provider is ever enabled)
    return { email: email || null, detail: email ? 'ok' : 'no email on account' };
  } catch (e) { return { email: null, detail: 'exception: ' + (e && e.message ? e.message : e) }; }
}

/* service-account JWT -> OAuth2 access token */
async function getAccessToken(sa) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now, exp: now + 3600
    };
    const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
    const unsigned = enc(header) + '.' + enc(claim);
    const key = await importKey(sa.private_key);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const jwt = unsigned + '.' + b64url(new Uint8Array(sig));
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
    });
    const d = await r.json();
    return d.access_token || null;
  } catch (e) { return null; }
}

async function importKey(pem) {
  const b = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const DOCS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

/* look up all device tokens for a person (collection deviceTokens, field person) */
async function getTokens(person, accessToken) {
  try {
    const r = await fetch(DOCS + ':runQuery', {
      method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'deviceTokens' }],
          where: { fieldFilter: { field: { fieldPath: 'person' }, op: 'EQUAL', value: { stringValue: person } } }
        }
      })
    });
    if (!r.ok) return [];
    const rows = await r.json();
    const out = [];
    for (const row of rows) {
      if (row.document && row.document.fields && row.document.fields.token) {
        out.push({ name: row.document.name, token: row.document.fields.token.stringValue });
      }
    }
    return out;
  } catch (e) { return []; }
}

async function deleteDoc(name, accessToken) {
  try {
    await fetch('https://firestore.googleapis.com/v1/' + name, { method: 'DELETE', headers: { Authorization: 'Bearer ' + accessToken } });
  } catch (e) {}
}

async function sendPush(accessToken, token, title, text, link) {
  try {
    const message = {
      message: {
        token: token,
        webpush: {
          notification: { title: title, body: text, icon: SITE + '/icon-192.png', badge: SITE + '/icon-192.png' },
          fcm_options: { link: link }
        }
      }
    };
    const r = await fetch('https://fcm.googleapis.com/v1/projects/' + PROJECT_ID + '/messages:send', {
      method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    if (r.ok) return { ok: true };
    // Only these mean the token itself is gone; everything else is transient → keep it.
    const d = await r.json().catch(() => ({}));
    const err = d.error || {};
    const code = (err.details && err.details[0] && err.details[0].errorCode) || err.status || '';
    // Only prune on a definitively-dead token. INVALID_ARGUMENT also covers a malformed PAYLOAD,
    // so treating it as dead could delete every recipient token in one bad send.
    const dead = r.status === 404 || code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH';
    return { ok: false, dead: dead };
  } catch (e) { return { ok: false, dead: false }; }   // network blip → do NOT delete
}
