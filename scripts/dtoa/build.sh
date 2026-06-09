#!/usr/bin/env bash
# Builds the targets the verifier and fuzzer exercise:
#   build/dtoa.wasm       - dtoa.ts -O3, full 9.9 KB pow10 table          -> dtoa
#   build/dtoa-comp.wasm  - dtoa.ts --shrinkLevel 1, compressed anchor
#                           table + reconstruction                        -> dtoa-comp
#   build/ftoa.wasm       - ftoa.ts, compact hi-only f32 core             -> ftoa
# (f64 = dtoa.ts, compact f32 = ftoa.ts, shared f64 engine = xjb.ts.)
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
