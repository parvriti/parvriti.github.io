import fs from 'fs';
import { JSDOM } from 'jsdom';
const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const REPO = REPO_ROOT;
const ow = fs.readFileSync(REPO + '/js/open-when.js', 'utf8');
const common = fs.readFileSync(REPO + '/js/common.js', 'utf8');
const devJs = fs.readFileSync(REPO + '/js/dev.js', 'utf8');
const devHtml = fs.readFileSync(REPO + '/dev.html', 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ FAIL ') + name + (ok || !extra ? '' : '  [' + extra + ']')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slice = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < 0) throw new Error('slice miss: ' + from); return src.slice(a, b); };

// ────────────────────────────────────────────────────────────────────────────
console.log('\nA. Letters: double-tap Save is a single write (in-flight lock)');
{
  const saveSrc = slice(ow, 'let saving = false;', 'function delEntry(entry) {');
  const html = `<!doctype html><body>
    <form id="owForm" class="show"><textarea id="owInBody">hello riti</textarea>
      <input id="owInTitle" value="T"><input id="owInEmoji" value="">
      <div id="owFormErr"></div><button type="submit" class="ow-save">Save</button></form>
    <script>
      var addCalls = 0, resolveAdd = null, rejectAdd = null, closeCalls = 0, notifyCalls = 0;
      var db = { collection: function () { return { add: function () { addCalls++; return new Promise(function (res, rej) { resolveAdd = res; rejectAdd = rej; }); },
                                                      doc: function () { return { update: function () { addCalls++; return new Promise(function (res, rej) { resolveAdd = res; rejectAdd = rej; }); } }; } }; } };
      var formMode = 'new', currentSide = 'riti', formEnv = null, formEntry = null, pendingOpen = null;
      var recData = null, recType = null;
      function mePerson() { return 'parv'; }
      function closeAdd() { closeCalls++; }
      function todayStr() { return '2026-09-11'; }
      function serverTime() { return 0; }
      function fmtDate(s) { return s; }
      function newKey() { return 'k1'; }
      window.parvritiNotify = function () { notifyCalls++; };
      ${saveSrc}
    </script></body>`;
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const w = dom.window, btn = w.document.querySelector('.ow-save');
  w.saveForm(); w.saveForm(); w.saveForm();          // three rapid taps while the write is pending
  check('only ONE notes.add() fired for three taps', w.addCalls === 1, 'addCalls=' + w.addCalls);
  check('Save button disabled while in flight', btn.disabled === true);
  check('form not closed yet', w.closeCalls === 0);
  w.resolveAdd(); await sleep(10);
  check('after the write lands: form closed once', w.closeCalls === 1, 'closeCalls=' + w.closeCalls);
  check('exactly one "left you a note" push', w.notifyCalls === 1, 'notifyCalls=' + w.notifyCalls);
  check('button re-enabled after success', btn.disabled === false);
  // a failing write must unlock too, or the form would be stuck forever
  w.saveForm(); await sleep(0); w.rejectAdd(new Error('boom')); await sleep(10);
  check('failed write: error shown', /couldn/.test(w.document.getElementById('owFormErr').textContent));
  check('failed write: button re-enabled', btn.disabled === false);
  check('a later Save works again (lock released)', (w.saveForm(), w.addCalls === 3), 'addCalls=' + w.addCalls);
  dom.window.close();
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\nB. Letters: seed read receipt waits for the read-state snapshot');
{
  const fnSrc = slice(ow, 'const openNotified = {};', '/* "on this day');
  const html = `<!doctype html><body><script>
    var setCalls = 0, notifyCalls = 0;
    var db = { collection: function () { return { doc: function () { return { set: function () { setCalls++; return Promise.resolve(); }, update: function () { return Promise.resolve(); } }; } }; } };
    var seedReads = {}, seedReadsLoaded = false;
    function isSealed() { return false; }
    function mePerson() { return 'riti'; }
    function seedReadKey(e) { return e.side + '_' + e.emotion; }
    window.parvritiNotify = function () { notifyCalls++; };
    ${fnSrc}
  </script></body>`;
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const w = dom.window;
  const seed = { seed: true, side: 'riti', emotion: 'anxious' }, env = { title: 'Anxious', emotion: 'anxious' };
  w.maybeNotifyOpen(seed, env);
  check('before the snapshot: NO receipt written', w.setCalls === 0, 'setCalls=' + w.setCalls);
  check('before the snapshot: NO push to the author', w.notifyCalls === 0);
  w.seedReadsLoaded = true; w.seedReads = { riti_anxious: { by: 'riti', at: 1 } };
  w.maybeNotifyOpen(seed, env);
  check('snapshot landed + already read: still nothing (no re-stamp, no re-push)', w.setCalls === 0 && w.notifyCalls === 0);
  w.seedReads = {};
  w.maybeNotifyOpen({ seed: true, side: 'riti', emotion: 'happy' }, { title: 'Happy', emotion: 'happy' });
  check('snapshot landed + genuinely unread: receipt written once', w.setCalls === 1, 'setCalls=' + w.setCalls);
  check('...and the author pushed once', w.notifyCalls === 1);
  dom.window.close();
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\nC. common.js: quota exhaustion is surfaced once, other errors stay quiet');
{
  const fnSrc = slice(common, 'var fsErrShown = false;', 'window.parvritiFsError = fsError;');
  const toasts = [];
  const logged = [];
  const recorded = [];
  const TRANSIENT = { 'unavailable': 1, 'cancelled': 1, 'aborted': 1, 'deadline-exceeded': 1, 'auth/network-request-failed': 1 };
  const fn = new Function('toast', 'console', 'devLog', 'recordFault', 'FAULT_TRANSIENT', fnSrc + '; return fsError;');
  const warned = [];
  const fsError = fn(m => toasts.push(m), { warn: (...a) => warned.push(a) }, (k) => logged.push(k),
    (kind, msg, f, l, quiet, noLog) => recorded.push({ kind, msg, quiet, noLog }), TRANSIENT);
  fsError({ code: 'resource-exhausted' }); fsError({ code: 'resource-exhausted' }); fsError({ code: 'resource-exhausted' });
  check('resource-exhausted: exactly one toast for repeated failures', toasts.length === 1, 'toasts=' + toasts.length);
  check('toast copy names the cause and the reset', /quota/.test(toasts[0]) && /lunch/.test(toasts[0]), toasts[0]);
  check('toast has no em dash', !/—/.test(toasts[0]));
  fsError({ code: 'permission-denied' }); fsError({ code: 'unavailable' }); fsError(undefined);
  check('permission-denied / unavailable / undefined: no extra toast', toasts.length === 1);
  check('permission-denied logged to console.warn', warned.length === 1);
  check('only real faults reach the dev log, not a tunnel', [...new Set(logged)].join(',') === 'quota,denied', logged.join(','));
  // v150: the same faults also reach the recorder (for the cross-phone inbox), without a second session-log line
  check('quota + denied reach the recorder, flagged not to double the session log',
    recorded.some(r => r.kind === 'quota' && r.noLog) && recorded.some(r => r.kind === 'denied' && r.noLog), JSON.stringify(recorded.slice(0, 3)));
  check('no tunnel (unavailable) ever reaches the recorder', !recorded.some(r => /unavailable/.test(r.msg)));
  const before = recorded.length, tBefore = toasts.length;
  fsError({ code: 'failed-precondition' }); fsError({ code: 'deadline-exceeded' }); fsError({ code: 'internal' });
  const added = recorded.slice(before);
  check('a real change underneath (failed-precondition, internal) IS recorded as a firestore fault', added.length === 2 && added.every(r => r.kind === 'firestore' && !r.quiet), JSON.stringify(added));
  check('deadline-exceeded is a tunnel: not recorded', !added.some(r => /deadline/.test(r.msg)));
  check('and none of them shows anyone a toast', toasts.length === tBefore);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\nD. Dev panel: Worker crons card');
{
  let body = devHtml.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  const mk = (health, deny) => `
    (function(){
      var now = Date.now(), H = 3600*1000;
      var SEED = {
        'homeState/riti':{atHome:true,since:now-H}, 'homeState/parv':{atHome:true,since:now-H}, 'homeState/together':{together:false,since:now-H},
        ${health}
      };
      function snap(d){ return { exists: !!d, data: function(){ return d; } }; }
      var db = { collection: function(name){ return {
        doc: function(id){ return { get: function(){
          if (name === 'workerHealth' && ${deny}) return Promise.reject({ code: 'permission-denied' });
          return Promise.resolve(snap(SEED[name+'/'+id])); } }; },
        get: function(){ return Promise.resolve({ forEach: function(){}, size:0 }); }
      }; } };
      window.firebase = { firestore: function(){ return db; }, auth: function(){ return { currentUser: { getIdToken: function(){ return Promise.resolve('FAKE'); } } }; } };
      window.__parvritiUser = { person:'parv' }; window.__parvritiAuthed = true;
    })();`;
  const run = async (health, deny) => {
    const dom = new JSDOM(`<!doctype html><html><body data-page="dev">${body}<script>${mk(health, deny)}</script><script>${devJs}</script></body></html>`, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/dev.html' });
    await sleep(250); const h = dom.window.document.getElementById('devHealth').innerHTML || dom.window.document.getElementById('devHealth').textContent; dom.window.close(); return h;
  };
  const H = 3600 * 1000, now = Date.now();
  // all fresh
  let h = await run(`'workerHealth/celebration':{at:${now - 2 * H}}, 'workerHealth/cycle':{at:${now - 3 * H}}, 'workerHealth/capsule':{at:${now - 3 * H}}, 'workerHealth/flight':{at:${now - 20 * 60 * 1000}}`, false);
  check('4 cron rows rendered', (h.match(/dev-home-r/g) || []).length === 4);
  check('all fresh: every row ok, no ⚠', /dev-home-r ok/.test(h) && !/⚠/.test(h), h.slice(0, 200));
  check('shows "last ran Nh ago"', /last ran 2\.0h ago/.test(h));
  // one stale daily cron + one that never ran
  h = await run(`'workerHealth/celebration':{at:${now - 40 * H}}, 'workerHealth/cycle':{at:${now - 3 * H}}, 'workerHealth/capsule':{at:${now - 3 * H}}`, false);
  check('40h-old midnight wish flagged ⚠ overdue', /Midnight wish[\s\S]*?⚠ overdue/.test(h));
  check('missing flight beat flagged "no heartbeat yet"', /Flight poll[\s\S]*?never ran[\s\S]*?⚠ no heartbeat yet/.test(h));
  check('healthy cycle row still ✓', /9am cycle nudge[\s\S]*?✓/.test(h));
  // rule not published
  h = await run(``, true);
  check('permission-denied: tells you to publish the rule', /publish the workerHealth read rule/.test(h), h);
}

console.log('\n───────────────\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
