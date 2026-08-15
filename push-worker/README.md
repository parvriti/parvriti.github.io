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
match /deviceTokens/{doc} { allow read, write: if ok(); }
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
