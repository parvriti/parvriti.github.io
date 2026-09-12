import fs from 'fs';
import { generateKeyPairSync } from 'crypto';
const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const REPO = REPO_ROOT;
const HERE = new URL('.', import.meta.url).pathname;
fs.copyFileSync(REPO + '/push-worker/worker.js', HERE + 'worker-under-test.mjs');   // a copy, so Node parses `export default`

let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ FAIL ') + name + (ok || !extra ? '' : '  [' + extra + ']')); };

// ── fake service account (real RSA key so the worker's JWT signing path runs for real) ──
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const env = { HOME_SECRET_PARV: 'SECRET-PARV', HOME_SECRET_RITI: 'SECRET-RITI', FIREBASE_API_KEY: 'k', AERODATABOX_KEY: 'x',
  SERVICE_ACCOUNT: JSON.stringify({ client_email: 'sa@test', private_key: privateKey }) };

// ── in-memory Firestore + Google endpoints ──
const DOCS = 'https://firestore.googleapis.com/v1/projects/parvriti/databases/(default)/documents';
let store = {}, failGet = {}, pushes = [], patches = [], gets = [], oauth = 0, tokenDocs = [], lastTokenUrl = '';
const I = n => ({ integerValue: String(n) }), S = s => ({ stringValue: s }), B = b => ({ booleanValue: b });
const val = (path, f) => { const v = store[path] && store[path][f]; if (!v) return undefined; return 'integerValue' in v ? +v.integerValue : 'booleanValue' in v ? v.booleanValue : v.stringValue; };
const resp = (status, obj) => new Response(JSON.stringify(obj == null ? {} : obj), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, opts) => {
  url = String(url); opts = opts || {}; const m = (opts.method || 'GET').toUpperCase();
  if (url.startsWith('https://oauth2.googleapis.com/token')) { oauth++; return resp(200, { access_token: 'AT' }); }
  if (url.startsWith('https://identitytoolkit.googleapis.com')) {
    const t = JSON.parse(opts.body).idToken;
    const email = t === 'TOKEN_PARV' ? 'parvbajaj2000@gmail.com' : t === 'TOKEN_RITI' ? 'aritika2000@gmail.com' : null;
    return email ? resp(200, { users: [{ email, emailVerified: true }] }) : resp(400, { error: { message: 'INVALID_ID_TOKEN' } });
  }
  if (url.startsWith('https://fcm.googleapis.com')) { pushes.push(JSON.parse(opts.body).message); return resp(200, {}); }
  if (url === DOCS + ':runQuery') {
    const person = JSON.parse(opts.body).structuredQuery.where.fieldFilter.value.stringValue;
    return resp(200, [{ document: { name: DOCS + '/deviceTokens/' + person, fields: { token: S('tok-' + person), person: S(person) } } }]);
  }
  if (m === 'DELETE') return resp(200, {});
  if (url.startsWith(DOCS + '/')) {
    const rest = url.slice(DOCS.length + 1); const q = rest.indexOf('?'); const path = q < 0 ? rest : rest.slice(0, q);
    if (m === 'GET' && path === 'deviceTokens') {
      lastTokenUrl = url;
      if (failGet.deviceTokens) return resp(failGet.deviceTokens, { error: {} });
      return resp(200, { documents: tokenDocs });
    }
    if (m === 'GET') { gets.push(path); if (failGet[path]) return resp(failGet[path], { error: { code: failGet[path] } }); return store[path] ? resp(200, { name: path, fields: store[path] }) : resp(404, { error: { code: 404 } }); }
    if (m === 'PATCH') { const f = JSON.parse(opts.body).fields; store[path] = Object.assign({}, store[path] || {}, f); patches.push({ path, f }); return resp(200, {}); }
    if (m === 'POST') { const id = new URL(url).searchParams.get('documentId'); const p = path + '/' + id; store[p] = JSON.parse(opts.body).fields; patches.push({ path: p, f: store[p], create: true }); return resp(200, {}); }
  }
  throw new Error('unmocked fetch: ' + m + ' ' + url);
};
let NOW = Date.UTC(2026, 8, 11, 6, 0, 0);          // 2026-09-11 11:30 IST
const realNow = Date.now; Date.now = () => NOW;
const MIN = 60 * 1000, H = 60 * MIN;

const worker = (await import('./worker-under-test.mjs')).default;
const home = (person, body) => worker.fetch(new Request('https://w/automation/home', { method: 'POST', headers: { Authorization: 'Bearer SECRET-' + person.toUpperCase(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env).then(r => r.json());
const override = (token, body) => worker.fetch(new Request('https://w/home/override', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env).then(async r => ({ status: r.status, j: await r.json() }));
const cron = async (c, when) => { const p = []; await worker.scheduled({ cron: c, scheduledTime: when }, env, { waitUntil: x => p.push(x) }); await Promise.all(p); };
const reset = () => { store = { 'settings/app': { muteAll: B(true) } }; failGet = {}; pushes = []; patches = []; gets = []; tokenDocs = []; lastTokenUrl = ''; };
const health = (token) => worker.fetch(new Request('https://w/dev/health', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }), env).then(async r => ({ status: r.status, j: await r.json(), raw: '' }));
const healthRaw = (token) => worker.fetch(new Request('https://w/dev/health', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }), env).then(async r => await r.text());
const tokDoc = (person, iso) => ({ name: 'projects/p/databases/(default)/documents/deviceTokens/SECRET-FCM-TOKEN-' + person, fields: { person: S(person), updatedAt: { timestampValue: iso } } });   // muteAll: no home-safe pushes, keeps the arrival tests about STATE

// ────────────────────────────────────────────────────────────────────────────
console.log('\n1. arrive → leave → re-arrive within 10 min is a real arrival, not a bounce');
{
  reset(); const T0 = NOW;
  let r = await home('parv', { home: 'parv-gurugram' });
  check('first arrival recorded', r.ok && !r.deduped && val('homeState/parv', 'atHome') === true && val('homeArrivals/parv', 'at') === T0);
  NOW = T0 + 4 * MIN; r = await home('parv', { home: 'parv-gurugram', event: 'leave' });
  check('leave flips home to away', r.left && val('homeState/parv', 'atHome') === false && val('homeArrivals/parv', 'leftAt') === T0 + 4 * MIN);
  NOW = T0 + 7 * MIN; r = await home('parv', { home: 'parv-gurugram' });
  check('re-arrival 7 min later is NOT deduped (the bug)', !r.deduped, JSON.stringify(r));
  check('home is back to true', val('homeState/parv', 'atHome') === true);
  check('arrival time refreshed to the re-arrival', val('homeArrivals/parv', 'at') === T0 + 7 * MIN);
  NOW = T0 + 8 * MIN; r = await home('parv', { home: 'parv-gurugram' });
  check('a genuine bounce (no leave in between) IS still deduped', r.deduped === true);
  check('...and a bounce re-asserts home=true', val('homeState/parv', 'atHome') === true);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\n2. an unreadable partner record must not clear a real Together');
{
  reset(); const T1 = NOW = NOW + 24 * H;
  store['homeArrivals/riti'] = { at: I(T1 - 1 * H), home: S('parv-gurugram'), leftAt: I(0) };
  store['homeState/together'] = { together: B(true), since: I(T1 - 1 * H), via: S('same-place') };
  failGet['homeArrivals/riti'] = 500;
  const before = patches.length;
  await home('parv', { home: 'parv-gurugram' });
  const togWrites = patches.slice(before).filter(p => p.path === 'homeState/together');
  check('partner GET 500: together NOT written at all', togWrites.length === 0, JSON.stringify(togWrites));
  check('together still true with its original since', val('homeState/together', 'together') === true && val('homeState/together', 'since') === T1 - 1 * H);
  check('the arrival itself still recorded (home=true)', val('homeState/parv', 'atHome') === true);
  delete failGet['homeArrivals/riti']; NOW = T1 + 11 * MIN;
  await home('parv', { home: 'parv-gurugram' });
  check('partner readable again: together recomputed true via same-place', val('homeState/together', 'together') === true && val('homeState/together', 'via') === 'same-place');
  delete store['homeArrivals/riti']; NOW = T1 + 22 * MIN;
  await home('parv', { home: 'parv-gurugram' });
  check('partner has NO record (404): that is "not there", together=false written', val('homeState/together', 'together') === false);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\n3. /home/override is Parv-only');
{
  reset(); store['homeState/together'] = { together: B(true), since: I(NOW) };
  let r = await override('TOKEN_RITI', { action: 'apart' });
  check("Riti's valid token → 403 notallowed", r.status === 403 && r.j.error === 'notallowed', JSON.stringify(r));
  check('nothing written', val('homeState/together', 'together') === true);
  r = await override('TOKEN_PARV', { action: 'apart' });
  check("Parv's token → 200 and together cleared as manual-revert", r.status === 200 && r.j.ok && val('homeState/together', 'together') === false && val('homeState/together', 'via') === 'manual-revert');
  r = await override('garbage', { action: 'apart' });
  check('bad token → 403 verify', r.status === 403 && r.j.error === 'verify');
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n4. midnight wish: heartbeat every night, same-day catch-up only on a confirmed gap");
{
  reset();
  const MIDNIGHT = Date.UTC(2026, 3, 19, 18, 30);    // 00:00 IST on 20 Apr 2026 = Riti's birthday
  NOW = MIDNIGHT;
  await cron('30 18 * * *', MIDNIGHT);
  check('midnight: wish pushed to both phones', pushes.length === 2 && /Riti Day/.test(pushes[0].webpush.notification.title), pushes.length);
  check('midnight: sent-marker created', !!store['celebrations/riti-2026']);
  check('midnight: workerHealth/celebration heartbeat written', val('workerHealth/celebration', 'at') === MIDNIGHT);
  const hb = val('workerHealth/celebration', 'at');

  // the */15 tick that coincides with midnight must NOT run the catch-up (race)
  reset(); NOW = MIDNIGHT; gets = [];
  await cron('*/15 * * * *', MIDNIGHT);
  check('*/15 at exactly 18:30 UTC: no celebrations read, no push (race guard)', !gets.some(g => g.startsWith('celebrations/')) && pushes.length === 0, JSON.stringify(gets));

  // marker present → catch-up does nothing, and does not touch the heartbeat
  reset(); store['celebrations/riti-2026'] = { at: I(MIDNIGHT) }; store['workerHealth/celebration'] = { at: I(hb) };
  NOW = MIDNIGHT + 15 * MIN; await cron('*/15 * * * *', NOW);
  check('catch-up, marker present: no push', pushes.length === 0);
  check('catch-up never rewrites the celebration heartbeat', val('workerHealth/celebration', 'at') === hb);

  // marker unreadable (500) → catch-up must NOT send (would repeat every 15 min otherwise)
  reset(); failGet['celebrations/riti-2026'] = 500; NOW = MIDNIGHT + 30 * MIN;
  await cron('*/15 * * * *', NOW);
  check('catch-up, marker GET 500: no push', pushes.length === 0);

  // marker confirmed missing (404) → catch-up fills the gap once
  reset(); NOW = MIDNIGHT + 45 * MIN;
  await cron('*/15 * * * *', NOW);
  check('catch-up, marker 404: wish sent (the gap is filled)', pushes.length === 2);
  check('...and marked, so the next tick is silent', !!store['celebrations/riti-2026']);
  pushes = []; NOW = MIDNIGHT + 60 * MIN; await cron('*/15 * * * *', NOW);
  check('next tick after the catch-up: silent', pushes.length === 0);

  // a normal day: catch-up returns before minting a token; midnight still heartbeats
  reset(); NOW = Date.UTC(2026, 3, 21, 18, 45); const o0 = oauth; gets = [];
  await cron('*/15 * * * *', NOW);
  check('normal day catch-up: no celebrations read', !gets.some(g => g.startsWith('celebrations/')));
  NOW = Date.UTC(2026, 3, 21, 18, 30); await cron('30 18 * * *', NOW);
  check('normal day midnight: heartbeat still written, no push', val('workerHealth/celebration', 'at') === NOW && pushes.length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\n5. every cron leaves a heartbeat, before any business early-return');
{
  reset();                                          // settings muteAll:true → cycle + capsule exit right after marking
  NOW = Date.UTC(2026, 8, 12, 3, 30); await cron('30 3 * * *', NOW);
  check('cycle heartbeat written despite muteAll early-return', val('workerHealth/cycle', 'at') === NOW);
  check('capsule heartbeat written despite muteAll early-return', val('workerHealth/capsule', 'at') === NOW);
  reset(); NOW = Date.UTC(2026, 8, 12, 4, 0); await cron('*/15 * * * *', NOW);       // :00 tick, no active flight (404)
  check('flight beat at :00 even with no active flight', val('workerHealth/flight', 'at') === NOW);
  reset(); NOW = Date.UTC(2026, 8, 12, 4, 15); await cron('*/15 * * * *', NOW);
  check('flight beat NOT written at :15 (hourly only, keeps writes cheap)', val('workerHealth/flight', 'at') === undefined);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\n6. /dev/health: admin only, and it must never leak a token string');
{
  reset();
  let r = await worker.fetch(new Request('https://w/dev/health', { method: 'GET' }), env);
  check('GET is rejected', r.status === 405);
  r = await worker.fetch(new Request('https://w/dev/health', { method: 'POST' }), env);
  check('no token -> 401', r.status === 401);
  let h = await health('TOKEN_RITI');
  check("Riti's valid token -> 403 notallowed (admin only)", h.status === 403 && h.j.error === 'notallowed', JSON.stringify(h.j));
  h = await health('garbage');
  check('bad token -> 403 verify', h.status === 403 && h.j.error === 'verify');

  reset();
  tokenDocs = [tokDoc('parv', '2026-09-12T08:00:00Z'), tokDoc('parv', '2026-09-10T08:00:00Z'), tokDoc('riti', '2026-09-11T08:00:00Z')];
  store['homeArrivals/parv'] = { at: I(NOW - 3 * H), home: S('parv-gurugram'), leftAt: I(0) };
  store['homeArrivals/riti'] = { at: I(NOW - 30 * H), home: S('riti-noida'), leftAt: I(0) };
  h = await health('TOKEN_PARV');
  check("Parv's token -> 200", h.status === 200 && h.j.ok === true, JSON.stringify(h.j).slice(0, 120));
  check('counts push targets per person', h.j.tokens.parv.count === 2 && h.j.tokens.riti.count === 1, JSON.stringify(h.j.tokens));
  check('reports newest/oldest token age', h.j.tokens.parv.newest > h.j.tokens.parv.oldest);
  check('reports last arrival per person', h.j.arrivals.parv.home === 'parv-gurugram' && h.j.arrivals.riti.at === NOW - 30 * H, JSON.stringify(h.j.arrivals));
  check('secrets reported as booleans only', h.j.secrets.serviceAccount === true && h.j.secrets.aerodataboxKey === true && Object.values(h.j.secrets).every(v => typeof v === 'boolean'));

  const raw = await healthRaw('TOKEN_PARV');
  check('NO fcm token string anywhere in the response', raw.indexOf('SECRET-FCM-TOKEN') === -1, raw.slice(0, 100));
  check('the token strings are never even requested (field mask)', /mask\.fieldPaths=person/.test(lastTokenUrl) && /mask\.fieldPaths=updatedAt/.test(lastTokenUrl) && !/token/.test(lastTokenUrl), lastTokenUrl.slice(-90));

  // a person at ZERO tokens is the silent-death case this endpoint exists for
  reset(); tokenDocs = [tokDoc('parv', '2026-09-12T08:00:00Z')];
  h = await health('TOKEN_PARV');
  check('a person with no push target reports count 0', h.j.tokens.riti.count === 0, JSON.stringify(h.j.tokens));

  // unreadable must read as UNKNOWN, never as a fault
  reset(); failGet.deviceTokens = 500;
  h = await health('TOKEN_PARV');
  check('unreadable tokens -> null (unknown), endpoint still ok', h.j.tokens === null && h.j.ok === true);
  reset(); failGet['homeArrivals/riti'] = 500; store['homeArrivals/parv'] = { at: I(NOW), home: S('parv-gurugram') };
  h = await health('TOKEN_PARV');
  check('unreadable arrival -> null, NOT reported as a dead shortcut', h.j.arrivals.riti === null && h.j.arrivals.parv.home === 'parv-gurugram');

  // a missing secret is exactly why pushes or flights would have died
  const envNoKey = Object.assign({}, env, { AERODATABOX_KEY: '' });
  const r2 = await worker.fetch(new Request('https://w/dev/health', { method: 'POST', headers: { Authorization: 'Bearer TOKEN_PARV' } }), envNoKey);
  const j2 = await r2.json();
  check('a missing secret shows as false', j2.secrets.aerodataboxKey === false && j2.secrets.serviceAccount === true);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\n7. hourly token counts, so the dot can see a dead push target without calling the worker');
{
  reset(); tokenDocs = [tokDoc('parv','2026-09-12T08:00:00Z'), tokDoc('parv','2026-09-11T08:00:00Z'), tokDoc('riti','2026-09-12T07:00:00Z')];
  NOW = Date.UTC(2026, 8, 13, 5, 0);           // an on-the-hour tick
  await cron('*/15 * * * *', NOW);
  check('the hourly beat records a count per person', val('workerHealth/tokens','parv') === 2 && val('workerHealth/tokens','riti') === 1, JSON.stringify(store['workerHealth/tokens']));
  check('and stamps when it did', val('workerHealth/tokens','at') === NOW);
  check('no token STRING is stored anywhere in that doc', JSON.stringify(store['workerHealth/tokens']).indexOf('SECRET-FCM-TOKEN') === -1);

  reset(); tokenDocs = [tokDoc('parv','2026-09-12T08:00:00Z')];   // riti has lost her last device
  NOW = Date.UTC(2026, 8, 13, 6, 0); await cron('*/15 * * * *', NOW);
  check('a person with no device left records 0', val('workerHealth/tokens','riti') === 0 && val('workerHealth/tokens','parv') === 1);

  reset(); NOW = Date.UTC(2026, 8, 13, 6, 15); await cron('*/15 * * * *', NOW);
  check('the off-the-hour ticks do NOT write it (keeps writes cheap)', store['workerHealth/tokens'] === undefined);

  reset(); failGet.deviceTokens = 500; store['workerHealth/tokens'] = { at: I(NOW - 3600000), parv: I(4), riti: I(1) };
  NOW = Date.UTC(2026, 8, 13, 7, 0); await cron('*/15 * * * *', NOW);
  check('UNREADABLE tokens leave the old counts alone (never writes a false zero)', val('workerHealth/tokens','riti') === 1 && val('workerHealth/tokens','parv') === 4, JSON.stringify(store['workerHealth/tokens']));
}

Date.now = realNow;
console.log('\n───────────────\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
