#!/usr/bin/env bash
# =====================================================================
# release.sh - the documented way to ship Parvriti.
#
# A release bumps ~40 version strings across 9 files by hand. Miss one and
# the failure is SILENT: that page's assets miss the precache, or the service
# worker never updates and both phones quietly stay on the old version. This
# script makes that impossible to do by accident.
#
#   scripts/release.sh preflight        check the tree is internally consistent
#   scripts/release.sh bump <N>         bump to vN, then preflight
#   scripts/release.sh verify-deploy    poll the live site until it serves this version
#
# It never commits, tags or pushes. Those stay manual and deliberate.
# =====================================================================
set -u
cd "$(dirname "$0")/.." || exit 1

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
fail=0
ok()   { printf '  %s✓%s %s\n' "$GRN" "$OFF" "$1"; }
bad()  { printf '  %s✗%s %s\n' "$RED" "$OFF" "$1"; fail=1; }
warn() { printf '  %s!%s %s\n' "$YEL" "$OFF" "$1"; }

current_version() { sed -n "s/.*parvriti-v\([0-9]*\).*/\1/p" sw.js | head -1; }

# ── every file that may carry a version string, derived, never hardcoded ──
version_files() { ls -1 ./*.html sw.js js/settings.js 2>/dev/null; }

preflight() {
  local want="${1:-$(current_version)}"
  printf '\n%sPreflight for v%s%s\n' "$DIM" "$want" "$OFF"

  # 1. every ?v= in every file agrees with the target
  local strays
  strays=$(grep -oE 'v=[0-9]+' $(version_files) 2>/dev/null | grep -v "v=$want$" | sort -u)
  if [ -n "$strays" ]; then
    bad "stale version strings still present:"
    printf '      %s\n' $strays
  else
    ok "all ?v= strings are v$want"
  fi

  # 2. the three special constants
  grep -q "var CACHE = 'parvriti-v$want'" sw.js && ok "sw.js CACHE is v$want" || bad "sw.js CACHE is not v$want"
  grep -q "var VERSION = 'v$want'" js/settings.js && ok "settings.js VERSION is v$want" || bad "settings.js VERSION is not v$want"

  # 3. THE BIG ONE: every precached file must exist, or install aborts and
  #    both phones silently stay on the old version forever.
  local missing=0 n=0 f
  for f in $(sed -n "/^var CORE = \[/,/\];/p" sw.js | grep -oE "'[^']+'" | tr -d "'"); do
    n=$((n + 1))
    [ -f "${f%%\?*}" ] || { bad "precache entry missing on disk: $f"; missing=$((missing + 1)); }
  done
  [ "$missing" -eq 0 ] && ok "all $n precache entries exist on disk"

  # 4. every local asset each page asks for must exist too
  local htmlmiss=0 p a
  for p in ./*.html; do
    for a in $(grep -oE '(src|href)="(js|css)/[^"]+"' "$p" | sed -E 's/.*"(.*)"/\1/'); do
      [ -f "${a%%\?*}" ] || { bad "$p references a missing file: $a"; htmlmiss=$((htmlmiss + 1)); }
    done
  done
  [ "$htmlmiss" -eq 0 ] && ok "every page's local assets exist"

  # 5. javascript actually parses
  local jsbad=0
  for f in js/*.js sw.js push-worker/worker.js; do
    node --check "$f" >/dev/null 2>&1 || { bad "syntax error in $f"; jsbad=1; }
  done
  [ "$jsbad" -eq 0 ] && ok "all javascript parses"

  # 6. an ID selector that sets 'position' outranks a class and can drag fixed
  #    chrome out of its corner. This exact mistake once moved the settings gear
  #    from the top right to the bottom of the page.
  local idpos
  idpos=$(grep -nE '^#[A-Za-z][^{]*\{[^}]*position:' css/*.css 2>/dev/null | head -5)
  if [ -n "$idpos" ]; then
    bad "an ID selector sets 'position' (it will outrank .proto-corner and friends):"
    printf '      %s\n' "$idpos"
  else
    ok "no ID selector overrides position"
  fi

  # 8. the pinned Firebase SDK. It is NOT in the offline precache, and every deploy
  #    clears the old cache, so if Google ever stops serving this version the NEXT
  #    deploy breaks both phones at once. So: one version everywhere (the push
  #    worker's importScripts too, or push breaks), and Google must still serve
  #    every file, or the bump is refused. SKIP_NET=1 skips the network half.
  local sdks
  sdks=$(grep -ohE 'gstatic\.com/firebasejs/[0-9]+\.[0-9]+\.[0-9]+/' ./*.html firebase-messaging-sw.js 2>/dev/null | sort -u)
  if [ -z "$sdks" ]; then
    bad "no Firebase SDK reference found in the pages (did the markup change?)"
  elif [ "$(printf '%s\n' "$sdks" | wc -l | tr -d ' ')" != "1" ]; then
    bad "the Firebase SDK version differs between files (the push worker must match the pages):"
    printf '      %s\n' $sdks
  else
    ok "one Firebase SDK version everywhere, push worker included ($(printf '%s' "$sdks" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+'))"
  fi
  if [ "${SKIP_NET:-}" = "1" ]; then
    warn "SKIP_NET=1: did not check that Google still serves the SDK and fonts"
  else
    local urls u code netbad=0 nurl=0
    urls=$( { grep -ohE "https://www\.gstatic\.com/firebasejs/[^\"' )]+\.js" ./*.html firebase-messaging-sw.js
              grep -ohE 'https://fonts\.googleapis\.com/css2\?[^"]+' ./*.html; } 2>/dev/null | sed 's/&amp;/\&/g' | sort -u)
    for u in $urls; do
      nurl=$((nurl + 1))
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$u")
      [ "$code" = "200" ] || { bad "not served (HTTP $code): $u"; netbad=1; }
    done
    if [ "$nurl" -eq 0 ]; then bad "found no SDK or font URLs to check"
    elif [ "$netbad" -eq 0 ]; then ok "Google still serves all $nurl SDK and font files"
    else printf '      %sOffline? Re-run when online. If Google really dropped them, move to a served version first.%s\n' "$DIM" "$OFF"; fi
  fi

  # 7. owner rule: no em dashes in shipped text
  local em
  em=$(grep -l $'—' $(version_files) js/*.js 2>/dev/null | tr '\n' ' ')
  [ -n "$em" ] && warn "em dashes present in: $em" || ok "no em dashes"

  if [ "$fail" -ne 0 ]; then
    printf '\n%sPREFLIGHT FAILED. Do not push.%s\n\n' "$RED" "$OFF"
    return 1
  fi
  printf '\n%sPreflight clean.%s\n\n' "$GRN" "$OFF"
  return 0
}

bump() {
  local want="$1" cur
  cur=$(current_version)
  [ -z "$want" ] && { echo "usage: release.sh bump <version-number>"; return 1; }
  [ "$want" = "$cur" ] && { echo "already at v$cur"; return 1; }
  printf '\n%sBumping v%s -> v%s%s\n' "$DIM" "$cur" "$want" "$OFF"
  sed -i '' "s/v=$cur/v=$want/g" $(version_files)
  sed -i '' "s/parvriti-v$cur/parvriti-v$want/" sw.js
  sed -i '' "s/var VERSION = 'v$cur'/var VERSION = 'v$want'/" js/settings.js
  ok "rewrote version strings"
  preflight "$want"
}

verify_deploy() {
  local want="${1:-$(current_version)}" tries=0 live=''
  printf '\n%sWaiting for github pages to serve v%s%s\n' "$DIM" "$want" "$OFF"
  while [ "$tries" -lt 12 ]; do   # up to 3 minutes
    live=$(curl -s "https://parvriti.github.io/sw.js?cb=$(date +%s)" | sed -n "s/.*parvriti-v\([0-9]*\).*/\1/p" | head -1)
    if [ "$live" = "$want" ]; then
      ok "live site is serving v$want"
      printf '\n%sDeployed.%s\n\n' "$GRN" "$OFF"; return 0
    fi
    tries=$((tries + 1)); sleep 15
  done
  warn "after 3 minutes the live site still serves v${live:-?}, not v$want"
  printf '      %sPages builds can lag, and its cdn caches for ~10 min.%s\n' "$DIM" "$OFF"
  printf '      %sRe-run: scripts/release.sh verify-deploy %s%s\n\n' "$DIM" "$want" "$OFF"
  return 1
}

case "${1:-}" in
  preflight)     preflight "${2:-}";;
  bump)          bump "${2:-}";;
  verify-deploy) verify_deploy "${2:-}";;
  *) printf 'usage: %s {preflight | bump <N> | verify-deploy [N]}\n' "$0"; exit 1;;
esac
