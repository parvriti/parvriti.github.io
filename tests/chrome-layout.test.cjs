/* The fixed chrome must STAY fixed. This suite exists because an ID selector
   once outranked .proto-corner, turned the settings gear from fixed to relative,
   and dropped it to the bottom of the page. A selector-only test did not notice,
   because the selector still matched. So: assert real computed layout. */
let webkit;
try { ({ webkit } = require('playwright-core')); }
catch (e) { console.log('SKIP: playwright-core is not installed. Run: npm install --prefix tests'); process.exit(0); }
const fs = require('fs');
const REPO_ROOT = require('path').join(__dirname, '..');

let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ FAIL ') + n + (ok || !x ? '' : '  [' + x + ']')); };

function harness() {
  let html = fs.readFileSync(REPO_ROOT + '/index.html', 'utf8').replace(/<script\s+src=[^>]*><\/script>\s*/g, '');
  return html.replace('</body>', `
<style>.proto-tabbar{padding-bottom:41px!important}body{padding-bottom:108px!important}.love-fab{bottom:120px!important}.proto-corner{top:69px!important}</style>
<script>
(function(){
  var Q = new URLSearchParams(location.search);
  // common.js OWNS this attribute and re-applies it from the session at unlock,
  // so seed the session rather than the attribute or it gets cleared
  if (Q.get('d')) { try { sessionStorage.setItem('parvritiDevAlert', Q.get('d')); } catch(e){} }
  if (Q.get('letter')) document.body.setAttribute('data-letter-dot', '1');
  function authFn(){ return { setPersistence:function(){}, getRedirectResult:function(){ return Promise.resolve(null); },
    onAuthStateChanged:function(cb){ window.__authCb = cb; }, signOut:function(){ return Promise.resolve(); }, currentUser:null }; }
  authFn.Auth = { Persistence: { LOCAL:'local' } }; authFn.GoogleAuthProvider = function(){};
  function fsFn(){ return { collection:function(){ return { doc:function(){ return {
    set:function(){ return Promise.resolve(); }, get:function(){ return Promise.resolve({ exists:false, data:function(){ return {}; } }); },
    onSnapshot:function(){ return function(){}; } }; } }; } }; }
  fsFn.FieldValue = { serverTimestamp:function(){ return 0; } };
  window.firebase = { apps:[], initializeApp:function(){}, auth:authFn, firestore:fsFn };
  document.documentElement.classList.remove('plaunch-on');
})();
</script>
<script src="js/common.js"></script>
<script src="js/native.js"></script></body>`);
}

(async () => {
  let b;
  try { b = await webkit.launch(); }
  catch (e) { console.log('SKIP: no webkit browser build. Run: npx playwright install webkit'); return; }

  for (const theme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await ctx.addInitScript(t => { try { localStorage.setItem('parvritiTheme', t); } catch (e) {} }, theme);
    await ctx.route('https://parvriti.github.io/**', r => {
      const p = new URL(r.request().url()).pathname;
      if (p === '/_h.html') return r.fulfill({ body: harness(), contentType: 'text/html; charset=utf-8' });
      const f = REPO_ROOT + p;
      return fs.existsSync(f) && fs.statSync(f).isFile() ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: '' });
    });
    const page = await ctx.newPage();
    await page.goto('https://parvriti.github.io/_h.html?d=rose&letter=1', { waitUntil: 'load' });
    await page.evaluate(() => window.__authCb({ email: 'parvbajaj2000@gmail.com', emailVerified: true }));
    await page.waitForSelector('#protoGear');
    await page.waitForTimeout(250);

    const m = await page.evaluate(() => {
      const g = document.getElementById('protoGear'), gr = g.getBoundingClientRect();
      const bar = document.querySelector('.proto-tabbar'), br = bar.getBoundingClientRect();
      const tab = document.querySelector('.proto-tab[data-p="open-when"]');
      const dot = getComputedStyle(g, '::after'), ldot = getComputedStyle(tab, '::after');
      const fab = document.querySelector('.love-fab');
      return {
        gearPos: getComputedStyle(g).position, gearTop: Math.round(gr.top), gearRight: Math.round(innerWidth - gr.right),
        gearSize: Math.round(gr.width) + 'x' + Math.round(gr.height),
        gearDot: dot.content === '""' ? dot.backgroundColor : 'none',
        barPos: getComputedStyle(bar).position, barBottom: Math.round(innerHeight - br.bottom),
        lettersDot: ldot.content === '""' && ldot.opacity === '1' ? ldot.backgroundColor : 'none',
        fabPos: fab ? getComputedStyle(fab).position : 'absent',
        overlap: !!(fab && gr.bottom > fab.getBoundingClientRect().top && gr.right > fab.getBoundingClientRect().left)
      };
    });

    check(theme + ': gear is FIXED (not relative)', m.gearPos === 'fixed', m.gearPos);
    check(theme + ': gear sits in the top right', m.gearTop < 120 && m.gearRight < 40, 'top' + m.gearTop + ' right' + m.gearRight);
    check(theme + ': gear keeps its 38px size', m.gearSize === '38x38', m.gearSize);
    check(theme + ': the settings dot renders on it', m.gearDot !== 'none', m.gearDot);
    check(theme + ': the tab bar is still pinned to the bottom', m.barPos === 'fixed' && m.barBottom === 0, m.barPos + ' ' + m.barBottom);
    check(theme + ': the Letters dot still renders', m.lettersDot !== 'none', m.lettersDot);
    check(theme + ': gear does not collide with the heart button', !m.overlap);
    await ctx.close();
  }
  await b.close();
  console.log('\nPASS ' + pass + '  FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})();
