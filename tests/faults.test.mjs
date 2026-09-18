/* v150: the fault recorder, the cross-phone inbox, the dot's new lowest-priority amber,
   and the Developer panel's Faults card. Boots the REAL common.js / dev.js in jsdom
   against a fake Firestore that records every write and read. Synthetic faults only. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const common = fs.readFileSync(R + '/js/common.js', 'utf8');
const devJs = fs.readFileSync(R + '/js/dev.js', 'utf8');
const devHtml = fs.readFileSync(R + '/dev.html', 'utf8');
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ FAIL ') + n + (ok || !x ? '' : '  [' + x + ']')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = 3600000, D = 86400000;

/* the real common.js, signed in, with a fake Firestore.
   docs: { 'faults/riti': {...}, 'workerHealth/cycle': {...} }   getFail: collections whose reads are denied */
async function boot(o) {
  const opt = Object.assign({ person: 'parv', docs: {}, getFail: [], setFail: null, caches: ['parvriti-v150'], pageV: '150', pre: '', noFirebase: false }, o);
  const stub = `
    window.matchMedia = window.matchMedia || function(){ return { matches:false, addEventListener:function(){}, addListener:function(){} }; };
    ${opt.pre}
    window.__reads = {}; window.__sets = [];
    var DOCS = ${JSON.stringify(opt.docs)}, GETFAIL = ${JSON.stringify(opt.getFail)}, SETFAIL = ${JSON.stringify(opt.setFail)};
    function authFn(){ return { setPersistence:function(){}, getRedirectResult:function(){ return Promise.resolve(null); }, onAuthStateChanged:function(cb){ window.__authCb = cb; }, signOut:function(){ return Promise.resolve(); }, currentUser:null }; }
    authFn.Auth = { Persistence:{ LOCAL:'local' } }; authFn.GoogleAuthProvider = function(){};
    function fsFn(){ return { collection:function(name){ return { doc:function(id){ var path = name + '/' + id; return {
      set:function(d, o2){ window.__sets.push({ path: path, d: d, o: o2 }); return (SETFAIL && name === 'faults') ? Promise.reject({ code: SETFAIL }) : Promise.resolve(); },
      get:function(){
        window.__reads[name] = (window.__reads[name] || 0) + 1;
        if (GETFAIL.indexOf(name) !== -1) return Promise.reject({ code: 'permission-denied' });
        var v = DOCS[path]; return Promise.resolve({ exists: v !== undefined, data:function(){ return v === undefined ? null : JSON.parse(JSON.stringify(v)); } });
      },
      onSnapshot:function(){ return function(){}; } }; } }; } }; }
    fsFn.FieldValue = { serverTimestamp:function(){ return 0; }, delete:function(){ return '__DELETE__'; } };
    ${opt.noFirebase ? '' : 'window.firebase = { apps:[], initializeApp:function(){}, auth:authFn, firestore:fsFn };'}
    window.caches = { keys: function(){ return Promise.resolve(${JSON.stringify(opt.caches)}); } };
  `;
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => errs.push(String(e && e.message || e)));
  const dom = new JSDOM(`<!doctype html><html><body data-page="home"><div class="canvas"><div data-homestate></div></div>
    <script>${stub}</script><script src="js/common.js?v=${opt.pageV}"></script><script>${common}</script></body></html>`,
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://parvriti.github.io/index.html', virtualConsole: vc });
  await sleep(20);
  if (!opt.noFirebase) {
    dom.window.__authCb({ email: opt.person === 'riti' ? 'aritika2000@gmail.com' : 'parvbajaj2000@gmail.com', emailVerified: true });
    await sleep(40);
  }
  return { w: dom.window, errs, dom };
}
const outbox = w => JSON.parse(w.localStorage.getItem('parvritiFaultOutbox') || '[]');
const faultSets = w => w.__sets.filter(s => /^faults\//.test(s.path));
const fire = (w, message, filename, lineno) => w.dispatchEvent(new w.ErrorEvent('error', { message, filename, lineno }));
const reject = (w, reason) => { const ev = new w.Event('unhandledrejection'); Object.defineProperty(ev, 'reason', { value: reason }); w.dispatchEvent(ev); };
const dot = w => w.document.body.getAttribute('data-dev-alert');
const why = w => w.sessionStorage.getItem('parvritiDevAlertWhy') || '';

console.log('\nA. what gets recorded, and how it is cleaned');
{
  const { w, errs } = await boot({});
  fire(w, "TypeError: undefined is not an object (evaluating 'e.data().title')", 'https://parvriti.github.io/js/open-when.js?v=150', 120);
  w.parvritiFaults.flush();
  let o = outbox(w);
  check('an uncaught error lands in the outbox', o.length === 1 && o[0].k === 'error', JSON.stringify(o));
  check('file is named without its ?v=, with the line', o[0].f === 'open-when.js' && o[0].l === 120, o[0].f + ':' + o[0].l);
  check('the code path in single quotes is KEPT (it says where it broke)', /'e\.data\(\)\.title'/.test(o[0].m), o[0].m);
  check('page and app version are stamped', o[0].p === 'home' && o[0].v === '150', o[0].p + ' v' + o[0].v);

  fire(w, 'JSON Parse error: Unexpected identifier "dear riti you are my"', 'https://parvriti.github.io/js/board.js?v=150', 7);
  fire(w, 'bad id 1789214428227 for parvbajaj2000@gmail.com', 'https://parvriti.github.io/js/board.js?v=150', 9);
  w.parvritiFaults.flush();
  o = outbox(w);
  const all = JSON.stringify(o);
  check('a quoted VALUE never leaves the phone (Safari quotes the data it choked on)', !/dear riti/.test(all) && o.some(e => e.m === 'JSON Parse error: Unexpected identifier "…"'), all.slice(0, 200));
  check('an email address never leaves the phone', !/parvbajaj2000/.test(all) && /\(email\)/.test(all));
  check('long numbers are folded so one fault stays one fault', !/1789214428227/.test(all) && /#/.test(all));

  fire(w, 'Script error.', '', 0);
  fire(w, 'ResizeObserver loop completed with undelivered notifications.', '', 0);
  w.parvritiFaults.flush();
  o = outbox(w);
  check('"Script error." from a cross-origin script is kept but QUIET (can never light the dot)', o.some(e => /Script error/.test(e.m) && e.q === true));
  check('a ResizeObserver loop notice is quiet too', o.some(e => /ResizeObserver/.test(e.m) && e.q === true));
  check('a real error is NOT quiet', o.some(e => e.f === 'open-when.js' && e.q === false));
  check('recording never produced an uncaught error', errs.length === 0, errs.join(' | '));
}

console.log('\nB. promises nobody handled');
{
  const { w } = await boot({});
  reject(w, { message: 'boom', stack: 'saveForm@https://parvriti.github.io/js/doodle.js?v=150:44:3\nx@https://parvriti.github.io/js/common.js?v=150:9:1' });
  reject(w, { code: 'unavailable', message: 'offline' });
  reject(w, { code: 'auth/network-request-failed', message: 'net' });
  reject(w, new w.TypeError('Load failed'));
  reject(w, undefined);
  w.parvritiFaults.flush();
  const o = outbox(w);
  const boom = o.find(e => e.m === 'boom');
  check('an unhandled rejection is recorded with the file and line from its stack', boom && boom.k === 'promise' && boom.f === 'doodle.js' && boom.l === 44, JSON.stringify(boom));
  check('offline (unavailable) and a network blip in auth are tunnels: not recorded', !o.some(e => /offline|net$/.test(e.m)));
  check('a bare "Load failed" (dropped connection) is kept but quiet', o.some(e => /Load failed/.test(e.m) && e.q));
  check('a rejection with no reason at all is quiet', o.some(e => /no reason/.test(e.m) && e.q));
}

console.log('\nC. a fault storm costs nothing and cannot hurt the page');
{
  const { w, errs } = await boot({});
  const orig = w.Storage.prototype.setItem; let outboxWrites = 0;
  w.Storage.prototype.setItem = function (k, v) { if (k === 'parvritiFaultOutbox') outboxWrites++; return orig.call(this, k, v); };
  for (let i = 0; i < 1000; i++) fire(w, 'render blew up', 'https://parvriti.github.io/js/doodle.js?v=150', 300);
  check('1000 identical errors in one burst: zero storage writes so far (counted in memory)', outboxWrites === 0, 'writes=' + outboxWrites);
  const log = JSON.parse(w.sessionStorage.getItem('parvritiDevLog') || '[]');
  check('...and ONE line in the session log, not a thousand', log.filter(e => /render blew up/.test(e.detail)).length === 1, JSON.stringify(log));
  await sleep(5300);   // the recorder's own 5 second save
  check('it saves by itself within 5 seconds, in ONE write', outboxWrites === 1, 'writes=' + outboxWrites);
  const e = outbox(w).find(x => /render blew up/.test(x.m));
  check('as one entry counted 1000 times', e && e.n === 1000, JSON.stringify(e));
  for (let i = 0; i < 45; i++) fire(w, 'different fault ' + String.fromCharCode(97 + (i % 26)) + i, 'https://parvriti.github.io/js/board.js?v=150', i + 1);
  await sleep(5);
  fire(w, 'and one more', 'https://parvriti.github.io/js/board.js?v=150', 99);   // folds into the overflow line, making it the newest
  w.parvritiFaults.flush();
  const o = outbox(w);
  check('the outbox is capped at 20 entries however many distinct faults there are', o.length === 20, 'len=' + o.length);
  check('a page spraying different faults folds the rest into one "overflow" line', o.some(x => x.k === 'overflow'));
  check('still no uncaught error', errs.length === 0, errs.join(' | '));
}
{
  // storage that throws on every write (private mode, full disk): the recorder must shrug
  const { w, errs } = await boot({ pre: "Storage.prototype.setItem = function(){ throw new Error('QuotaExceededError'); };" });
  fire(w, 'x', 'https://parvriti.github.io/js/board.js?v=150', 1);
  reject(w, { message: 'y' });
  w.parvritiFaults.flush();
  check('storage that throws on every write: recorder never throws', errs.length === 0, errs.join(' | '));
  const d = await w.parvritiFaults.deliver(true);
  check('...and delivery reports back instead of throwing', typeof d === 'string', String(d));
}
{
  // a genuinely uncaught error from real code, not a synthetic event
  const { w } = await boot({});
  w.eval("setTimeout(function(){ var n = null; n.explode(); }, 0);");
  await sleep(30);
  w.parvritiFaults.flush();
  check('a real uncaught TypeError thrown by page code is recorded', outbox(w).some(e => e.k === 'error' && /explode|null/.test(e.m)), JSON.stringify(outbox(w)));
}

console.log('\nD. Firebase not loading, and a script not loading');
{
  let { w } = await boot({ noFirebase: true });
  w.parvritiFaults.flush();
  let o = outbox(w);
  check('Firebase missing is recorded as an sdk fault', o.some(e => e.k === 'sdk' && e.q === false), JSON.stringify(o));
  check('and the app still unlocked its static pages', w.__parvritiAuthed === true);
  ({ w } = await boot({ noFirebase: true, pre: "Object.defineProperty(navigator, 'onLine', { get: function(){ return false; } });" }));
  w.parvritiFaults.flush();
  check('offline (the harmless way to get there) records it QUIET', outbox(w).some(e => e.k === 'sdk' && e.q === true));
  ({ w } = await boot({}));
  const s = w.document.createElement('script'); s.src = 'https://parvriti.github.io/js/flight.js?v=150'; w.document.body.appendChild(s);
  s.dispatchEvent(new w.Event('error'));
  const img = w.document.createElement('img'); img.src = 'https://example.com/x.png'; w.document.body.appendChild(img);
  img.dispatchEvent(new w.Event('error'));
  w.parvritiFaults.flush();
  o = outbox(w);
  check('one of our own scripts failing to load is recorded by name', o.some(e => e.k === 'load' && e.f === 'flight.js'), JSON.stringify(o));
  check('an image failing to load is ordinary life, not a fault', !o.some(e => /x\.png|example/.test(JSON.stringify(e))));
  check('our own script failing is LOUD (it comes from the offline cache, so it is real)', o.some(e => e.k === 'load' && e.f === 'flight.js' && e.q === false));
  const g = w.document.createElement('link'); g.rel = 'stylesheet'; g.href = 'https://fonts.googleapis.com/css2?family=X'; w.document.head.appendChild(g);
  g.dispatchEvent(new w.Event('error'));
  w.parvritiFaults.flush();
  check("Google's stylesheet failing is kept but QUIET (nearly always the network)", outbox(w).some(e => e.k === 'load' && e.f === 'fonts.googleapis.com' && e.q === true), JSON.stringify(outbox(w).filter(e => e.k === 'load')));
}

console.log('\nE. page scripts hand their listener errors over, silently');
{
  const { w } = await boot({});
  w.parvritiFault({ code: 'permission-denied' }, 'flight log');
  w.parvritiFault({ code: 'failed-precondition' }, 'periods');
  w.parvritiFault({ code: 'unavailable' }, 'board');
  w.parvritiFault(undefined, 'doodles');
  w.parvritiFaults.flush();
  const o = outbox(w);
  check('permission-denied from a page listener is recorded as denied, naming the page', o.some(e => e.k === 'denied' && /flight log/.test(e.m)));
  check('failed-precondition is recorded as a firestore fault', o.some(e => e.k === 'firestore' && /periods/.test(e.m)));
  check('a tunnel from a page listener is not', !o.some(e => /board/.test(e.m)));
  check('a missing error object does not throw and is still noted', o.some(e => /doodles/.test(e.m)));
  check('none of it put anything on screen', w.document.querySelectorAll('.mini-toast').length === 0);
  // the seven hand-offs are really in the page scripts, inside the listener error callbacks
  const want = { 'board.js': ["'board'"], 'doodle.js': ["'doodles'", "'doodle shelf'"], 'periods.js': ["'periods'"], 'flight.js': ["'flight'", "'flight log'"], 'open-when.js': ["'letter receipts'"] };
  for (const f in want) {
    const src = fs.readFileSync(R + '/js/' + f, 'utf8');
    const okAll = want[f].every(w2 => new RegExp("\\}, function \\(e\\) \\{\\s*if \\(window\\.parvritiFault\\) window\\.parvritiFault\\(e, " + w2).test(src));
    check(f + ': every listener error callback hands its error over', okAll);
  }
}

console.log('\nF. delivery: one write, rarely, and never a storm');
{
  const { w } = await boot({});
  fire(w, 'first', 'https://parvriti.github.io/js/board.js?v=150', 1);
  fire(w, 'second', 'https://parvriti.github.io/js/doodle.js?v=150', 2);
  w.parvritiFaults.flush();
  const readsBefore = w.__reads.faults || 0;
  let r = await w.parvritiFaults.deliver(false);
  let s = faultSets(w);
  check('delivers in ONE write to faults/<me>', r === 'sent' && s.length === 1 && s[0].path === 'faults/parv', r + ' ' + JSON.stringify(s.map(x => x.path)));
  check('as a merge, so it never replaces what the other devices wrote', s[0].o && s[0].o.merge === true);
  const keys = Object.keys(s[0].d.f);
  check('keyed by fault + this device, so two devices never overwrite each other', keys.length === 2 && keys.every(k => /^[a-z0-9]+_[a-z0-9]{4}$/.test(k)), keys.join(','));
  check('each entry says which kind of device it came from', Object.values(s[0].d.f).every(e => typeof e.d === 'string' && e.d.length));
  check('delivery costs zero reads', (w.__reads.faults || 0) === readsBefore);
  r = await w.parvritiFaults.deliver(false);
  check('a second delivery straight after is throttled (6 hours)', r === 'throttled' && faultSets(w).length === 1, r);
  const sent = JSON.parse(w.localStorage.getItem('parvritiFaultSent'));
  sent._at = Date.now() - 7 * H; w.localStorage.setItem('parvritiFaultSent', JSON.stringify(sent));
  r = await w.parvritiFaults.deliver(false);
  check('after 6 hours with nothing new: no write at all', r === 'none' && faultSets(w).length === 1, r);
  await sleep(5);
  fire(w, 'second', 'https://parvriti.github.io/js/doodle.js?v=150', 2);   // the same fault again
  fire(w, 'third', 'https://parvriti.github.io/js/periods.js?v=150', 3);
  w.parvritiFaults.flush();
  r = await w.parvritiFaults.deliver(false);
  s = faultSets(w);
  const last = s[s.length - 1];
  check('then only what changed is sent', r === 'sent' && Object.keys(last.d.f).length === 2, r + ' ' + JSON.stringify(Object.values(last.d.f).map(e => e.m)));
  check('a repeat carries its running count', Object.values(last.d.f).some(e => e.m === 'second' && e.n === 2));
}
{
  // the rule is not published yet (or the quota is gone): the write is denied
  const { w } = await boot({ setFail: 'permission-denied' });
  fire(w, 'kept', 'https://parvriti.github.io/js/board.js?v=150', 5);
  w.parvritiFaults.flush();
  const before = JSON.stringify(outbox(w));
  const r = await w.parvritiFaults.deliver(false);
  await sleep(20);
  check('a denied delivery reports failed', r === 'failed', r);
  check('the faults stay on the phone for later', JSON.stringify(outbox(w)) === before);
  w.parvritiFaults.flush();
  check('and the failure is NOT itself recorded (a quota-out would feed itself)', !outbox(w).some(e => /denied|permission/.test(e.m)), JSON.stringify(outbox(w)));
  check('no toast, nothing on screen', w.document.querySelectorAll('.mini-toast').length === 0);
  const r2 = await w.parvritiFaults.deliver(false);
  check('and it does not retry until 6 hours have passed', r2 === 'throttled', r2);
}
{
  // month-old entries this phone delivered are taken back out as it passes
  const { w } = await boot({ pre: "localStorage.setItem('parvritiDeviceId','ab12'); localStorage.setItem('parvritiFaultSent', JSON.stringify({ oldsig: Date.now() - 31*86400000, _at: 0 }));" });
  fire(w, 'fresh', 'https://parvriti.github.io/js/board.js?v=150', 1);
  w.parvritiFaults.flush();
  await w.parvritiFaults.deliver(false);
  const s = faultSets(w)[0];
  check('a delivered entry over a month old is deleted from the doc in the same write', s && s.d.f['oldsig_ab12'] === '__DELETE__', JSON.stringify(s && s.d.f));
  check('and forgotten locally', !('oldsig' in JSON.parse(w.localStorage.getItem('parvritiFaultSent'))));
}
{
  const { w } = await boot({ person: 'riti' });
  fire(w, 'hers', 'https://parvriti.github.io/js/open-when.js?v=150', 10);
  w.parvritiFaults.flush();
  await w.parvritiFaults.deliver(false);
  check("Riti's phone delivers to faults/riti, never Parv's doc", faultSets(w).length === 1 && faultSets(w)[0].path === 'faults/riti');
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('and Riti never reads the inbox or gets a dot', !w.__reads.faults && dot(w) === null, JSON.stringify(w.__reads));
}
{
  const { w } = await boot({});
  fire(w, 'auto', 'https://parvriti.github.io/js/board.js?v=150', 1);
  await sleep(10300);   // unlock() hands faults over by itself, 10 s after sign-in
  check('delivered automatically about 10 seconds after sign-in', faultSets(w).length === 1, JSON.stringify(faultSets(w).map(s => s.path)));
}

console.log('\nG. the Settings dot: a new fault is the LOWEST amber');
{
  const now = Date.now();
  const healthy = {
    'workerHealth/celebration': { at: now - 2 * H }, 'workerHealth/cycle': { at: now - 2 * H }, 'workerHealth/capsule': { at: now - 2 * H },
    'workerHealth/flight': { at: now - 10 * 60000 }, 'workerHealth/tokens': { at: now - 0.5 * H, parv: 4, riti: 1 }
  };
  const hers = (extra) => ({ f: { 'abc_1234': Object.assign({ s: 'abc', k: 'error', m: 'x', f: 'open-when.js', l: 12, last: now - H, d: 'iPhone', q: false, n: 3 }, extra || {}) } });
  const run = async (o) => { const b = await boot(o); b.w.parvritiRefreshDevAlert(); await sleep(80); return b.w; };

  let w = await run({ docs: Object.assign({}, healthy) });
  check('healthy and no faults: no dot', dot(w) === null, String(dot(w)));
  check('the faults check costs exactly 2 reads', w.__reads.faults === 2, JSON.stringify(w.__reads));
  check('and the cron + push checks still cost exactly 5', w.__reads.workerHealth === 5, JSON.stringify(w.__reads));

  w = await run({ docs: Object.assign({ 'faults/riti': hers() }, healthy) });
  check("a new fault on Riti's phone lights AMBER", dot(w) === 'amber', String(dot(w)));
  check('and says whose phone, which device, what and where', /Riti/.test(why(w)) && /iPhone/.test(why(w)) && /open-when\.js/.test(why(w)), why(w));

  w = await run({ docs: Object.assign({ 'faults/riti': hers(), 'faults/parv': { muted: { abc: true } } }, healthy) });
  check('muted: never lights it', dot(w) === null, String(dot(w)));
  w = await run({ docs: Object.assign({ 'faults/riti': hers(), 'faults/parv': { seenAt: now } }, healthy) });
  check('seen: does not light it', dot(w) === null, String(dot(w)));
  w = await run({ docs: Object.assign({ 'faults/riti': hers({ q: true }) }, healthy) });
  check('a quiet fault never lights it', dot(w) === null, String(dot(w)));
  w = await run({ docs: Object.assign({ 'faults/riti': hers({ last: now - 31 * D }) }, healthy) });
  check('over a month old: does not light it', dot(w) === null, String(dot(w)));

  w = await run({ docs: Object.assign({ 'faults/riti': hers() }, healthy, { 'workerHealth/celebration': { at: now - 40 * H } }) });
  check('a dead cron still outranks it: ROSE', dot(w) === 'rose' && /cron has not run/.test(why(w)), dot(w) + ' ' + why(w));
  w = await run({ docs: Object.assign({ 'faults/riti': hers() }, healthy), pre: "localStorage.setItem('parvritiUpdateFailed', String(Date.now()));" });
  check('a stuck upgrade outranks it in the message', dot(w) === 'amber' && /failed to install/.test(why(w)), why(w));

  w = await run({ docs: Object.assign({ 'faults/riti': hers() }), pre: "sessionStorage.setItem('parvritiDevAlert','rose');" });
  check('crons unreadable + a standing rose: an outage never downgrades rose to amber', dot(w) === 'rose', String(dot(w)));
  w = await run({ docs: Object.assign({ 'faults/riti': hers() }) });
  check('crons unreadable, nothing standing: the new fault still speaks (amber)', dot(w) === 'amber', String(dot(w)));

  w = await run({ docs: Object.assign({}, healthy), getFail: ['faults'] });
  check('inbox unreadable and nothing known: unknown, no dot invented', dot(w) === null, String(dot(w)));
  w = await run({ docs: Object.assign({}, healthy), getFail: ['faults'], pre: "sessionStorage.setItem('parvritiFaultLast', JSON.stringify({ state: 'new', why: '1 new fault, latest on Riti (iPhone): error' }));" });
  check('inbox unreadable but a new fault was KNOWN: the amber stands', dot(w) === 'amber' && /Riti/.test(why(w)), dot(w) + ' ' + why(w));

  w = await run({ docs: Object.assign({}, healthy), pre: "localStorage.setItem('parvritiFaultOutbox', JSON.stringify([{ s:'zz', k:'error', m:'local', f:'board.js', l:1, first: Date.now(), last: Date.now(), n:1, q:false }]));" });
  check("a fault on Parv's own device lights it before it is even delivered", dot(w) === 'amber' && /this device/.test(why(w)), dot(w) + ' ' + why(w));
}

console.log('\nH. the Developer panel Faults card');
{
  let body = devHtml.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const now = Date.now();
  async function panel(o) {
    const opt = Object.assign({ docs: {}, deny: false, denyWrite: false, prefs: null, local: [], devId: 'me01' }, o);
    const stub = `
      var DOCS = ${JSON.stringify(opt.docs)}, DENY = ${opt.deny}, DENYW = ${opt.denyWrite};
      ${opt.prefs ? `localStorage.setItem('parvritiFaultPrefs', ${JSON.stringify(JSON.stringify(opt.prefs))});` : ''}
      window.parvritiFaultPrefs = { read: function () { return JSON.parse(localStorage.getItem('parvritiFaultPrefs') || '{}'); }, save: function (m) { localStorage.setItem('parvritiFaultPrefs', JSON.stringify({ muted: m.muted || {}, seenAt: m.seenAt || 0 })); } };
      window.__sets = []; window.__refresh = 0;
      var db = { collection: function (name) { return {
        doc: function (id) { var path = name + '/' + id; return {
          get: function () {
            if (name === 'faults' && DENY) return Promise.reject({ code: 'permission-denied' });
            var v = DOCS[path]; return Promise.resolve({ exists: v !== undefined, data: function () { return v === undefined ? null : JSON.parse(JSON.stringify(v)); } });
          },
          set: function (d, o2) { window.__sets.push({ path: path, d: d, o: o2 }); if (DENYW) return Promise.reject({ code: 'permission-denied' }); if (name === 'faults' && !DENY) { var cur = DOCS[path] || {}; if (d.muted) { cur.muted = cur.muted || {}; for (var k in d.muted) { if (d.muted[k] === '__DELETE__') delete cur.muted[k]; else cur.muted[k] = d.muted[k]; } } if (d.seenAt) cur.seenAt = d.seenAt; DOCS[path] = cur; } return DENY ? Promise.reject({ code: 'permission-denied' }) : Promise.resolve(); }
        }; },
        get: function () { return Promise.resolve({ forEach: function () {}, size: 0 }); }
      }; } };
      var fsF = function () { return db; }; fsF.FieldValue = { delete: function () { return '__DELETE__'; } };
      window.firebase = { firestore: fsF, auth: function () { return { currentUser: null }; } };
      window.__parvritiUser = { person: 'parv' }; window.__parvritiAuthed = true;
      window.parvritiRefreshDevAlert = function () { window.__refresh++; };
      window.parvritiFaults = { local: function () { return ${JSON.stringify(opt.local)}; }, device: function () { return { id: '${opt.devId}', label: 'iPhone' }; } };
    `;
    const dom = new JSDOM(`<!doctype html><html><body data-page="dev">${body}<script>${stub}</script><script src="js/dev.js?v=150"></script><script>${devJs}</script></body></html>`,
      { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://parvriti.github.io/dev.html' });
    await sleep(220);
    return dom.window;
  }
  const card = w => w.document.getElementById('devFaults');
  const E = (s, extra) => Object.assign({ s, k: 'error', m: 'msg ' + s, f: 'board.js', l: 7, p: 'board', v: '150', n: 2, first: now - 2 * H, last: now - H, q: false, d: 'iPhone' }, extra || {});

  let w = await panel({ docs: {} });
  check('empty: says nothing has broken', /nothing has broken on either phone/.test(card(w).textContent), card(w).textContent.slice(0, 120));
  check('"Mark all seen" is disabled when there is nothing new', w.document.getElementById('devFaultSeen').disabled === true);

  w = await panel({ docs: {
    'faults/riti': { f: { 'a1_r001': E('a1', { m: '<img src=x onerror="window.__xss=1">', d: 'iPhone' }), 'q1_r001': E('q1', { q: true, m: 'Script error.' }) } },
    'faults/parv': { f: { 'b2_me01': E('b2', { d: 'iPad', last: now - 3 * H }) } }
  } });
  const t = card(w).textContent;
  check("lists Riti's phone and Parv's device, by device", /Riti · iPhone/.test(t) && /Parv · iPad/.test(t), t.slice(0, 200));
  check('shows kind, file:line, page and version', /error · board\.js:7 · on board · v150/.test(t), t.slice(0, 200));
  check('a message is shown as TEXT, never as markup', !card(w).querySelector('img') && !w.__xss && /<img/.test(t));
  check('counts distinct new faults the way the dot does', /2 new since you last looked/.test(t), t.slice(0, 120));
  const qRow = [...card(w).querySelectorAll('.dev-home-r')].find(r => /Script error/.test(r.textContent));
  check('a quiet fault says it never lights the dot, and has no Mute button', qRow && /never lights the dot/.test(qRow.textContent) && !qRow.querySelector('.dev-fault-mute'));

  check('opening the panel syncs the dot once, so Checks cannot contradict this card', w.__refresh === 1, 'refresh=' + w.__refresh);
  const refreshBefore = w.__refresh;
  const btn = card(w).querySelector('.dev-fault-mute[data-sig="a1"]');
  btn.click(); await sleep(80);
  const ms = w.__sets.find(s => s.d && s.d.muted);
  check('Mute writes to faults/parv as a merge', ms && ms.path === 'faults/parv' && ms.d.muted.a1 === true && ms.o.merge === true, JSON.stringify(ms));
  check('and re-checks the dot straight away', w.__refresh > refreshBefore, w.__refresh + ' vs ' + refreshBefore);
  check('the confirmation appears right under the card, not only at the top of the page', /never light the dot again/.test(w.document.getElementById('devFaultMsg').textContent), w.document.getElementById('devFaultMsg').textContent);
  const unBtn = card(w).querySelector('.dev-fault-mute[data-sig="a1"]');
  check('the row now offers Unmute', unBtn && unBtn.getAttribute('data-act') === 'unmute' && /muted/.test(unBtn.parentNode.textContent));
  unBtn.click(); await sleep(80);
  check('Unmute deletes the mute', w.__sets.some(s => s.d && s.d.muted && s.d.muted.a1 === '__DELETE__'));

  w.document.getElementById('devFaultSeen').click(); await sleep(80);
  const seen = w.__sets.find(s => s.d && s.d.seenAt);
  check('Mark all seen stores the time on faults/parv', seen && seen.path === 'faults/parv' && typeof seen.d.seenAt === 'number');
  check('after which nothing reads as new', /nothing new since you last looked/.test(card(w).textContent), card(w).textContent.slice(0, 100));

  w = await panel({ deny: true, local: [E('l1', { d: undefined, m: 'local one' })] });
  check('rule not published: says so', /publish the faults rule/.test(card(w).textContent), card(w).textContent.slice(0, 160));
  check("and still shows this device's own faults", /this device · not sent yet/.test(card(w).textContent) && /local one/.test(card(w).textContent));

  w = await panel({ docs: { 'faults/parv': { f: { 'l1_me01': E('l1', { last: now - H }) } } }, local: [E('l1', { last: now - H, d: undefined })] });
  check('a local fault already delivered is not listed twice', (card(w).textContent.match(/msg l1/g) || []).length === 1, card(w).textContent);

  // review fixes
  w = await panel({ docs: { 'faults/parv': { f: { 'l2_me01': E('l2', { last: now - 3 * H }) } } }, local: [E('l2', { last: now - 10 * 60000, n: 9, d: undefined })] });
  const t2 = card(w).textContent;
  check('a local copy FRESHER than its delivered one replaces that row, never a duplicate', (t2.match(/msg l2/g) || []).length === 1 && /newest not sent yet/.test(t2) && /9x/.test(t2), t2.slice(0, 220));

  w = await panel({ docs: { 'faults/riti': { f: { 'late_r001': E('late', { last: now - 5 * H, r: now - H }) } }, 'faults/parv': { seenAt: now - 3 * H } } });
  check('a fault that HAPPENED before "seen" but ARRIVED after it is still new on the card', /1 new since you last looked/.test(card(w).textContent), card(w).textContent.slice(0, 120));

  w = await panel({ docs: { 'faults/riti': { f: { 'a9_r001': E('a9') } } }, denyWrite: true });
  card(w).querySelector('.dev-fault-mute[data-sig="a9"]').click(); await sleep(80);
  const again = card(w).querySelector('.dev-fault-mute[data-sig="a9"]');
  check('a failed Mute says why and gives the button back', again && !again.disabled && /publish the faults rule first/.test(w.document.getElementById('devStatus').textContent), w.document.getElementById('devStatus').textContent);
  check('...and says it right under the card, where the tap was', /publish the faults rule first/.test(w.document.getElementById('devFaultMsg').textContent));
  const css = fs.readFileSync(R + '/css/styles.css', 'utf8');
  check('a long unbroken word in a message wraps instead of running off the card', /\.dev-home-r span \{[^}]*overflow-wrap: anywhere/.test(css));
  check('the Mute button is a full 44px tap target', /\.dev-fault-mute \{[^}]*min-height: 44px/.test(css));

  w = await panel({ deny: true, local: [E('c1', { last: now - 2 * H, d: undefined })], prefs: { muted: {}, seenAt: now - H } });
  check('inbox unreadable: the card judges by the last known "seen" time, like the dot', /nothing new since you last looked/.test(card(w).textContent), card(w).textContent.slice(0, 160));

  const devSrc = fs.readFileSync(R + '/js/dev.js', 'utf8');
  check('deep checks now probe the faults rule too', /\{ c: 'faults', want: 'read' \}/.test(devSrc));
}

console.log('\nI. the review fixes, in the real common.js');
{
  const now = Date.now();
  const healthy = {
    'workerHealth/celebration': { at: now - 2 * H }, 'workerHealth/cycle': { at: now - 2 * H }, 'workerHealth/capsule': { at: now - 2 * H },
    'workerHealth/flight': { at: now - 10 * 60000 }, 'workerHealth/tokens': { at: now - 0.5 * H, parv: 4, riti: 1 }
  };
  const run = async (o) => { const b = await boot(o); b.w.parvritiRefreshDevAlert(); await sleep(80); return b.w; };

  // 1. delivered late, after Parv tapped "Mark all seen"
  let w = await run({ docs: Object.assign({ 'faults/parv': { seenAt: now - 3 * H }, 'faults/riti': { f: { 'b_r001': { s: 'b', k: 'error', m: 'x', last: now - 5 * H, r: now - H, q: false, d: 'iPhone' } } } }, healthy) });
  check('a fault that happened before "seen" but ARRIVED after it lights the dot', dot(w) === 'amber', String(dot(w)));
  ({ w } = await boot({}));
  fire(w, 'late one', 'https://parvriti.github.io/js/board.js?v=150', 3); w.parvritiFaults.flush();
  await w.parvritiFaults.deliver(true);
  const sent1 = Object.values(faultSets(w)[0].d.f)[0];
  check('every delivered entry carries when it arrived', typeof sent1.r === 'number' && sent1.r >= sent1.last, JSON.stringify(sent1));

  // 2. loud stays loud
  ({ w } = await boot({}));
  w.parvritiFaults.record('sdk', 'Firebase did not load', '', 0, true); w.parvritiFaults.flush();
  w.parvritiFaults.record('sdk', 'Firebase did not load', '', 0, false); w.parvritiFaults.flush();
  let sdk = outbox(w).find(e => e.k === 'sdk');
  check('first seen offline (quiet), then online (loud): it becomes loud and stays loud', sdk && sdk.q === false && sdk.n === 2, JSON.stringify(sdk));
  w.parvritiFaults.record('sdk', 'Firebase did not load', '', 0, true); w.parvritiFaults.flush();
  sdk = outbox(w).find(e => e.k === 'sdk');
  check('a later quiet occurrence does not make it quiet again', sdk.q === false && sdk.n === 3, JSON.stringify(sdk));

  // 3. quiet faults stay out of the Checks card's session row
  ({ w } = await boot({}));
  fire(w, 'Script error.', '', 0);
  let log = JSON.parse(w.sessionStorage.getItem('parvritiDevLog') || '[]');
  check('a quiet fault does not touch the "faults this session" row', !log.some(e => /Script error/.test(e.detail)), JSON.stringify(log));
  w.parvritiFaults.record('load', 'script did not load', 'flight.js', 0, true);
  w.parvritiFaults.record('load', 'script did not load', 'flight.js', 0, false);
  log = JSON.parse(w.sessionStorage.getItem('parvritiDevLog') || '[]');
  check('...until it turns loud, then it appears once', log.filter(e => /flight\.js/.test(e.detail)).length === 1, JSON.stringify(log));

  // 4. inbox unreadable: this device's own outbox still counts, by the last known mute + seen
  const local = "localStorage.setItem('parvritiFaultOutbox', JSON.stringify([{ s:'lo', k:'error', m:'local', f:'board.js', l:1, first: Date.now()-7200000, last: Date.now()-7200000, n:1, q:false }]));";
  w = await run({ docs: Object.assign({}, healthy), getFail: ['faults'], pre: local });
  check("inbox unreadable: a fault on Parv's own device still lights it (the card shows it too)", dot(w) === 'amber' && /this device/.test(why(w)), dot(w) + ' ' + why(w));
  w = await run({ docs: Object.assign({}, healthy), getFail: ['faults'], pre: local + "localStorage.setItem('parvritiFaultPrefs', JSON.stringify({ muted: {}, seenAt: Date.now() - 3600000 }));" });
  check('...but not if the last known "seen" time is after it', dot(w) === null, String(dot(w)));
  w = await run({ docs: Object.assign({}, healthy), getFail: ['faults'], pre: local + "localStorage.setItem('parvritiFaultPrefs', JSON.stringify({ muted: { lo: true }, seenAt: 0 }));" });
  check('...nor if it was muted', dot(w) === null, String(dot(w)));
  w = await run({ docs: Object.assign({ 'faults/parv': { muted: { zz: true }, seenAt: 42 } }, healthy) });
  const prefs = JSON.parse(w.localStorage.getItem('parvritiFaultPrefs') || '{}');
  check('a successful read remembers the mute list + seen time for next time', prefs.muted && prefs.muted.zz === true && prefs.seenAt === 42, JSON.stringify(prefs));

  // 5. ordinary rejections from media and the share sheet are quiet
  ({ w } = await boot({}));
  const ab = new w.Error('The operation was aborted.'); ab.name = 'AbortError'; reject(w, ab);
  const na = new w.Error('The request is not allowed by the user agent'); na.name = 'NotAllowedError'; reject(w, na);
  w.parvritiFaults.flush();
  const vt = new w.Error('Transition was skipped'); vt.name = 'AbortError'; reject(w, vt);
  w.parvritiFaults.flush();
  check('a skipped page-to-page animation is not recorded at all (it happens on quick tab taps)', !outbox(w).some(e => /Transition/.test(e.m)), JSON.stringify(outbox(w)));
  check('an interrupted play (AbortError) is kept but quiet', outbox(w).some(e => /aborted/.test(e.m) && e.q));
  check('a playback that is not allowed yet (NotAllowedError) is kept but quiet', outbox(w).some(e => /not allowed/.test(e.m) && e.q));
  const ow = fs.readFileSync(R + '/js/open-when.js', 'utf8');
  check('the voice-note preview catches its own play() now', /const pr = a\.play\(\);\s*\n\s*if \(pr && pr\.catch\) pr\.catch/.test(ow));

  // 6. a month-old outbox entry is never sent (it would undo its own pruning)
  ({ w } = await boot({ pre: "localStorage.setItem('parvritiFaultOutbox', JSON.stringify([{ s:'old', k:'error', m:'old', f:'', l:0, first: Date.now()-40*86400000, last: Date.now()-31*86400000, n:1, q:false }]));" }));
  const r6 = await w.parvritiFaults.deliver(true);
  check('a month-old outbox entry is not sent', r6 === 'none' && faultSets(w).length === 0, r6);

  // 7. signing out makes every listener fail on purpose: not a fault
  ({ w } = await boot({}));
  w.__parvritiSigningOut = true;
  w.parvritiFsError({ code: 'permission-denied' }); w.parvritiFault({ code: 'permission-denied' }, 'board');
  w.parvritiFaults.flush();
  check('nothing is recorded while signing out', outbox(w).length === 0, JSON.stringify(outbox(w)));
  check('settings.js sets that flag before signing out', /window\.__parvritiSigningOut = true;[\s\S]{0,120}signOut\(\)/.test(fs.readFileSync(R + '/js/settings.js', 'utf8')));

  // 8. the overflow line is only loud if something loud folded into it
  ({ w } = await boot({}));
  for (let i = 0; i < 35; i++) w.parvritiFaults.record('error', 'quiet ' + String.fromCharCode(97 + (i % 26)) + (i > 25 ? 'x' : ''), 'f' + i + '.js', i + 1, true);
  await sleep(5);
  w.parvritiFaults.record('error', 'one more quiet', 'g.js', 1, true);   // folds into the overflow, making it the newest
  w.parvritiFaults.flush();
  let ov = outbox(w).find(e => e.k === 'overflow');
  check('an overflow of only quiet faults is quiet', ov && ov.q === true, JSON.stringify(ov));
  w.parvritiFaults.record('error', 'a loud one', 'z.js', 1, false); w.parvritiFaults.flush();
  ov = outbox(w).find(e => e.k === 'overflow');
  check('a loud fault folding in makes it loud', ov && ov.q === false, JSON.stringify(ov));

  // 9. a spray of quiet noise never pushes a real fault out of the 20-entry outbox
  ({ w } = await boot({}));
  w.parvritiFaults.record('error', 'the real one', 'board.js', 7, false); w.parvritiFaults.flush();
  await sleep(5);
  for (let i = 0; i < 25; i++) w.parvritiFaults.record('error', 'noise ' + String.fromCharCode(97 + i), 'n' + i + '.js', 1, true);
  w.parvritiFaults.flush();
  const kept = outbox(w);
  check('25 newer quiet faults do not evict an older loud one', kept.length === 20 && kept.some(e => e.m === 'the real one' && !e.q), kept.length + ' ' + kept.filter(e => !e.q).map(e => e.m).join(','));
}

console.log('\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
