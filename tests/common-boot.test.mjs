import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const common = fs.readFileSync(REPO_ROOT + '/js/common.js', 'utf8');
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ FAIL ') + n + (ok || !x ? '' : '  [' + x + ']')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const stub = `
  window.matchMedia = window.matchMedia || function(){ return { matches:false, addEventListener:function(){}, addListener:function(){} }; };
  window.__sets = []; window.__snaps = [];
  function authFn(){ return {
    setPersistence: function(){}, getRedirectResult: function(){ return Promise.resolve(null); },
    onAuthStateChanged: function(cb){ window.__authCb = cb; }, signOut: function(){ return Promise.resolve(); }, currentUser: null }; }
  authFn.Auth = { Persistence: { LOCAL: 'local' } }; authFn.GoogleAuthProvider = function(){};
  function fsFn(){ return { collection: function(name){ return { doc: function(id){ return {
    set: function(d){ window.__sets.push(name + '/' + id); return Promise.resolve(); },
    get: function(){ return Promise.resolve({ exists:false, data:function(){ return {}; } }); },
    onSnapshot: function(cb, err){ window.__snaps.push({ path: name + '/' + id, errIsFn: typeof err === 'function', err: err }); return function(){}; }
  }; } }; } }; }
  fsFn.FieldValue = { serverTimestamp: function(){ return 0; } };
  window.firebase = { apps: [], initializeApp: function(){}, auth: authFn, firestore: fsFn };
`;
const vc = new VirtualConsole(); const jsErrors = [];
vc.on('jsdomError', e => jsErrors.push(String(e && e.message || e)));
vc.on('error', (...a) => jsErrors.push(a.join(' ')));
const dom = new JSDOM(`<!doctype html><html><head></head><body data-page="home"><div class="canvas"><div data-homestate></div></div>
  <script>${stub}</script><script>${common}</script></body></html>`,
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://parvriti.github.io/index.html', virtualConsole: vc });
const w = dom.window;
await sleep(30);
check('common.js loaded with no uncaught error', jsErrors.length === 0, jsErrors.join(' | '));
check('auth callback wired', typeof w.__authCb === 'function');
w.__authCb({ email: 'parvbajaj2000@gmail.com', emailVerified: true });     // an allowed user -> unlock() -> startRealtime()
await sleep(80);                                                            // let the settings .get() resolve so setupHomeState registers
check('still no uncaught error after unlock()', jsErrors.length === 0, jsErrors.join(' | '));
check('window.parvritiFsError is a function', typeof w.parvritiFsError === 'function');
check('presence beat wrote presence/parv', w.__sets.includes('presence/parv'));
const paths = w.__snaps.map(s => s.path);
// these registrations sit AFTER the first fsError reference in startRealtime; if fsError were
// unresolvable the ReferenceError (silently swallowed at common.js:76) would have aborted before them
check('presence/riti listener registered (startRealtime got past beat().catch(fsError))', paths.includes('presence/riti'), paths.join(','));
check('pings/parv listener registered', paths.includes('pings/parv'));
check('homeState/riti listener registered (setupHomeState ran)', paths.includes('homeState/riti'));
check('homeState/together listener registered', paths.includes('homeState/together'));
check('every listener has a FUNCTION error handler (fsError resolved at all 4 sites)', w.__snaps.length >= 4 && w.__snaps.every(s => s.errIsFn), JSON.stringify(w.__snaps.map(s => [s.path, s.errIsFn])));
// end to end in the real file: feed one handler a quota error -> the toast must appear in the DOM
const h = w.__snaps.find(s => s.path === 'presence/riti').err;
h({ code: 'resource-exhausted' }); h({ code: 'resource-exhausted' });
await sleep(20);
const toasts = [...w.document.querySelectorAll('.mini-toast')];
check('quota error surfaces ONE .mini-toast in the DOM', toasts.length === 1, 'toasts=' + toasts.length);
check('toast copy is the quota line', toasts.length && /quota/.test(toasts[0].textContent) && /lunch/.test(toasts[0].textContent), toasts[0] && toasts[0].textContent);
h({ code: 'permission-denied' }); await sleep(10);
check('permission-denied adds no toast', w.document.querySelectorAll('.mini-toast').length === 1);
dom.window.close();
console.log('\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
