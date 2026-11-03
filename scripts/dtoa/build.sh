#!/usr/bin/env bash
# Build the optimized targets exercised by verification and fuzzing.
# dtoa-comp keeps its historical filename but now exercises shrink level 1
# against the same compact cache used by dtoa and ftoa in every build.
set -euo pipefail
cd "$(dirname "$0")/../.."

COMMON="--converge --noAssert --uncheckedBehavior always --enable simd --enable bulk-memory --enable sign-extension --runtime stub"
mkdir -p build

# shellcheck disable=SC2086
npx asc assembly/dtoa.ts -o build/dtoa.wasm      -O3                  $COMMON
# shellcheck disable=SC2086
npx asc assembly/dtoa.ts -o build/dtoa-comp.wasm -O3 --shrinkLevel 1  $COMMON
# shellcheck disable=SC2086
npx asc assembly/ftoa.ts -o build/ftoa.wasm      -O3                  $COMMON

echo "built build/{dtoa,dtoa-comp,ftoa}.wasm"
