import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const R = REPO_ROOT;
const common = fs.readFileSync(R + '/js/common.js', 'utf8');
const theme = fs.readFileSync(R + '/css/theme.css', 'utf8');
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ FAIL ') + n + (ok || !x ? '' : '  [' + x + ']')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = 3600000;

// load the REAL common.js with a stubbed firebase + caches, then force a dot re-check
async function boot(o) {
  const opt = Object.assign({ person: 'parv', crons: {}, caches: ['parvriti-v140'], pageV: '140', pre: '', tokens: null }, o);
  const stub = `
    window.matchMedia = window.matchMedia || function(){ return { matches:false, addEventListener:function(){}, addListener:function(){} }; };
    ${opt.pre}
    window.__reads = 0; window.__readsBy = {};
    var CRONS = ${JSON.stringify(opt.crons)};
    window.__TOK = ${JSON.stringify(opt.tokens)};
    function authFn(){ return { setPersistence:function(){}, getRedirectResult:function(){ return Promise.resolve(null); }, onAuthStateChanged:function(cb){ window.__authCb = cb; }, signOut:function(){ return Promise.resolve(); }, currentUser:null }; }
    authFn.Auth = { Persistence:{ LOCAL:'local' } }; authFn.GoogleAuthProvider = function(){};
    function fsFn(){ return { collection:function(name){ return { doc:function(id){ return {
      set:function(){ return Promise.resolve(); },
      get:function(){
        window.__reads++; window.__readsBy[name] = (window.__readsBy[name]||0)+1;
        if (name === 'workerHealth') {
          if (id === 'tokens') { var tk = window.__TOK; return Promise.resolve({ exists: !!tk, data: function () { return tk || null; } }); }
          if (CRONS.__fail) return Promise.reject({ code: 'unavailable' });
          var v = CRONS[id];
          return Promise.resolve({ exists: v !== undefined, data:function(){ return v === undefined ? null : { at: v }; } });
        }
        return Promise.resolve({ exists:false, data:function(){ return {}; } });
      },
      onSnapshot:function(){ return function(){}; } }; } }; } }; }
    fsFn.FieldValue = { serverTimestamp:function(){ return 0; } };
    window.firebase = { apps:[], initializeApp:function(){}, auth:authFn, firestore:fsFn };
    window.caches = { keys: function(){ return Promise.resolve(${JSON.stringify(opt.caches)}); } };
  `;
  const vc = new VirtualConsole(); const errs = []; vc.on('jsdomError', e => errs.push(String(e && e.message || e)));
  const dom = new JSDOM(`<!doctype html><html><body data-page="home"><div class="canvas"><div data-homestate></div></div>
    <script>${stub}</script><script src="js/common.js?v=${opt.pageV}"></script><script>${common}</script></body></html>`,
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://parvriti.github.io/index.html', virtualConsole: vc });
  await sleep(20);
  dom.window.__authCb({ email: opt.person === 'riti' ? 'aritika2000@gmail.com' : 'parvbajaj2000@gmail.com', emailVerified: true });
  await sleep(40);
  return { w: dom.window, errs, dom };
}
const dot = w => w.document.body.getAttribute('data-dev-alert');
const why = w => { try { return w.sessionStorage.getItem('parvritiDevAlertWhy') || ''; } catch (e) { return ''; } };

console.log('\nA. who sees it');
{
  const now = Date.now();
  let { w } = await boot({ person: 'riti', crons: { celebration: now - 99 * H, cycle: now, capsule: now, flight: now } });
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('Riti never gets a dot even with a dead cron', dot(w) === null, String(dot(w)));
  check('...and it costs her zero workerHealth reads', !w.__readsBy.workerHealth, JSON.stringify(w.__readsBy));
}

console.log('\nB. rose: a cron has stopped');
{
  const now = Date.now();
  let { w, errs } = await boot({ crons: { celebration: now - 40 * H, cycle: now - 2 * H, capsule: now - 2 * H, flight: now - 10 * 60000 } });
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('boot clean', errs.length === 0, errs.join('|'));
  check('40h-old midnight cron lights ROSE', dot(w) === 'rose', String(dot(w)));
  check('and names the cron', /celebration/.test(why(w)), why(w));
  check('costs exactly 5 reads: one per cron plus the push-target counts', w.__readsBy.workerHealth === 5, JSON.stringify(w.__readsBy));

  ({ w } = await boot({ crons: { celebration: now - 2 * H, cycle: now - 2 * H, capsule: now - 2 * H, flight: now - 10 * 60000 } }));
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('all crons healthy: no dot', dot(w) === null, String(dot(w)));

  ({ w } = await boot({ crons: { celebration: now - 2 * H, cycle: now - 2 * H, capsule: now - 2 * H, flight: now - 2.5 * H } }));
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('flight beat 2.5h old is NOT late (3h threshold, free crons run late)', dot(w) === null, String(dot(w)));
}

console.log('\nC. unknown must never become failure');
{
  const now = Date.now();
  let { w } = await boot({ crons: { __fail: true } });
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('offline / unreadable: no dot invented', dot(w) === null, String(dot(w)));

  ({ w } = await boot({ crons: { __fail: true }, pre: "sessionStorage.setItem('parvritiDevAlert','rose');" }));
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('offline keeps a PREVIOUS rose rather than clearing it', dot(w) === 'rose', String(dot(w)));

  ({ w } = await boot({ crons: { celebration: now - 2 * H } }));   // others missing entirely
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('a cron that never ran yet is unknown, not broken', dot(w) === null, String(dot(w)));
}

console.log('\nD. amber: a stuck upgrade');
{
  const now = Date.now();
  const healthy = { celebration: now - 2 * H, cycle: now - 2 * H, capsule: now - 2 * H, flight: now - 10 * 60000 };
  let { w } = await boot({ crons: healthy, pre: "localStorage.setItem('parvritiUpdateFailed', String(Date.now()));" });
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('an update that failed to install lights AMBER', dot(w) === 'amber', String(dot(w)));
  check('and says so', /failed to install/.test(why(w)), why(w));

  ({ w } = await boot({ crons: healthy, caches: ['parvriti-v139'], pageV: '140' }));
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('a FRESH version mismatch stays quiet (one stale nav after a deploy is by design)', dot(w) === null, String(dot(w)));

  ({ w } = await boot({ crons: healthy, caches: ['parvriti-v139'], pageV: '140', pre: "localStorage.setItem('parvritiVerSince', String(Date.now() - 15*60000));" }));
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('the same mismatch 15 min later lights AMBER', dot(w) === 'amber', String(dot(w)));

  ({ w } = await boot({ crons: healthy, caches: ['parvriti-v139', 'parvriti-v140'] }));
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('two app caches (activate never finished) lights AMBER', dot(w) === 'amber', String(dot(w)));

  ({ w } = await boot({ crons: { celebration: now - 40 * H, cycle: now - 2 * H, capsule: now - 2 * H, flight: now - 10 * 60000 }, pre: "localStorage.setItem('parvritiUpdateFailed', String(Date.now()));" }));
  w.parvritiRefreshDevAlert(); await sleep(60);
  check('a dead cron OUTRANKS a stuck upgrade (rose wins)', dot(w) === 'rose', String(dot(w)));
}

console.log('\nE. the cached verdict paints instantly on the next page');
{
  const { w } = await boot({ crons: { __fail: true }, pre: "sessionStorage.setItem('parvritiDevAlert','amber');" });
  check('attribute applied at unlock from the session cache, before any check runs', dot(w) === 'amber', String(dot(w)));
  check('and applying it costs zero workerHealth reads', !w.__readsBy.workerHealth, JSON.stringify(w.__readsBy));
}

console.log('\nF. the fault log is strictly scoped');
{
  const { w } = await boot({ crons: { __fail: true } });
  w.parvritiFsError({ code: 'resource-exhausted' });
  w.parvritiFsError({ code: 'permission-denied' });
  w.parvritiFsError({ code: 'unavailable' });     // a lift
  w.parvritiFsError({ code: 'cancelled' });       // iOS froze the app
  w.parvritiFsError(undefined);
  const log = JSON.parse(w.sessionStorage.getItem('parvritiDevLog') || '[]');
  check('quota and permission-denied are recorded', log.filter(e => e.kind === 'quota').length === 1 && log.filter(e => e.kind === 'denied').length === 1);
  check('unavailable / cancelled / undefined are NOT (they mean a tunnel, not a fault)', log.length === 2, JSON.stringify(log.map(e => e.kind)));
  for (let i = 0; i < 40; i++) w.parvritiFsError({ code: 'resource-exhausted' });
  const l2 = JSON.parse(w.sessionStorage.getItem('parvritiDevLog'));
  check('a burst of 40 identical faults collapses to ONE entry with a count', l2.length === 3 && l2[2].kind === 'quota' && l2[2].n === 40, JSON.stringify(l2.map(e => e.kind + ':' + e.n)));
  check('so one burst can never push the other faults out of the log', l2.some(e => e.kind === 'denied'));
}

console.log('\nG. CSS');
{
  const d = new JSDOM(`<!doctype html><html><head><style>${theme}</style></head><body data-dev-alert="amber">
    <a id="protoGear" class="proto-corner proto-right"></a><nav class="proto-sidebar"><a class="ps-item" data-p="settings"></a><a class="ps-item" data-p="board"></a></nav>
    <a class="set-card set-devlink"></a></body></html>`).window.document;
  check('gear carries the dot', !!d.querySelector('body[data-dev-alert] #protoGear'));
  check('sidebar Settings row carries it', !!d.querySelector('body[data-dev-alert] .ps-item[data-p="settings"]'));
  check('the in-Settings Developer row carries it', !!d.querySelector('body[data-dev-alert] .set-devlink'));
  check('a different sidebar row does not', !d.querySelector('.ps-item[data-p="board"]').matches('body[data-dev-alert] .ps-item[data-p="settings"]'));
  const rules = [...d.styleSheets[0].cssRules].filter(r => /data-dev-alert/.test(r.selectorText || ''));
  check('amber and rose are both styled', rules.length >= 4 && /e0a33a/.test(theme) && /e0506a/.test(theme));
  check('theme.css braces balanced', (theme.match(/{/g) || []).length === (theme.match(/}/g) || []).length);
}

console.log('\nH. a push target that died');
{
  const now = Date.now();
  const healthy = { celebration: now - 2 * H, cycle: now - 2 * H, capsule: now - 2 * H, flight: now - 10 * 60000 };
  const TOK = (p, r, ageH) => ({ at: now - (ageH || 0.5) * H, parv: p, riti: r });

  let { w } = await boot({ crons: healthy, tokens: TOK(4, 1) });
  w.parvritiRefreshDevAlert(); await sleep(80);
  check('both have a device: no dot', dot(w) === null, String(dot(w)));
  check('the healthy counts are remembered as the baseline', JSON.parse(w.localStorage.getItem('parvritiTokenBase') || '{}').riti === 1);

  ({ w } = await boot({ crons: healthy, tokens: TOK(4, 0), pre: "localStorage.setItem('parvritiTokenBase', JSON.stringify({parv:4, riti:1}));" }));
  w.parvritiRefreshDevAlert(); await sleep(80);
  check('a count that WAS healthy and is now zero lights ROSE', dot(w) === 'rose', String(dot(w)));
  check('and it names her', /Riti has no working push target/.test(why(w)), why(w));

  ({ w } = await boot({ crons: healthy, tokens: TOK(4, 0) }));
  w.parvritiRefreshDevAlert(); await sleep(80);
  check('somebody never seen with a device does NOT trigger it', dot(w) === null, String(dot(w)));

  ({ w } = await boot({ crons: healthy, tokens: TOK(4, 0), pre: "localStorage.setItem('parvritiTokenBase', JSON.stringify({parv:4, riti:0}));" }));
  w.parvritiRefreshDevAlert(); await sleep(80);
  check('accepted as normal (baseline 0): it stops nagging', dot(w) === null, String(dot(w)));

  ({ w } = await boot({ crons: healthy, tokens: TOK(4, 0, 9), pre: "localStorage.setItem('parvritiTokenBase', JSON.stringify({parv:4, riti:1}));" }));
  w.parvritiRefreshDevAlert(); await sleep(80);
  check('counts older than 6h are too stale to trust: unknown, not rose', dot(w) === null, String(dot(w)));

  ({ w } = await boot({ crons: healthy, tokens: null, pre: "localStorage.setItem('parvritiTokenBase', JSON.stringify({parv:4, riti:1}));" }));
  w.parvritiRefreshDevAlert(); await sleep(80);
  check('no counts written yet at all: unknown, not rose', dot(w) === null, String(dot(w)));

  ({ w } = await boot({ crons: { celebration: now - 40 * H, cycle: now - 2 * H, capsule: now - 2 * H, flight: now - 10 * 60000 }, tokens: TOK(4, 0), pre: "localStorage.setItem('parvritiTokenBase', JSON.stringify({parv:4, riti:1}));" }));
  w.parvritiRefreshDevAlert(); await sleep(80);
  check('a dead cron still outranks it in the message', /cron has not run/.test(why(w)), why(w));
}

console.log('\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
