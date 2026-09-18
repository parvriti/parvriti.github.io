/* v150: the release guard. Runs scripts/release.sh preflight against a scratch copy of
   the site, with a fake curl on PATH, so it is fast and needs no network. Proves the
   guard passes a good tree and refuses the two traps it exists for: the push worker on a
   different Firebase SDK version than the pages, and Google no longer serving the SDK. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ FAIL ') + n + (ok || !x ? '' : '  [' + x + ']')); };

function scratch() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'parvriti-rel-'));
  for (const f of fs.readdirSync(R)) {
    if (/\.html$/.test(f) && !/^_qa_/.test(f)) fs.copyFileSync(path.join(R, f), path.join(d, f));
  }
  for (const f of ['sw.js', 'firebase-messaging-sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(R, f), path.join(d, f));
  for (const dir of ['js', 'css', 'scripts']) fs.cpSync(path.join(R, dir), path.join(d, dir), { recursive: true });
  fs.mkdirSync(path.join(d, 'push-worker'));
  fs.copyFileSync(path.join(R, 'push-worker/worker.js'), path.join(d, 'push-worker/worker.js'));
  // a fake curl: answers FAKE_CODE for every URL and logs what it was asked
  fs.mkdirSync(path.join(d, 'bin'));
  fs.writeFileSync(path.join(d, 'bin/curl'), '#!/bin/sh\nfor a in "$@"; do last="$a"; done\necho "$last" >> "$CURL_LOG"\nprintf "%s" "${FAKE_CODE:-200}"\n', { mode: 0o755 });
  return d;
}
function preflight(d, env) {
  const log = path.join(d, 'curl.log');
  // /bin/bash on purpose: macOS ships bash 3.2, and that is what the release is run with
  const r = spawnSync(fs.existsSync('/bin/bash') ? '/bin/bash' : 'bash', ['scripts/release.sh', 'preflight'], { cwd: d, encoding: 'utf8',
    env: Object.assign({}, process.env, { PATH: path.join(d, 'bin') + ':' + process.env.PATH, CURL_LOG: log }, env || {}) });
  const asked = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), asked };
}

console.log('\nA. a good tree passes, and the network half really looks');
{
  const d = scratch();
  const r = preflight(d);
  check('preflight passes on the tree as it is', r.code === 0, r.out.split('\n').filter(l => /✗/.test(l)).join(' | '));
  check('it confirms one SDK version everywhere, push worker included', /one Firebase SDK version everywhere, push worker included \(\d+\.\d+\.\d+\)/.test(r.out));
  check('it checked every Firebase SDK file the pages and the push worker load', r.asked.filter(u => /gstatic\.com\/firebasejs/.test(u)).length === 4, r.asked.join(' '));
  check('and the Google Fonts stylesheets', r.asked.some(u => /fonts\.googleapis\.com\/css2/.test(u)));
  check('and says so', /Google still serves all \d+ SDK and font files/.test(r.out));
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('\nB. Google stops serving the SDK');
{
  const d = scratch();
  const r = preflight(d, { FAKE_CODE: '404' });
  check('the bump is refused', r.code !== 0);
  check('naming what is gone', /not served \(HTTP 404\): https:\/\/www\.gstatic\.com\/firebasejs/.test(r.out));
  check('and it says not to push', /PREFLIGHT FAILED\. Do not push\./.test(r.out));
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('\nC. the push worker drifts to a different SDK version than the pages');
{
  const d = scratch();
  const sw = path.join(d, 'firebase-messaging-sw.js');
  fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/firebasejs\/[0-9.]+\//g, 'firebasejs/99.0.0/'));
  const r = preflight(d, { SKIP_NET: '1' });
  check('the bump is refused', r.code !== 0);
  check('because the versions differ', /differs between files/.test(r.out));
  check('SKIP_NET=1 skips only the network half, and says so', /SKIP_NET=1: did not check/.test(r.out) && !fs.existsSync(path.join(d, 'curl.log')));
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
