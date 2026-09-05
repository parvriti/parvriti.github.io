# Push notifications — setup

The site is fully built for push. It stays dormant until two values are filled
in (`FCM_VAPID_KEY` and `PUSH_ENDPOINT` in `js/common.js`). Do the steps below,
send the two values back, and it goes live.

## Step 1 — Web Push key (VAPID)

1. Firebase console → the **parvriti** project → **Project settings** (gear) →
   **Cloud Messaging** tab.
2. Under **Web Push certificates**, click **Generate key pair**.
3. Copy the key string it shows. That is the `FCM_VAPID_KEY`.

## Step 2 — Service account (for the Worker)

1. Firebase console → **Project settings** → **Service accounts** tab.
2. Click **Generate new private key** → confirm. A `.json` file downloads.
3. Keep it safe. You will paste its contents into the Worker as a secret. Do
   **not** commit it to the repo.

## Step 3 — Deploy the Cloudflare Worker

Easiest is the dashboard (no tools to install):

1. Make a free account at <https://dash.cloudflare.com> → **Workers & Pages** →
   **Create** → **Create Worker**. Give it a name (e.g. `parvriti-push`) and
   **Deploy** the starter.
2. **Edit code** → delete the starter → paste the entire contents of
   [`worker.js`](worker.js) → **Deploy**.
3. Worker → **Settings** → **Variables and Secrets**:
   - Add **Secret** named `SERVICE_ACCOUNT`, value = the *entire text* of the
     service-account JSON from Step 2.
   - Add **Variable** named `FIREBASE_API_KEY`, value =
     `AIzaSyBW_EMfKIkIJDNSMPUp6UeHOGtIdv26Wpk` (the public web key).
   - **Deploy** again so they take effect.
4. Copy the Worker URL (looks like
   `https://parvriti-push.<your-subdomain>.workers.dev`). That is the
   `PUSH_ENDPOINT`.

(If you prefer the CLI: `npm i -g wrangler`, `wrangler deploy worker.js`,
`wrangler secret put SERVICE_ACCOUNT`, and set the var in the dashboard.)

## Step 4 — Firestore rules

Add a rule so each phone can save its own push token. Publish this alongside
the existing rules (Firestore → Rules):

```
match /deviceTokens/{doc} {
  // only the worker (service account) reads these; a client just registers ITS OWN token
  function myPerson() { return request.auth.token.email == 'aritika2000@gmail.com' ? 'riti' : 'parv'; }
  allow read:           if false;
  allow create, update: if ok() && request.resource.data.person == myPerson();
  allow delete:         if ok() && resource.data.person == myPerson();
}
```

(where `ok()` is the same allow-list function guarding `notes` / `presence` /
`pings`.)

## Step 5 — send the two values back

Send me the `FCM_VAPID_KEY` (Step 1) and the `PUSH_ENDPOINT` URL (Step 3).
I paste them into `js/common.js`, bump the version, and deploy. Then each of you,
once on the **installed** app, taps **Turn on** on the little prompt, and pushes
start landing on the lock screen even when the app is closed.

Notes:
- iOS only allows web push from the app **added to the Home Screen** (iOS 16.4+).
  Install it first, open it from the icon, then turn on notifications.
- Nothing here can be triggered by strangers: the Worker checks that the caller
  is one of the three signed-in accounts before it sends anything.

## Got Home Safe (POST /automation/home)

Called by the iPhone "Arrive" automations (Shortcuts), not the website. Auth is
a per-person secret in the `Authorization: Bearer <secret>` header, and WHO
arrived is decided only by which secret matched (never a body field), so it
cannot be spoofed. Riti's secret notifies Parv; Parv's notifies Riti. The
Shortcut also sends a coarse `{"home":"noida"|"gurugram"|"rohtak"}` label (never
coordinates) used only for the together-check; it is never in the notification.

**Behaviour (default: apart-aware, one per day).** Read live from `settings/app`
so the admin Settings page can retune it with no redeploy:

- `hsRule` — `apart` (default) · `always` · `evening` · `off`
- `hsOnePerDay` (bool, default true) — at most the first arrival per IST day
- `hsAfterHour` (int, default 18) — cutoff hour for the `evening` rule

  (The `apart` rule stays silent when the arrival puts you *together* — that is
  computed from the live arrival records, not a tunable window: same home label
  with the partner still there within a 7-day self-heal, OR both arriving within
  ~6 min of each other. The old `hsTogetherHrs` setting fed nothing and was
  removed.)
- `hsHomeRitiNoida` / `hsHomeRitiGurugram` / `hsHomeParvRohtak` /
  `hsHomeParvGurugram` (bool) — per-home mutes

State lives in `homeArrivals/<person>` = `{ at, home, sentDay }` — no
coordinates, ever. 10-minute `DEDUP_MS` swallows geofence double-fires.

Add two secrets and redeploy:

    wrangler secret put HOME_SECRET_RITI
    wrangler secret put HOME_SECRET_PARV

(or Cloudflare dashboard -> Worker -> Settings -> Variables and Secrets -> add as
encrypted Secrets, then Deploy.)

### The 4 iPhone automations

Settings app -> **Shortcuts** -> **Automation** -> **+** -> **Arrive**. Pick the
address, **When Arriving**, **Run Immediately** (turn OFF "Notify When Run"),
Next -> **New Blank Automation** -> add one action **Get Contents of URL**:

- URL `https://parvriti-push.parvbajaj2000.workers.dev/automation/home`
- (expand ▸) Method **POST**
- Headers: **Authorization** = `Bearer <that person's secret>`
- Request Body **JSON**: one field `home` (Text) = the home name below

| # | Arrive at | secret | `home` |
|---|-----------|--------|--------|
| 1 | Riti → Noida    | `HOME_SECRET_RITI` | `noida` |
| 2 | Riti → Gurugram | `HOME_SECRET_RITI` | `gurugram` |
| 3 | Parv → Rohtak   | `HOME_SECRET_PARV` | `rohtak` |
| 4 | Parv → Gurugram | `HOME_SECRET_PARV` | `gurugram` |

The exact street addresses live only in each phone's Arrive trigger; the Worker
never receives or stores them.
