# parvriti.github.io 🌸

An interactive digital love letter — from Parv to Ritika ("Toti"). A short
lock ritual on the home page opens into a set of pages: the letter, a
collection of "Open When…" notes (each with a voice clip), and a wedding card.

Live: https://parvriti.github.io · Static site on GitHub Pages, no build step.

## Structure

```
index.html          Home / entry ritual: intro → PIN dial → flower → vows
letter.html         The main letter
open-when.html      "Open When…" — 12 sealed notes + voice
wedding.html        Wedding card (curtains reveal; details coming soon)

css/
  styles.css        All styles for every page

js/
  common.js         Shared: nav bar, unlock guard, background petals
  locks.js          index.html only — the dial / flower / vows ritual
  open-when.js      open-when.html only — the notes + envelope + voice

voice/
  <key>.m4a         One voice clip per note (placeholders for now)
```

## How it fits together

- Every page loads `css/styles.css` and `js/common.js`. `common.js` reads
  `<body data-page="…">` to build the top nav (highlighting the current page)
  and to gate the inner pages: they redirect to `index.html` unless the lock
  ritual was completed this browser session (`sessionStorage`).
- Adding a page: create the HTML, give it a `data-page`, and add one entry to
  the `NAV` array in `js/common.js`.

## Editing content

- **The letter:** edit `letter.html` (the `.note-body` block).
- **The "Open When…" notes:** edit the `OPEN_WHEN` array in `js/open-when.js`.
  Each entry has `key`, `emoji`, `cap` (card label), `title`, and `body`.
- **Voice notes:** each note plays `voice/<key>.m4a`. Replace a placeholder by
  dropping a real recording in with the same filename — no code change needed.
  (Add an `audio:` field to an entry to point elsewhere.)

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Open `index.html` and complete the ritual — the dial PIN, the petal order, and
the signature gate the rest. (The answers live in `js/locks.js`; this is a
playful lock, not real security.)
