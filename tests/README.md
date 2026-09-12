# Tests

Regression suites for the app. Nothing here is served by the site.

    npm install --prefix tests          # jsdom + playwright-core
    npx playwright install webkit       # only for the browser suites
    bash tests/run.sh

Node alone runs six of the nine suites. The three browser suites need WebKit,
which is the engine iOS Safari uses, so they catch layout and canvas behaviour
that jsdom cannot. They skip with a clear message when it is missing.

| suite | what it protects |
|---|---|
| `worker.test.mjs` | the whole Worker against a fake Firestore, with real RSA/JWT signing: arrivals and the dedup-after-leave rule, Together never being cleared by an unreadable partner record, admin-only endpoints, the birthday catch-up, cron heartbeats, and that no push-token string can leave the worker |
| `common-boot.test.mjs` | common.js boots cleanly and every Firestore listener gets a real error handler |
| `letters-dot.test.mjs` | the Letters tab dot: when it shows, when it clears, and that clock skew cannot resurrect it |
| `settings-dot.test.mjs` | the Settings dot: rose for a dead cron or a lost push target, amber for a stuck upgrade, and above all that unknown never becomes failure |
| `dev-checks.test.mjs` | the Developer panel's checks, including that worker-only collections denying a read is not reported as a fault |
| `client.test.mjs` | double-tap Save writing once, the seed read-receipt race, and the fault log's exclusions |
| `doodle-paint.test.cjs` | the watercolor fast path is pixel-identical to a full repaint, including a stroke arriving mid-stroke. Uses synthetic strokes, never real doodles |
| `chrome-layout.test.cjs` | the gear stays fixed in its corner. This exists because an ID selector once dragged it to the bottom of the page and a selector-only test did not notice |
| `dot-visual.test.cjs` | the app itself decides the dot from health data, rendered in WebKit, rather than the test setting it by hand |

Two rules worth keeping:

1. **Assert rendered layout, not just selectors.** Every bug these suites missed was
   one where the selector matched but the page looked wrong.
2. **No private data.** Suites build their own fixtures. If you ever need real
   content to reproduce something, keep it out of the repo.
