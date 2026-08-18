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

  /* Cron Trigger (set to "30 18 * * *" = 00:00 IST). Sends the birthday /
     anniversary wish to BOTH phones at midnight, even with the apps closed. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCelebration(event, env));
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
  const link = (body && body.url) || (SITE + '/open-when.html');
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
   client cannot spoof identity with a body field, and the two homes per
   person share one secret (the Worker never learns which home, by design).
   No location or timestamp is sent in the notification, and no precise
   location is ever stored. Repeated geofence fires within DEDUP_MS are
   swallowed so the other person is not pinged twice. */
const DEDUP_MS = 10 * 60 * 1000;   // 10 minutes

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function handleHomeArrival(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const secret = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!secret) { console.log('home: missing key'); return json({ error: 'unauthorized' }, 401); }

  // identity is derived from the secret alone; any body is ignored
  let sender = null;
  if (timingSafeEqual(secret, env.HOME_SECRET_RITI || '')) sender = 'riti';
  else if (timingSafeEqual(secret, env.HOME_SECRET_PARV || '')) sender = 'parv';
  if (!sender) { console.log('home: bad key'); return json({ error: 'unauthorized' }, 401); }

  const recipient = sender === 'riti' ? 'parv' : 'riti';
  const title = (sender === 'riti' ? 'Riti' : 'Parv') + ' got home safe 🏡';

  let sa;
  try { sa = JSON.parse(env.SERVICE_ACCOUNT); } catch (e) { console.log('home: no service account'); return json({ error: 'server' }, 500); }
  const accessToken = await getAccessToken(sa);
  if (!accessToken) { console.log('home: no access token'); return json({ error: 'server' }, 500); }

  // dedup: if this person already arrived within the window, do nothing
  const now = Date.now();
  const last = await getArrivalAt(sender, accessToken);
  if (last && (now - last) < DEDUP_MS) {
    console.log('home: ' + sender + ' deduped (' + Math.round((now - last) / 1000) + 's since last)');
    return json({ ok: true, deduped: true });
  }
  // record only THAT an arrival happened, plus the time for dedup. No location.
  await setArrivalAt(sender, now, accessToken);

  const devices = await getTokens(recipient, accessToken);
  let sent = 0;
  for (const d of devices) {
    const res = await sendPush(accessToken, d.token, title, '', SITE + '/open-when.html');
    if (res.ok) sent++;
    else if (res.dead) await deleteDoc(d.name, accessToken);
  }
  console.log('home: ' + sender + ' arrived -> pinged ' + recipient + ' (sent ' + sent + '/' + devices.length + ')');
  return json({ ok: true, sent });
}

/* homeArrivals/<person> stores just the last arrival time (ms). It is the
   dedup state and the optional "an arrival occurred" record in one; there is
   no location field, ever. Written by the service account, so no client rule
   is needed (the app never touches this collection). */
async function getArrivalAt(person, accessToken) {
  try {
    const r = await fetch(DOCS + '/homeArrivals/' + person, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!r.ok) return 0;
    const d = await r.json();
    const v = d.fields && d.fields.at && d.fields.at.integerValue;
    return v ? parseInt(v, 10) : 0;
  } catch (e) { return 0; }
}
async function setArrivalAt(person, ms, accessToken) {
  try {
    await fetch(DOCS + '/homeArrivals/' + person + '?updateMask.fieldPaths=at', {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { at: { integerValue: String(ms) } } })
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
    const res = await sendPush(accessToken, d.token, occ.title, '', SITE + '/open-when.html');
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
    const email = d.users && d.users[0] && d.users[0].email;
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
    const dead = r.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT';
    return { ok: false, dead: dead };
  } catch (e) { return { ok: false, dead: false }; }   // network blip → do NOT delete
}
