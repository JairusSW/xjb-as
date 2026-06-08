#!/bin/bash
# Build and run AssemblyScript benchmarks.
#
# Usage:
#   ./scripts/run-bench.sh [flags] [bench-name]
#
# Flags:
#   --v8        Run under V8 / d8
#   --wavm      Run under WAVM (requires `wavm` in PATH) - DEFAULT if none given
#   --wasmtime  Run under wasmtime (requires `wasmtime` in PATH)
#   --wazero    Run under wazero (requires `wazero` in PATH)
#   --runtime <r>  Override AS runtime (incremental|minimal|stub or a path).
#               Default: incremental (proper GC). minimal OOMs alloc-heavy benches
#               (no auto-GC).
#   --memory    Enable as-heap-analyzer; bench output includes per-class
#               retained/in-flight bytes
#   --no-wasm-opt  Skip the wasm-opt -O4 post-pass (it runs by default for every
#               runtime, including WAVM, when wasm-opt is on PATH)
#   --list      List discoverable bench files and exit
#   --help, -h  Show this help and exit
#
# Outputs JSON to build/logs/as/<runtime>/<bench-stem>.as.json
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

D8_BIN="${D8_BIN:-}"
WAVM_BIN="${WAVM_BIN:-wavm}"
# WAVM's shared library lives in ~/.local/lib after the nightly .deb extraction.
export LD_LIBRARY_PATH="${HOME}/.local/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
WASMTIME_BIN="${WASMTIME_BIN:-wasmtime}"
WAZERO_BIN="${WAZERO_BIN:-wazero}"
WAVM_RUN_FLAGS="${WAVM_RUN_FLAGS:-"--abi=wasi --enable simd --enable bulk-memory --enable sign-extension"}"
WASMTIME_RUN_FLAGS="${WASMTIME_RUN_FLAGS:-"-W simd"}"
WAZERO_RUN_FLAGS="${WAZERO_RUN_FLAGS:-}"
BENCH_NAME=""
ARGS=()
RUN_V8=0
RUN_WAVM=0
RUN_WASMTIME=0
RUN_WAZERO=0
BENCH_MEMORY=0
AS_RUNTIME="incremental"
WASM_OPT=1 # run wasm-opt for every runtime by default; --no-wasm-opt disables
# Shared wasm-opt flags — fastest-possible/speed-biased, including the optional
# aggressive passes (sign-ext is added for the wasi builds, which enable it):
#   -O4               highest optimize level
#   --shrink-level=0  favour speed over size
#   --converge        re-run the pipeline to fixpoint (squeeze out everything)
#   --traps-never-happen / --ignore-implicit-traps   assume no traps -> more opts
#   --inline-functions-with-loops                    inline even loopy callees
# (--fast-math is intentionally NOT used: it reorders float ops and would make
#  the benchmarked build diverge from the bit-exact shipping build.)
# wasm-opt flags shared across all targets (features + behaviour passes)
WASM_OPT_COMMON=(
  --enable-bulk-memory --enable-simd --enable-nontrapping-float-to-int --enable-tail-call
  --converge
  --traps-never-happen --ignore-implicit-traps --inline-functions-with-loops
)
# V8 (JIT/Turbofan): -Oz hurts toDigits64; keep shrink-level=0
WASM_OPT_FLAGS=( -O4 --shrink-level=0 "${WASM_OPT_COMMON[@]}" )
# WASI runtimes (WAVM/wasmtime/wazero use LLVM AOT): -Oz is a clean win
WASM_OPT_FLAGS_WASI=( -O4 -Oz "${WASM_OPT_COMMON[@]}" )

read -r -a WAVM_RUN_FLAGS_ARR <<< "$WAVM_RUN_FLAGS"
read -r -a WASMTIME_RUN_FLAGS_ARR <<< "$WASMTIME_RUN_FLAGS"
read -r -a WAZERO_RUN_FLAGS_ARR <<< "$WAZERO_RUN_FLAGS"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --v8)
      RUN_V8=1
      shift
      ;;
    --wavm|--llvm)
      RUN_WAVM=1
      shift
      ;;
    --wasmtime)
      RUN_WASMTIME=1
      shift
      ;;
    --wazero)
      RUN_WAZERO=1
      shift
      ;;
    --runtime)
      shift
      AS_RUNTIME="$1"
      shift
      ;;
    --memory)
      BENCH_MEMORY=1
      shift
      ;;
    --no-wasm-opt)
      WASM_OPT=0
      shift
      ;;
    --list)
      echo "Available benches:"
      for f in ./benches/*.bench.ts; do
        [[ -f "$f" ]] || continue
        b="$(basename "$f" .bench.ts)"
        echo "  - $b"
      done
      for f in ./assembly/__benches__/*.bench.ts; do
        [[ -f "$f" ]] || continue
        b="$(basename "$f" .bench.ts)"
        echo "  - $b"
      done
      exit 0
      ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done


# Compile flags that enable the heap-analyzer transform + the BENCH_TRACK_MEMORY
# compile-time guard inside bench.ts. Without --memory the bench loop skips all
# memory-tracking work entirely.
MEMORY_ASC_ARGS=()
if [[ $BENCH_MEMORY -eq 1 ]]; then
  MEMORY_ASC_ARGS=(
    --transform ./node_modules/as-heap-analyzer/transform/addHeapAnalyzerInfo.mjs
    --use "BENCH_TRACK_MEMORY=1"
  )
fi

if [[ $RUN_V8 -eq 0 && $RUN_WAVM -eq 0 && $RUN_WASMTIME -eq 0 && $RUN_WAZERO -eq 0 ]]; then
  RUN_WAVM=1 # default: WAVM (LLVM AOT). Pass --v8 etc. to override. wasm-opt -O4 runs unless --no-wasm-opt.
fi

if [[ $RUN_V8 -eq 1 ]]; then
  if [[ -z "$D8_BIN" ]]; then
    if command -v v8 >/dev/null 2>&1; then
      D8_BIN="v8"
    elif command -v d8 >/dev/null 2>&1; then
      D8_BIN="d8"
    else
      echo "❌ Neither v8 nor d8 was found in PATH"
      exit 1
    fi
  fi
fi

if [[ $RUN_WAVM -eq 1 ]] && ! command -v "$WAVM_BIN" >/dev/null 2>&1; then
  echo "❌ wavm not found in PATH (or WAVM_BIN is invalid). Try: export LD_LIBRARY_PATH=\$HOME/.local/lib:\$LD_LIBRARY_PATH"
  exit 1
fi

if [[ $RUN_WASMTIME -eq 1 ]] && ! command -v "$WASMTIME_BIN" >/dev/null 2>&1; then
  echo "❌ wasmtime not found in PATH (or WASMTIME_BIN is invalid)"
  exit 1
fi

if [[ $RUN_WAZERO -eq 1 ]] && ! command -v "$WAZERO_BIN" >/dev/null 2>&1; then
  echo "❌ wazero not found in PATH (or WAZERO_BIN is invalid)"
  exit 1
fi

if [[ ${#ARGS[@]} -gt 0 ]]; then
  BENCH_NAME="${ARGS[0]}"
fi

mkdir -p ./build/logs/as/{v8,wavm,wasmtime,wazero}

FILES=()

if [[ -n "$BENCH_NAME" ]]; then
  [[ "$BENCH_NAME" != *.bench.ts ]] && BENCH_NAME="$BENCH_NAME.bench.ts"
  if [[ -f "./benches/$BENCH_NAME" ]]; then
    FILES=( "./benches/$BENCH_NAME" )
  elif [[ -f "./assembly/__benches__/$BENCH_NAME" ]]; then
    FILES=( "./assembly/__benches__/$BENCH_NAME" )
  else
    echo "❌ No benchmark found for '${ARGS[0]}'"
    exit 1
  fi
else
  FILES=( ./benches/*.bench.ts ./assembly/__benches__/*.bench.ts )
fi

consume_bench_output() {
  local tmp="$1"

  while IFS= read -r line; do
    if [[ "$line" == __AS_BENCH_JSON__* ]]; then
      local payload file_name json
      payload="${line#__AS_BENCH_JSON__}"
      file_name="${payload%%$'\t'*}"
      json="${payload#*$'\t'}"
      mkdir -p "$(dirname "$file_name")"
      printf "%s" "$json" >"$file_name"
    else
      echo "$line"
    fi
  done <"$tmp"
}

run_v8_module() {
  local wasm_arg="$1"
  "$D8_BIN" --no-liftoff --module ./bench/runners/assemblyscript.js -- "$wasm_arg"
}

run_wavm_module() {
  local wasm_arg="$1"
  local tmp
  tmp="$(mktemp)"

  if [[ ${#WAVM_RUN_FLAGS_ARR[@]} -gt 0 ]]; then
    if ! "$WAVM_BIN" run "${WAVM_RUN_FLAGS_ARR[@]}" "./build/$wasm_arg" >"$tmp" 2>&1; then
      cat "$tmp"
      rm -f "$tmp"
      return 1
    fi
  elif ! "$WAVM_BIN" run "./build/$wasm_arg" >"$tmp" 2>&1; then
    cat "$tmp"
    rm -f "$tmp"
    return 1
  fi

  consume_bench_output "$tmp"
  rm -f "$tmp"
}

run_wasmtime_module() {
  local wasm_arg="$1"
  local tmp
  tmp="$(mktemp)"

  if [[ ${#WASMTIME_RUN_FLAGS_ARR[@]} -gt 0 ]]; then
    if ! "$WASMTIME_BIN" run "${WASMTIME_RUN_FLAGS_ARR[@]}" "./build/$wasm_arg" >"$tmp" 2>&1; then
      cat "$tmp"
      rm -f "$tmp"
      return 1
    fi
  elif ! "$WASMTIME_BIN" run "./build/$wasm_arg" >"$tmp" 2>&1; then
    cat "$tmp"
    rm -f "$tmp"
    return 1
  fi

  consume_bench_output "$tmp"
  rm -f "$tmp"
}

run_wazero_module() {
  local wasm_arg="$1"
  local tmp
  tmp="$(mktemp)"

  if [[ ${#WAZERO_RUN_FLAGS_ARR[@]} -gt 0 ]]; then
    if ! "$WAZERO_BIN" run "${WAZERO_RUN_FLAGS_ARR[@]}" "./build/$wasm_arg" >"$tmp" 2>&1; then
      cat "$tmp"
      rm -f "$tmp"
      return 1
    fi
  elif ! "$WAZERO_BIN" run "./build/$wasm_arg" >"$tmp" 2>&1; then
    cat "$tmp"
    rm -f "$tmp"
    return 1
  fi

  consume_bench_output "$tmp"
  rm -f "$tmp"
}

optimize_or_fallback() {
  local in_wasm="$1"
  local out_wasm="$2"
  shift 2
  if [[ "$WASM_OPT" == "1" ]] && command -v wasm-opt >/dev/null 2>&1; then
    wasm-opt "$@" "$in_wasm" -o "$out_wasm"
    rm -f "$in_wasm"
  else
    [[ "$WASM_OPT" == "1" ]] && echo "  (wasm-opt not found on PATH; using raw asc output)"
    mv "$in_wasm" "$out_wasm"
  fi
}

build_v8() {
  local file="$1"
  local output="$2"

  npx asc "$file" -o "${output}.tmp" -O3 --converge --noAssert --uncheckedBehavior always --runtime "$AS_RUNTIME" --enable bulk-memory --enable simd --exportStart start --exportRuntime "${MEMORY_ASC_ARGS[@]}"
  optimize_or_fallback "${output}.tmp" "$output" "${WASM_OPT_FLAGS[@]}"
}

build_wasi() {
  local file="$1"
  local output="$2"
  local runtime_flag="$3"

  npx asc "$file" -o "${output}.tmp" -O3 --converge --noAssert --uncheckedBehavior always --runtime "$AS_RUNTIME" --config ./node_modules/@assemblyscript/wasi-shim/asconfig.json --use "$runtime_flag=1" --enable bulk-memory --enable simd --enable sign-extension --exportRuntime "${MEMORY_ASC_ARGS[@]}"
  optimize_or_fallback "${output}.tmp" "$output" --enable-sign-ext "${WASM_OPT_FLAGS_WASI[@]}"
}

for file in "${FILES[@]}"; do
  filename="${file##*/}"
  output="./build/${filename%.ts}"

  if [[ $RUN_V8 -eq 1 ]]; then
    wasm_arg="${filename%.ts}.v8.wasm"
    build_v8 "$file" "${output}.v8.wasm"
    echo -e "$filename (asc/v8)\n"
    run_v8_module "$wasm_arg"
  fi

  if [[ $RUN_WAVM -eq 1 ]]; then
    wasm_arg="${filename%.ts}.wavm.wasm"
    build_wasi "$file" "${output}.wavm.wasm" "AS_BENCH_RUNTIME_WAVM"
    echo -e "$filename (asc/wavm)\n"
    run_wavm_module "$wasm_arg"
  fi

  if [[ $RUN_WASMTIME -eq 1 ]]; then
    wasm_arg="${filename%.ts}.wasmtime.wasm"
    build_wasi "$file" "${output}.wasmtime.wasm" "AS_BENCH_RUNTIME_WASMTIME"
    echo -e "$filename (asc/wasmtime)\n"
    run_wasmtime_module "$wasm_arg"
  fi

  if [[ $RUN_WAZERO -eq 1 ]]; then
    wasm_arg="${filename%.ts}.wazero.wasm"
    build_wasi "$file" "${output}.wazero.wasm" "AS_BENCH_RUNTIME_WAZERO"
    echo -e "$filename (asc/wazero)\n"
    run_wazero_module "$wasm_arg"
  fi
done

echo "Finished benchmarks"
