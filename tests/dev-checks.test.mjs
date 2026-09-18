import fs from 'fs';
import { JSDOM } from 'jsdom';
const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const R = REPO_ROOT;
const devJs = fs.readFileSync(R + '/js/dev.js', 'utf8');
const devHtml = fs.readFileSync(R + '/dev.html', 'utf8');
let body = devHtml.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ FAIL ') + n + (ok || !x ? '' : '  [' + x + ']')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const D = 86400000;

async function panel(o) {
  const opt = Object.assign({ denied: ['deviceTokens', 'celebrations', 'homeArrivals'], unreachable: [], health: null, pre: '' }, o);
  const stub = `
    ${opt.pre}
    var DENIED = ${JSON.stringify(opt.denied)}, UNREACH = ${JSON.stringify(opt.unreachable)};
    var HEALTH = ${JSON.stringify(opt.health)};
    window.__fetches = [];
    var db = { collection: function (name) { return {
      doc: function () { return { get: function () {
        if (UNREACH.indexOf(name) !== -1) return Promise.reject({ code: 'unavailable' });
        if (DENIED.indexOf(name) !== -1) return Promise.reject({ code: 'permission-denied' });
        return Promise.resolve({ exists: false, data: function () { return {}; } });
      } }; },
      get: function () { return Promise.resolve({ forEach: function () {}, size: 0 }); }
    }; } };
    window.firebase = { firestore: function () { return db; }, auth: function () { return { currentUser: { getIdToken: function () { return Promise.resolve('T'); } } }; } };
    window.fetch = function (u, o2) { window.__fetches.push({ u: String(u), auth: (o2 && o2.headers || {}).Authorization });
      return HEALTH === null ? Promise.reject(new Error('offline')) : Promise.resolve({ json: function () { return Promise.resolve(HEALTH); } }); };
    window.__parvritiUser = { person: 'parv' }; window.__parvritiAuthed = true;
    window.__refreshCalls = 0; window.parvritiRefreshDevAlert = function () { window.__refreshCalls++; };
  `;
  const dom = new JSDOM(`<!doctype html><html><body data-page="dev">${body}<script>${stub}</script><script src="js/dev.js?v=142"></script><script>${devJs}</script></body></html>`,
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://parvriti.github.io/dev.html' });
  await sleep(220);
  return dom.window;
}
const txt = w => (w.document.getElementById('devChecks') || {}).innerHTML || '';

console.log('\nA. the free checks render on open');
{
  const w = await panel({ pre: "sessionStorage.setItem('parvritiDevAlert','rose'); sessionStorage.setItem('parvritiDevAlertWhy','cron has not run: celebration'); sessionStorage.setItem('parvritiDevLog', JSON.stringify([{at:Date.now(),kind:'denied',detail:'x',page:'board'}]));" });
  const h = txt(w);
  check('shows the dot verdict and why', /settings dot/.test(h) && /rose/.test(h) && /celebration/.test(h));
  check('shows update health', /last app update/.test(h));
  check('shows service worker state', /service worker/.test(h));
  check('shows notifications for this device', /notifications on THIS device/.test(h));
  check('shows cycle record sanity', /cycle records/.test(h));
  check('shows this session’s faults', /faults this session/.test(h) && /1 recorded/.test(h), h.slice(0, 80));
  check('nothing ran on open beyond the free checks (no worker call)', w.__fetches.length === 0);
}

console.log('\nB. the rules probe');
{
  const dev = fs.readFileSync(R + '/js/dev.js', 'utf8');
  const id = (dev.match(/var PROBE_ID = '([^']+)'/) || [])[1];
  check('the probe id is not one firestore reserves (__x__ answers INVALID_ARGUMENT)', !!id && !/^__.*__$/.test(id), String(id));
  check('and it is an id that will never exist', /does-not-exist|probe/.test(id || ''), String(id));
}
{
  let w = await panel({});
  w.document.getElementById('devProbe').click(); await sleep(200);
  let h = txt(w);
  check('a healthy tree reports every collection behaving as the rules say', /behave exactly as the rules say/.test(h), h.match(/firestore rules[\s\S]{0,90}/));
  check('worker-only collections denying a read is NOT a fault', !/deviceTokens is denied, expected/.test(h));

  w = await panel({ denied: ['deviceTokens', 'celebrations', 'homeArrivals', 'savedDoodles'] });   // an unpublished rule
  w.document.getElementById('devProbe').click(); await sleep(200);
  h = txt(w);
  check('an unpublished rule IS flagged', /savedDoodles is denied, expected read/.test(h), h.match(/firestore rules[\s\S]{0,120}/));

  w = await panel({ unreachable: ['notes', 'cycle'] });
  w.document.getElementById('devProbe').click(); await sleep(200);
  check('offline collections report unknown, never a fault', /unreachable, try again when online/.test(txt(w)));
}

console.log('\nB2. the card and the dot must agree on when a cron is late');
{
  const dev = fs.readFileSync(R + '/js/dev.js', 'utf8');
  const com = fs.readFileSync(R + '/js/common.js', 'utf8');
  check('the panel no longer carries its own 1.5x cadence rule', !/every:s*d+/.test(dev) && !/c.every/.test(dev), 'stale every: found');
  check('the panel reads the dot’s thresholds', /window.parvritiCronMax/.test(dev) && /window.parvritiCronMax = CRON_MAX/.test(com));
  const fb = (dev.match(/{ celebration: 36, cycle: 36, capsule: 36, flight: 3 }/g) || []).length;
  check('its offline fallback matches the dot exactly', fb === 1, 'copies=' + fb);
}

console.log('\nB3. a deep check must not leave duplicate rows or a stale verdict');
{
  const now = Date.now();
  const good = { ok: true, tokens: { parv: { count: 4, newest: now, oldest: now }, riti: { count: 0, newest: 0, oldest: 0 } },
    arrivals: { parv: { at: now, home: 'parv-rohtak' }, riti: { at: now, home: 'riti-noida' } },
    secrets: { serviceAccount: true, firebaseApiKey: true, homeSecretParv: true, homeSecretRiti: true, aerodataboxKey: true } };
  const w = await panel({ health: good });
  const count = () => (txt(w).match(/app version/g) || []).length;
  check('one app-version row on open', count() === 1, 'rows=' + count());
  const refreshBefore = w.__refreshCalls;   // opening the panel already syncs the dot once (v150); count only what the deep check adds
  w.document.getElementById('devProbe').click();
  await sleep(1200);
  check('STILL one after a deep check (it used to stack one per render)', count() === 1, 'rows=' + count());
  w.document.getElementById('devProbe').click();
  await sleep(1200);
  check('and still one after running it twice', count() === 1, 'rows=' + count());
  check('the deep check asks the dot to re-evaluate, so it cannot show a stale all-clear', w.__refreshCalls > refreshBefore, 'calls=' + w.__refreshCalls + ' before=' + refreshBefore);
}

console.log('\nC. what the worker reports');
{
  const now = Date.now();
  const good = { ok: true, tokens: { parv: { count: 4, newest: now - 2 * 3600000, oldest: now - 5 * D }, riti: { count: 1, newest: now - D, oldest: now - D } },
    arrivals: { parv: { at: now - 3 * 3600000, home: 'parv-gurugram' }, riti: { at: now - 2 * D, home: 'riti-noida' } },
    secrets: { serviceAccount: true, firebaseApiKey: true, homeSecretParv: true, homeSecretRiti: true, aerodataboxKey: true } };
  let w = await panel({ health: good });
  w.document.getElementById('devProbe').click(); await sleep(250);
  let h = txt(w);
  check('sends the worker a bearer token', w.__fetches.length === 1 && /dev\/health$/.test(w.__fetches[0].u) && w.__fetches[0].auth === 'Bearer T', JSON.stringify(w.__fetches[0]));
  check('healthy push targets read ok', /push targets: Parv[\s\S]{0,60}4 devices/.test(h), h.match(/push targets: Parv[\s\S]{0,70}/));
  check('healthy shortcuts read ok', /home shortcuts: Parv[\s\S]{0,60}parv-gurugram/.test(h));
  check('all secrets present', /worker secrets[\s\S]{0,40}all present/.test(h));

  const zero = JSON.parse(JSON.stringify(good)); zero.tokens.riti = { count: 0, newest: 0, oldest: 0 };
  w = await panel({ health: zero }); w.document.getElementById('devProbe').click(); await sleep(250);
  check('a person with NO push target is flagged loudly', /push targets: Riti[\s\S]{0,80}every notification to them vanishes/.test(txt(w)), txt(w).match(/push targets: Riti[\s\S]{0,90}/));

  const stale = JSON.parse(JSON.stringify(good)); stale.arrivals.riti = { at: now - 20 * D, home: 'riti-noida' };
  w = await panel({ health: stale }); w.document.getElementById('devProbe').click(); await sleep(250);
  check('no arrival in over 2 weeks suggests a disabled Shortcut', /Shortcut may be switched off/.test(txt(w)));

  const stale2 = JSON.parse(JSON.stringify(good)); stale2.arrivals.riti = { at: now - 9 * D, home: 'riti-noida' };
  w = await panel({ health: stale2 }); w.document.getElementById('devProbe').click(); await sleep(250);
  check('9 days at home is NOT flagged (they stay in for long stretches)', !/Shortcut may be switched off/.test(txt(w)));

  const nosec = JSON.parse(JSON.stringify(good)); nosec.secrets.aerodataboxKey = false;
  w = await panel({ health: nosec }); w.document.getElementById('devProbe').click(); await sleep(250);
  check('a missing worker secret is named', /MISSING: aerodataboxKey/.test(txt(w)));

  const unk = JSON.parse(JSON.stringify(good)); unk.tokens = null; unk.arrivals = null;
  w = await panel({ health: unk }); w.document.getElementById('devProbe').click(); await sleep(250);
  check('unreadable worker data is unknown, not a fault', /push targets[\s\S]{0,50}could not be read/.test(txt(w)) && !/vanishes/.test(txt(w)));

  w = await panel({ health: null });   // worker unreachable
  w.document.getElementById('devProbe').click(); await sleep(250);
  check('an unreachable worker says so plainly', /could not reach the worker/.test(txt(w)));
}

console.log('\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
