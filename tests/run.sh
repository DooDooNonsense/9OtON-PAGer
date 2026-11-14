#!/bin/bash
# Runs every test against a throwaway server each (own port, own data file). From the project root:  bash tests/run.sh
# End-to-end tests (e2e*) need only Node. UI tests (ui*) also need Playwright and Chrome:
#   PW_PATH=/path/to/node_modules  CHROME=/path/to/chrome   (defaults below)
T="$(cd "$(dirname "$0")" && pwd)"; ROOT="$T/.."; OUT="${OUT:-/tmp/impollster-tests}"; mkdir -p "$OUT"
export NODE_PATH="${PW_PATH:-/opt/npm-tools/node_modules}"
run() { # name port script
  rm -f "$OUT/$1-data.json"
  (cd "$ROOT" && PORT=$2 DATA_FILE="$OUT/$1-data.json" node server.js >"$OUT/$1.log" 2>&1 & echo $! >"$OUT/$1.pid")
  sleep 0.8
  timeout 170 node "$T/$3" "$OUT" >"$OUT/$1.out" 2>&1
  echo "== $1: $(grep -c '^PASS' "$OUT/$1.out") pass, $(grep -c '^FAIL' "$OUT/$1.out") fail"
  kill "$(cat "$OUT/$1.pid")" 2>/dev/null
}
run r3 3113 e2e3.js; run r4 3114 e2e4.js; run r5 3130 e2e5.js; run r6 3140 e2e6.js; run r7 3144 e2e7.js; run r8 3146 e2e8.js
run u4 3120 ui4.js; run u5 3121 ui5.js; run u6 3122 ui6.js; run u7 3123 ui7.js; run u8 3124 ui8.js; run u9 3125 ui9.js
run u13 3127 ui13.js; run u14 3128 ui14.js; run u15 3131 ui15.js; run u16 3136 ui16.js
run u17 3141 ui17.js; run u18 3142 ui18.js; run u19 3143 ui19.js; run u20 3145 ui20.js; run u21 3147 ui21.js; run u22 3149 ui22.js
