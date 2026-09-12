import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const R = REPO_ROOT;
const common = fs.readFileSync(R + '/js/common.js', 'utf8');
const ow = fs.readFileSync(R + '/js/open-when.js', 'utf8');
const theme = fs.readFileSync(R + '/css/theme.css', 'utf8');
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ FAIL ') + n + (ok || !x ? '' : '  [' + x + ']')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error('slice miss ' + a); return s.slice(i, j); };

// ── A. renderLetterDot state machine (extracted from the real file) ──
console.log('\nA. renderLetterDot state machine');
{
  const fn = slice(common, '  function renderLetterDot(d) {', '  function toast(msg) {');
  const mk = (page, hidden) => {
    const dom = new JSDOM(`<!doctype html><body data-page="${page}"><script>
      var body = document.body, page = body.dataset.page || '';
      Object.defineProperty(document, 'hidden', { get: function(){ return ${hidden}; }, configurable: true });
      ${fn}
      window.render = renderLetterDot;
    </script></body>`, { runScripts: 'dangerously', url: 'https://parvriti.github.io/x.html' });
    return dom.window;
  };
  let w = mk('home', false);
  w.render(null);                     check('no presence doc: no dot', !w.document.body.hasAttribute('data-letter-dot'));
  w.render({});                       check('no letterAt: no dot', !w.document.body.hasAttribute('data-letter-dot'));
  w.render({ letterAt: 'nope' });     check('malformed letterAt: no dot, no NaN', !w.document.body.hasAttribute('data-letter-dot'));
  w.render({ letterAt: 5000 });       check('letterAt newer than seen (0): DOT on Home', w.document.body.getAttribute('data-letter-dot') === '1');
  check('session cache says 1 (for the no-flash restore on the next page)', w.sessionStorage.getItem('parvritiLetterDot') === '1');
  check('Home never marks it seen', w.localStorage.getItem('parvritiLetterSeen') === null);
  // same origin storage is per JSDOM instance, so carry state by hand
  const seenBefore = w.localStorage.getItem('parvritiLetterSeen');
  w = mk('open-when', true);          // on Letters but BACKGROUNDED: must not count as seen
  w.render({ letterAt: 5000 });       check('Letters page but hidden: dot stays, not seen', w.document.body.getAttribute('data-letter-dot') === '1' && w.localStorage.getItem('parvritiLetterSeen') === null);
  w = mk('open-when', false);         // on Letters, visible
  w.render({ letterAt: 5000 });       check('Letters page visible: marks seen = letterAt, dot off', !w.document.body.hasAttribute('data-letter-dot') && w.localStorage.getItem('parvritiLetterSeen') === '5000');
  check('session cache says 0', w.sessionStorage.getItem('parvritiLetterDot') === '0');
  w.render({ letterAt: 5000 });       check('same letter again: still off', !w.document.body.hasAttribute('data-letter-dot'));
  w.render({ letterAt: 9000 });       check('a NEWER letter while on Letters visible: seen advances, still off', w.localStorage.getItem('parvritiLetterSeen') === '9000' && !w.document.body.hasAttribute('data-letter-dot'));
  // back on another page with seen=9000: an even newer letter -> dot returns; an older stamp -> no dot (skew-proof)
  const w2 = mk('board', false); w2.localStorage.setItem('parvritiLetterSeen', '9000');
  w2.render({ letterAt: 9000 });      check('Board, seen=9000, letterAt=9000: no dot', !w2.document.body.hasAttribute('data-letter-dot'));
  w2.render({ letterAt: 12000 });     check('Board, letterAt=12000 > seen: DOT returns', w2.document.body.getAttribute('data-letter-dot') === '1');
  w2.render({ letterAt: 7000 });      check('an OLDER stamp than seen: no dot (clock skew cannot resurrect it)', !w2.document.body.hasAttribute('data-letter-dot'));
}

// ── B. saveForm stamps letterAt only for a note left for the OTHER person ──
console.log('\nB. saveForm -> parvritiLeftLetter gating');
{
  const saveSrc = slice(ow, 'let saving = false;', 'function delEntry(entry) {');
  const mk = (mode, side) => new JSDOM(`<!doctype html><body>
    <form id="owForm"><textarea id="owInBody">x</textarea><input id="owInTitle" value="T"><input id="owInEmoji" value=""><div id="owFormErr"></div><button type="submit" class="ow-save">Save</button></form>
    <script>
      var left = 0, resolveAdd;
      var db = { collection: function(){ return { add: function(){ return new Promise(function(r){ resolveAdd = r; }); }, doc: function(){ return { update: function(){ return new Promise(function(r){ resolveAdd = r; }); } }; } }; } };
      var formMode = '${mode}', currentSide = '${side}', formEnv = { emotion:'happy', emoji:'🌸', title:'Happy' }, formEntry = { id:'n1' }, pendingOpen = null, recData = null, recType = null;
      function mePerson(){ return 'parv'; } function closeAdd(){} function todayStr(){ return '2026-09-11'; } function serverTime(){ return 0; } function fmtDate(s){ return s; } function newKey(){ return 'k'; }
      window.parvritiNotify = function(){}; window.parvritiLeftLetter = function(){ left++; };
      ${saveSrc}
    </script></body>`, { runScripts: 'dangerously' }).window;
  let w = mk('new', 'riti'); w.saveForm(); w.resolveAdd(); await sleep(10);
  check('new note FOR Riti (I am Parv): stamped once', w.left === 1, 'left=' + w.left);
  w = mk('add', 'riti'); w.saveForm(); w.resolveAdd(); await sleep(10);
  check('add-to-envelope FOR Riti: stamped once', w.left === 1, 'left=' + w.left);
  w = mk('new', 'parv'); w.saveForm(); w.resolveAdd(); await sleep(10);
  check('note on MY OWN side: not stamped', w.left === 0, 'left=' + w.left);
  w = mk('edit', 'riti'); w.saveForm(); w.resolveAdd(); await sleep(10);
  check('editing an existing note: not stamped', w.left === 0, 'left=' + w.left);
}

// ── C. the real common.js: live dot from the presence listener, the write, the no-flash restore ──
console.log('\nC. real common.js load');
{
  const stub = (pre) => `
    ${pre}
    window.matchMedia = window.matchMedia || function(){ return { matches:false, addEventListener:function(){}, addListener:function(){} }; };
    window.__sets = []; window.__snaps = {};
    function authFn(){ return { setPersistence:function(){}, getRedirectResult:function(){ return Promise.resolve(null); }, onAuthStateChanged:function(cb){ window.__authCb = cb; }, signOut:function(){ return Promise.resolve(); }, currentUser:null }; }
    authFn.Auth = { Persistence:{ LOCAL:'local' } }; authFn.GoogleAuthProvider = function(){};
    function fsFn(){ return { collection:function(name){ return { doc:function(id){ return {
      set:function(d){ window.__sets.push({ path:name+'/'+id, d:d }); return Promise.resolve(); },
      get:function(){ return Promise.resolve({ exists:false, data:function(){ return {}; } }); },
      onSnapshot:function(cb, err){ window.__snaps[name+'/'+id] = cb; return function(){}; } }; } }; } }; }
    fsFn.FieldValue = { serverTimestamp:function(){ return 0; } };
    window.firebase = { apps:[], initializeApp:function(){}, auth:authFn, firestore:fsFn };`;
  const load = async (page, pre) => {
    const vc = new VirtualConsole(); const errs = []; vc.on('jsdomError', e => errs.push(String(e && e.message || e)));
    const dom = new JSDOM(`<!doctype html><html><body data-page="${page}"><div class="canvas"><div data-homestate></div></div><script>${stub(pre || '')}</script><script>${common}</script></body></html>`,
      { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://parvriti.github.io/' + page + '.html', virtualConsole: vc });
    await sleep(20); return { w: dom.window, errs };
  };
  // no-flash restore: cache says 1 before scripts run -> attribute present synchronously, before auth
  let { w, errs } = await load('board', "sessionStorage.setItem('parvritiLetterDot','1');");
  check('cached "1" on Board: attribute set at load, BEFORE auth (no blink on tab change)', w.document.body.getAttribute('data-letter-dot') === '1' && typeof w.__authCb === 'function');
  ({ w, errs } = await load('open-when', "sessionStorage.setItem('parvritiLetterDot','1');"));
  check('cached "1" on Letters page: restore skipped (being there = seen)', !w.document.body.hasAttribute('data-letter-dot'));
  // live path on Home: auth -> presence/riti snapshot carries letterAt -> dot
  ({ w, errs } = await load('home'));
  w.__authCb({ email: 'parvbajaj2000@gmail.com', emailVerified: true }); await sleep(60);
  check('boot + unlock clean', errs.length === 0, errs.join(' | '));
  check('presence/riti listener registered', typeof w.__snaps['presence/riti'] === 'function');
  w.__snaps['presence/riti']({ exists: true, data: () => ({ letterAt: 4242, atMs: 0, gone: true }) }); await sleep(10);
  check('snapshot with letterAt: DOT on', w.document.body.getAttribute('data-letter-dot') === '1', String(w.document.body.getAttribute('data-letter-dot')));
  check('no error from renderPresence/renderLastSeen on the Home DOM', errs.length === 0, errs.join(' | '));
  // the author-side write
  check('window.parvritiLeftLetter exists', typeof w.parvritiLeftLetter === 'function');
  w.parvritiLeftLetter(); await sleep(10);
  const stamp = w.__sets.filter(s => s.path === 'presence/parv' && s.d && s.d.letterAt).pop();
  check('parvritiLeftLetter merges {letterAt} into MY presence doc', !!stamp && typeof stamp.d.letterAt === 'number' && Object.keys(stamp.d).length === 1, JSON.stringify(stamp && stamp.d));
  // coming back to the Letters page marks it seen via visibilitychange
  ({ w, errs } = await load('open-when'));
  w.__authCb({ email: 'parvbajaj2000@gmail.com', emailVerified: true }); await sleep(60);
  w.__snaps['presence/riti']({ exists: true, data: () => ({ letterAt: 777, atMs: 0, gone: true }) }); await sleep(10);
  check('on Letters: snapshot marks seen=777, no dot', w.localStorage.getItem('parvritiLetterSeen') === '777' && !w.document.body.hasAttribute('data-letter-dot'));
}

// ── D. CSS: selectors target the right anchor; theme.css parses ──
console.log('\nD. CSS');
{
  const dom = new JSDOM(`<!doctype html><html><head><style>${theme}</style></head><body data-letter-dot="1"><nav class="proto-tabbar"><a class="proto-tab" data-p="index" href="#"></a><a class="proto-tab" data-p="open-when" href="#"></a></nav><nav class="proto-sidebar"><a class="ps-item" data-p="open-when" href="#"></a></nav></body></html>`);
  const d = dom.window.document;
  check('tab selector matches ONLY the Letters tab', d.querySelectorAll('body[data-letter-dot="1"] .proto-tab[data-p="open-when"]').length === 1 && !d.querySelector('.proto-tab[data-p="index"]').matches('body[data-letter-dot="1"] .proto-tab[data-p="open-when"]'));
  check('sidebar selector matches the Letters item', !!d.querySelector('body[data-letter-dot="1"] .ps-item[data-p="open-when"]'));
  const sheet = d.styleSheets[0]; let rules = 0, base = 0, on = 0, kf = 0;
  for (const r of sheet.cssRules) { rules++; const st = r.selectorText || ''; if (/\[data-p="open-when"\]::after/.test(st) && !/data-letter-dot/.test(st)) base++; if (/data-letter-dot/.test(st)) on++; if (r.type === 7) kf++; }
  check('theme.css parsed; base (hidden) dot rule + on-state rule present, no keyframes', rules > 50 && base >= 1 && on >= 2 && kf === 0, 'rules=' + rules + ' base=' + base + ' on=' + on + ' kf=' + kf);
  const baseRule = [...sheet.cssRules].find(r => /\.proto-tab\[data-p="open-when"\]::after, \.ps-item/.test(r.selectorText || ''));
  check('base rule hides via scale(0)/opacity 0 and declares a transition (not an animation)', !!baseRule && /scale\(0\)/.test(baseRule.style.transform) && baseRule.style.opacity === '0' && /transform/.test(baseRule.style.transition) && !baseRule.style.animation, baseRule && baseRule.cssText.slice(0, 160));
  const open = (theme.match(/{/g) || []).length, close = (theme.match(/}/g) || []).length;
  check('theme.css braces balanced', open === close, open + ' vs ' + close);
}

console.log('\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
