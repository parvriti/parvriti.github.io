let webkit;
try { ({ webkit } = require('playwright-core')); }
catch (e) { console.log('SKIP: playwright-core is not installed. Run: npm install --prefix tests'); process.exit(0); }
const fs = require('fs');
const REPO_ROOT = require('path').join(__dirname, '..');
const REPO = REPO_ROOT;
const OUT = __dirname + '/.shots'; fs.mkdirSync(OUT, { recursive: true });
const H = 3600000;

function harness(page) {
  let html = fs.readFileSync(REPO + '/' + page, 'utf8').replace(/<script\s+src=[^>]*><\/script>\s*/g, '');
  return html.replace('</body>', `
<style>.proto-tabbar{padding-bottom:41px!important}body{padding-bottom:108px!important}.love-fab{bottom:120px!important}.proto-corner{top:69px!important}</style>
<script>
(function(){
  var Q = new URLSearchParams(location.search), now = Date.now();
  var CR = { celebration: now - (+Q.get('celeb') || 2) * ${H}, cycle: now - 2 * ${H}, capsule: now - 2 * ${H}, flight: now - 600000 };
  var TOK = Q.get('tok') === 'none' ? null : { at: now - 1800000, parv: 4, riti: +(Q.get('riti') === null ? 1 : Q.get('riti')) };
  if (Q.get('base')) { try { localStorage.setItem('parvritiTokenBase', Q.get('base')); } catch(e){} }
  if (Q.get('updfail')) { try { localStorage.setItem('parvritiUpdateFailed', String(now)); } catch(e){} }
  try { sessionStorage.setItem('riti_open', '1'); } catch(e){}   // common.js bounces an inner page opened directly
  function authFn(){ return { setPersistence:function(){}, getRedirectResult:function(){ return Promise.resolve(null); },
    onAuthStateChanged:function(cb){ window.__authCb = cb; }, signOut:function(){ return Promise.resolve(); }, currentUser:null }; }
  authFn.Auth = { Persistence: { LOCAL: 'local' } }; authFn.GoogleAuthProvider = function(){};
  function fsFn(){ return { collection:function(name){ return { doc:function(id){ return {
    set:function(){ return Promise.resolve(); },
    get:function(){
      if (name === 'workerHealth') {
        if (id === 'tokens') return Promise.resolve({ exists: !!TOK, data:function(){ return TOK; } });
        return Promise.resolve({ exists: CR[id] !== undefined, data:function(){ return { at: CR[id] }; } });
      }
      return Promise.resolve({ exists:false, data:function(){ return {}; } });
    },
    onSnapshot:function(){ return function(){}; } }; } }; } }; }
  fsFn.FieldValue = { serverTimestamp:function(){ return 0; } };
  window.firebase = { apps:[], initializeApp:function(){}, auth:authFn, firestore:fsFn };
  var dc = document.querySelector('[data-daycounter]');
  if (dc) dc.innerHTML = '<span class="dc-flower">\\u{1F338}</span><b>2,602</b> days of us';
  document.documentElement.classList.remove('plaunch-on');
})();
</script>
<script src="js/common.js?v=148"></script>
<script src="js/native.js?v=148"></script></body>`);
}

(async () => {
  let b;
  try { b = await webkit.launch(); }
  catch (e) { console.log('SKIP: no webkit browser build. Run: npx playwright install webkit'); return; }
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('parvritiTheme', 'light'); } catch (e) {} });
  await ctx.route('https://parvriti.github.io/**', r => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/_h.html') return r.fulfill({ body: harness('index.html'), contentType: 'text/html; charset=utf-8' });
    if (p === '/_s.html') return r.fulfill({ body: harness('settings.html'), contentType: 'text/html; charset=utf-8' });
    const f = REPO + p;
    return fs.existsSync(f) && fs.statSync(f).isFile() ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: '' });
  });

  const cases = [
    { n: 'healthy',     q: '',                                    want: null,    label: 'everything healthy' },
    { n: 'rose-cron',   q: '?celeb=40',                           want: 'rose',  label: 'midnight cron has not run in 40h' },
    { n: 'amber-upd',   q: '?updfail=1',                          want: 'amber', label: 'an update failed to install' },
    { n: 'rose-token',  q: '?riti=0&base=' + encodeURIComponent('{"parv":4,"riti":1}'), want: 'rose', label: "Riti's last push target is gone" }
  ];
  const results = [];
  for (const c of cases) {
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('https://parvriti.github.io/_h.html' + c.q, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.__authCb({ email: 'parvbajaj2000@gmail.com', emailVerified: true }));
    await page.waitForSelector('#protoGear');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.parvritiRefreshDevAlert && window.parvritiRefreshDevAlert());
    await page.waitForTimeout(500);
    const got = await page.evaluate(() => {
      const g = document.getElementById('protoGear'), cs = getComputedStyle(g, '::after'), r = g.getBoundingClientRect();
      return { attr: document.body.getAttribute('data-dev-alert'), why: (() => { try { return sessionStorage.getItem('parvritiDevAlertWhy'); } catch (e) { return ''; } })(),
               dotColor: cs.content === '""' ? cs.backgroundColor : 'none', gearTop: Math.round(r.top), gearRight: Math.round(innerWidth - r.right), pos: getComputedStyle(g).position };
    });
    await page.screenshot({ path: `${OUT}/dot-${c.n}.png`, clip: { x: 240, y: 40, width: 153, height: 110 } });
    results.push({ case: c.label, expected: c.want, got: got.attr, why: got.why, dotColor: got.dotColor, gear: got.pos + ' top' + got.gearTop + ' right' + got.gearRight, errors: errs.length });
    await page.close();
  }
  // the Developer row inside Settings
  const sp = await ctx.newPage();
  await sp.goto('https://parvriti.github.io/_s.html?celeb=40', { waitUntil: 'load' });
  await sp.evaluate(() => document.fonts.ready);
  await sp.evaluate(() => window.__authCb({ email: 'parvbajaj2000@gmail.com', emailVerified: true }));
  await sp.waitForTimeout(300);
  await sp.evaluate(() => window.parvritiRefreshDevAlert && window.parvritiRefreshDevAlert());
  await sp.waitForTimeout(500);
  const dev = await sp.locator('.set-devlink').first();
  await dev.screenshot({ path: OUT + '/dot-devrow.png' });
  results.push({ case: 'Developer row in Settings', expected: 'rose', got: await sp.evaluate(() => document.body.getAttribute('data-dev-alert')), errors: 0 });
  await sp.close();
  await b.close();
  let ok = 0, bad = 0;
  for (const r of results) { const good = r.got === r.expected && r.errors === 0; good ? ok++ : bad++;
    console.log((good ? '  ✓ ' : '  ✗ FAIL ') + r.case.padEnd(38) + ' -> ' + String(r.got) + (r.dotColor ? '  ' + r.dotColor : '') + (r.why ? '  "' + r.why + '"' : '')); }
  console.log('\n' + ok + ' correct, ' + bad + ' wrong  (gear: ' + (results[0].gear || '') + ')');
})();
