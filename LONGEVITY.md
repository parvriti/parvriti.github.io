# Parvriti · Longevity Runbook

**Goal:** keep this app running for 10+ years with as little intervention as possible.
These are **not** code bugs (the code is static and stable) — they're the external
dependencies and free-tier limits that can rot on their own.

_Last audited: 2026-08-29 (v121)._

---

## The yearly ~10-minute check
1. Open **dev.html** → glance at the **storage** gauge (base64 media fills it).
2. **Settings → "Test → me"** (or long-press the heart FAB) → confirm a push still lands.
3. Make sure you've signed into **GitHub (`parvriti`), Firebase, Cloudflare, and all 3 Gmail
   accounts** within the past year, so none go dormant / get reclaimed.
4. If a **"couldn't save"** toast ever appears on Keep / Pin / Save a voice note → storage is
   full (see risk #1); prune old media.

---

## Built to last — no action needed
- **Dates count *up*, never toward a cliff.** "Days of us" and the anniversary "N years" are
  computed from 2019 with the live clock; cycle calendars use the current year. The `2026`
  in `periods.js` is a date-**validation sentinel** (rejects impossible dates like `2026-13-45`),
  not a deadline.
- **Every media doc is capped under Firestore's 1 MiB limit** — voice 900 KB, board photo 980 KB,
  kept doodle 950 KB. No single doc can ever exceed the ceiling.
- **Ephemeral data can't pile up** — `presence`, `pings`, `homeState`, `deviceTokens` are keyed
  by person/token (`.doc(id).set`), so they overwrite instead of accumulating.
- **Push tokens self-heal** — the client re-registers a fresh FCM token on every launch, and the
  worker prunes dead ones.
- **Fail-open everywhere** — an auth or push backend failure never bricks the app.
- **Cache-first service worker** — the app keeps working offline and through CDN blips.

---

## Risks over 10 years (ranked by likelihood)

### 1. Firestore storage → the 1 GiB Spark cap — *most likely to need action*
Kept doodles, board photos, and voice notes are ~1 MB base64 blobs stored in Firestore, and they
accumulate with **no auto-pruning** (by design — they're your memories). Roughly
**~1,000 media items ≈ 1 GiB.**
- **When full:** Spark *blocks new writes* (it never bills you). Keeping / pinning / saving starts
  failing with a "couldn't save" toast. Reads and everything else keep working — the app is not bricked.
- **Watch:** the storage gauge in `dev.html`. **Fix:** delete old media, or archive some.

### 2. Push notifications dying silently — Cloudflare Worker + service account
Push depends on the worker staying deployed (Cloudflare free tier), the **service-account key**
staying valid, and the GCP project staying active.
- SA keys don't auto-expire, but over a decade Google may enforce key rotation, and Cloudflare
  could change its free tier.
- You're on **FCM v1 (the current API)** — the legacy-FCM shutdowns do **not** affect you.
- **When it breaks:** notifications (thinking-of-you, got-home, cycle, birthdays) stop **silently**;
  the app keeps working, so you may not notice. The yearly push test catches it.
- Endpoint `https://parvriti-push.parvbajaj2000.workers.dev` · code in `push-worker/` · secrets in
  the Cloudflare dashboard (`SERVICE_ACCOUNT`, `FIREBASE_API_KEY`) + `push-worker/.dev.vars` (git-ignored).
- Crons (set in Cloudflare, mirrored in `wrangler.toml`): `30 18 * * *` = 00:00 IST (birthday /
  anniversary), `30 3 * * *` = 09:00 IST (cycle + time-capsule nudges).

### 3. Pinned Firebase SDK `10.12.2` — unlikely, but catastrophic if it happens
Loaded from `gstatic.com/firebasejs/10.12.2` (compat build). Google keeps old versions alive for
years and maintains backward compatibility, but a *decade* is long enough that they could pull very
old compat files or the Firestore backend could drop old-client support.
- **If it breaks:** data/auth won't load. **Fix:** bump the SDK version in the 7 HTML files (a code change).

### 4. Four accounts that must stay alive
`parvriti` **GitHub** repo (hosting via Pages) · `parvriti` **Firebase/GCP** project (Spark) ·
**Cloudflare** account (worker) · the **3 Gmail** accounts on the auth allowlist
(`parvbajaj2000`, `aritika2000`, `parvbajaj2480`). If any is deleted or suspended for inactivity,
that piece breaks.

### 5. Console-only config (not in git)
The **Firestore security rules** (pasted in the Firebase console; mirrored in `firestore-rules/`
but **not** auto-deployed), the **VAPID key**, the **Firebase API key**, and the **service account**
live in the Firebase / Cloudflare consoles. Regenerating one without updating the other side breaks it.

### 6. Egress — the 10 GiB/month cap (slow burn) + the Board optimization
Blob-heavy pages (**Board**, the doodle **shelf**) re-download their **whole** collection on each
open (no offline persistence). As photos accumulate, egress per open grows and can creep toward the cap.
- If Board opens feel slow, or egress climbs in `dev.html`: cache the board's text + layout in
  localStorage for an **instant skeleton**, and — for egress specifically — cache the **photos**
  client-side (**IndexedDB**) and fetch only *new* ones, so you stop re-downloading all of them
  every open. That's the one perf change that also relieves a free-tier limit.
- Note: this does **not** help risk #1 (storage), because the photos still live in Firestore.

---

## Where things live
- **Site:** `parvriti.github.io` — GitHub Pages, deploys from `main`, no build step.
- **Firebase project:** `parvriti` (Spark/free). The public config (project id, API key) is in
  `js/common.js` etc. — that's fine; security is Google sign-in + Firestore rules, not obscurity.
- **Push worker:** `push-worker/` (Cloudflare). Real secrets in `.dev.vars` (git-ignored) + the
  Cloudflare dashboard. **Never** commit the service account / VAPID / home secrets.
- **Free-tier monitor:** `dev.html` (Parv-only).
- **Version discipline:** every ship bumps `?v=NN` across the 7 HTML + `sw.js` (CORE + CACHE) +
  `settings.js` VERSION, then commit + `git tag vNN` + push.
