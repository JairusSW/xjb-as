#!/bin/bash
# Renders every scripts/charts/*.mjs file with the selected runtime.
#
#   ./scripts/build-charts.sh                # wavm (default)
#   ./scripts/build-charts.sh --v8
#   ./scripts/build-charts.sh --wavm --v8    # multiple runtimes in one run
#   ./scripts/build-charts.sh --wavm chart1  # only chart1.mjs
#
# Files starting with `_` (e.g. `_template.mjs`) are skipped. Charts read
# bench JSON from build/logs/as/<runtime>/; run the matching benchmark first:
#   npm run bench -- --wavm     (or --v8 / --wazero)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUNTIMES=() # one or more; defaults to wavm if none given
TARGETS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --v8)     RUNTIMES+=("v8");     shift ;;
    --wavm)   RUNTIMES+=("wavm");   shift ;;
    --wazero) RUNTIMES+=("wazero"); shift ;;
    --list)
      echo "Available charts:"
      for f in ./scripts/charts/*.mjs; do
        [[ -f "$f" ]] || continue
        b="$(basename "$f" .mjs)"
        [[ "$b" == _* ]] && continue
        echo "  - $b"
      done
      exit 0
      ;;
    --help|-h)
      sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) TARGETS+=("$1"); shift ;;
  esac
done

FILES=()
if [[ ${#TARGETS[@]} -gt 0 ]]; then
  for t in "${TARGETS[@]}"; do
    [[ "$t" != *.mjs ]] && t="$t.mjs"
    if [[ -f "./scripts/charts/$t" ]]; then
      FILES+=("./scripts/charts/$t")
    else
      echo "❌ chart script not found: scripts/charts/$t" >&2
      exit 1
    fi
  done
else
  for f in ./scripts/charts/*.mjs; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    [[ "$base" == _* ]] && continue # skip _template.mjs etc.
    FILES+=("$f")
  done
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No chart scripts to run. Add one to scripts/charts/ (start from _template.mjs)."
  exit 0
fi

[[ ${#RUNTIMES[@]} -eq 0 ]] && RUNTIMES=("wavm")

mkdir -p ./charts

for rt in "${RUNTIMES[@]}"; do
  echo "Building ${#FILES[@]} chart(s) for runtime: $rt"
  for f in "${FILES[@]}"; do
    BENCH_CHART_RUNTIME="$rt" node "$f"
  done
done
