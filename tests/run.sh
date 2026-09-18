#!/usr/bin/env bash
# Runs every suite and prints a total. Browser suites skip cleanly when webkit
# is not installed, so this still works on a machine with only node.
cd "$(dirname "$0")" || exit 1
GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
total=0; failed=0; skipped=0
for t in worker.test.mjs common-boot.test.mjs letters-dot.test.mjs settings-dot.test.mjs \
         dev-checks.test.mjs client.test.mjs faults.test.mjs release.test.mjs \
         doodle-paint.test.cjs chrome-layout.test.cjs dot-visual.test.cjs; do
  [ -f "$t" ] || continue
  out=$(node "$t" 2>&1); status=$?
  if echo "$out" | grep -q '^SKIP'; then
    printf '  %s%-28s skipped%s\n' "$DIM" "$t" "$OFF"; skipped=$((skipped+1)); continue
  fi
  line=$(echo "$out" | grep -E '^(PASS [0-9]+|[0-9]+ correct)' | tail -1)
  n=$(echo "$line" | grep -oE '[0-9]+' | head -1); n=${n:-0}
  bad=$(echo "$out" | grep -c '✗ FAIL')
  # a suite that CRASHED prints no summary line at all. That must never read as a pass.
  if [ -z "$line" ]; then
    printf '  %s%-28s CRASHED (no summary line)%s\n' "$RED" "$t" "$OFF"
    echo "$out" | tail -6 | sed 's/^/      /'
    failed=$((failed+1)); continue
  fi
  # a suite whose process failed without printing a single ✗ line must not pass either
  if [ "$status" -ne 0 ] && [ "$bad" -eq 0 ]; then bad=1; echo "$out" | tail -4 | sed 's/^/      /'; fi
  total=$((total+n)); failed=$((failed+bad))
  if [ "$bad" -gt 0 ]; then
    printf '  %s%-28s %s  (%s failed)%s\n' "$RED" "$t" "$line" "$bad" "$OFF"
    echo "$out" | grep '✗ FAIL' | sed 's/^/      /'
  else
    printf '  %s%-28s%s %s\n' "$GRN" "$t" "$OFF" "$line"
  fi
done
echo
if [ "$failed" -gt 0 ]; then printf '%s%s assertions, %s FAILED%s\n' "$RED" "$total" "$failed" "$OFF"; exit 1; fi
printf '%s%s assertions, all passing%s%s\n' "$GRN" "$total" "$OFF" "$([ $skipped -gt 0 ] && echo " ($skipped suite(s) skipped)")"
