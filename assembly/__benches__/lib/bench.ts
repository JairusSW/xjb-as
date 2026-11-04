import {
  getUsedMemorySize,
  memoryDetail,
} from "as-heap-analyzer/assembly/index";

// @ts-ignore: decorator allowed
@external("env", "writeFile")
export declare function writeFile(fileName: string, data: string): void;

// @ts-ignore: decorator allowed
@external("env", "readFile")
export declare function readFile(filePath: string): ArrayBuffer;

// @ts-expect-error: compile-time flags may be undefined.
const BENCH_RUNTIME_WAVM: bool = isDefined(AS_BENCH_RUNTIME_WAVM);
// @ts-expect-error: compile-time flags may be undefined.
const BENCH_RUNTIME_WAZERO: bool = isDefined(AS_BENCH_RUNTIME_WAZERO);
// @ts-expect-error: compile-time flags may be undefined.
const BENCH_RUNTIME_WASMTIME: bool = isDefined(AS_BENCH_RUNTIME_WASMTIME);

// @ts-expect-error: BENCH_TRACK_MEMORY may be undefined.
const BENCH_MEMORY: bool = isDefined(BENCH_TRACK_MEMORY);

// Mirrors MEMORY_DETAIL_SIZE in as-heap-analyzer. We snapshot it on bench
// entry so the post-bench diff filters fixtures (anything live before the
// routine ran).
const HEAP_DETAIL_SLOTS: u32 = 1024;
const heapDetailSnapshot: usize = memory.data(HEAP_DETAIL_SLOTS * 4);

// 64KB per WebAssembly memory page.
const WASM_PAGE_SIZE: usize = 64 * 1024;
// Off by default - preallocation breaks `as-heap-analyzer`'s linear block
// walk (it treats grown-but-unused pages as malformed blocks). Opt in with
// `--use BENCH_PREALLOC_BYTES=<n>` when memory tracking is off.
// @ts-expect-error: BENCH_PREALLOC_BYTES may be undefined.
const PREALLOC_BYTES: usize = isDefined(BENCH_PREALLOC_BYTES) ? BENCH_PREALLOC_BYTES : 0;
let preallocated = false;

class BenchResult {
  language: string = "assemblyscript";
  description!: string;
  runtime!: string;
  elapsed!: f64;
  bytes!: u64;
  operations!: u64;
  features!: string[];
  nsPerOp!: f64;
  opsPerSecond!: f64;
  mbps!: f64;
  gbps!: f64;
  memoryBaselineBytes: u64 = 0;
  memoryLinearBaselineBytes: u64 = 0;
  memoryLinearPeakBytes: u64 = 0;
  memoryLinearGrowthBytes: u64 = 0;
  memoryRetainedBytes: u64 = 0;
  memoryCollectAndSnapshotMs: f64 = 0;
  heapDetail: string = "";
}

let result: BenchResult | null = null;

function benchRuntimeName(): string {
  if (BENCH_RUNTIME_WAVM) return "wavm";
  if (BENCH_RUNTIME_WASMTIME) return "wasmtime";
  if (BENCH_RUNTIME_WAZERO) return "wazero";
  return "v8";
}

// @ts-ignore: decorator allowed
@inline function preallocateMemory(): void {
  if (preallocated) return;
  preallocated = true;
  if (PREALLOC_BYTES == 0) return;
  const currentPages = <usize>memory.size();
  const targetPages: usize =
    (PREALLOC_BYTES + (WASM_PAGE_SIZE - 1)) / WASM_PAGE_SIZE;
  if (targetPages > currentPages) {
    memory.grow(<i32>(targetPages - currentPages));
  }
}

function checkedHeapBytes(): u64 {
  const used = getUsedMemorySize();
  if (used == u32.MAX_VALUE || <u64>used > <u64>memory.size() * <u64>WASM_PAGE_SIZE) {
    throw new Error("Heap analyzer failed: unsupported or invalid heap layout; no memory measurement produced");
  }
  return <u64>used;
}

function buildHeapDetailDelta(): string {
  let parts: string[] = [];
  for (let i: u32 = 0; i < HEAP_DETAIL_SLOTS; i++) {
    const post = load<u32>(memoryDetail + i * 4);
    const pre = load<u32>(heapDetailSnapshot + i * 4);
    const delta: i64 = <i64>post - <i64>pre;
    if (delta != 0) parts.push(`"${i}":${delta}`);
  }
  return "{" + parts.join(",") + "}";
}

// `ops` is treated as a batch size; the loop runs whole batches until at
// least `minMs` has elapsed. Total elapsed is typically minMs..minMs+(one
// batch). Pick `ops` so one batch is a small fraction of minMs (~10ms is
// the sweet spot - gives ~100 clock checks per run).
export function bench(
  description: string,
  routine: () => void,
  ops: u64 = 1_000_000,
  bytesPerOp: u64 = 0,
  minMs: f64 = 1000
): void {
  preallocateMemory();
  __collect();
  console.log(" - Benchmarking " + description);

  let baselineLiveBytes: u64 = 0;
  let peakPages: u64 = 0;
  let baselinePages: u64 = 0;
  if (BENCH_MEMORY) {
    baselineLiveBytes = checkedHeapBytes();
    memory.copy(heapDetailSnapshot, memoryDetail, HEAP_DETAIL_SLOTS * 4);
    baselinePages = peakPages = <u64>memory.size();
  }

  let warmup = ops / 10;
  while (warmup--) {
    routine();
  }

  const start = performance.now();
  let totalOps: u64 = 0;
  while (performance.now() - start < minMs) {
    let count = ops;
    while (count--) {
      routine();
      if (BENCH_MEMORY) {
        const p = <u64>memory.size();
        if (p > peakPages) peakPages = p;
      }
    }
    totalOps += ops;
  }

  const end = performance.now();
  const elapsed = Math.max(1, end - start);
  ops = totalOps;

  let retainedLiveBytes: u64 = 0;
  let collectAndSnapshotMs: f64 = 0;
  let heapDetailJson: string = "";
  if (BENCH_MEMORY) {
    // The analyzer collects once and walks the heap. Report the combined
    // operation; it cannot provide an in-flight or GC-only measurement.
    const gcStart = performance.now();
    retainedLiveBytes = checkedHeapBytes();
    collectAndSnapshotMs = performance.now() - gcStart;
    heapDetailJson = buildHeapDetailDelta();
  }

  const opsPerSecond = f64(ops * 1000) / elapsed;
  const nsPerOp = (elapsed * 1_000_000) / f64(ops);

  // @ts-ignore
	let log = "   Completed benchmark in " + Math.round(elapsed).toString() +
	  // @ts-ignore
    "ms at " + Math.round(opsPerSecond).toString() + " ops/s (" +
    fixed2(nsPerOp) + " ns/op)";

  let mbPerSec: f64 = 0;
  if (bytesPerOp > 0) {
    const totalBytes = bytesPerOp * ops;
    mbPerSec = f64(totalBytes) / (elapsed / 1000) / (1000 * 1000);
    // @ts-ignore
    log += " @ " + Math.round(mbPerSec).toString() + "MB/s";
  }

  let memBaselineBytes: u64 = 0;
  let memPeakBytes: u64 = 0;
  let memRetainedBytes: u64 = 0;
  if (BENCH_MEMORY) {
    memBaselineBytes = baselineLiveBytes;
    memPeakBytes = peakPages * <u64>WASM_PAGE_SIZE;
    memRetainedBytes = retainedLiveBytes;
    const grew = (peakPages - baselinePages) * <u64>WASM_PAGE_SIZE;
    const netDelta: i64 = <i64>memRetainedBytes - <i64>memBaselineBytes;
    // @ts-ignore
    log += "\n   mem: heapBase=" + memBaselineBytes.toString() +
    // @ts-ignore
      " linearBase=" + (baselinePages * <u64>WASM_PAGE_SIZE).toString() +
      // @ts-ignore
      " linearPeak=" + memPeakBytes.toString() +
      // @ts-ignore
      " retained=" + memRetainedBytes.toString() +
      // @ts-ignore
      " linearGrowth=+" + grew.toString() +
      // @ts-ignore
      " net=" + netDelta.toString() +
      " collect+snapshot=" + fixed1(collectAndSnapshotMs) + "ms";
    log += "\n   retained heap delta: " + heapDetailJson;
  }

  const features: string[] = [];
  if (ASC_FEATURE_SIMD) features.push("simd");

  result = {
    language: "assemblyscript",
    description,
    runtime: benchRuntimeName(),
    elapsed,
    bytes: bytesPerOp,
    operations: ops,
    features,
    nsPerOp,
    opsPerSecond,
    mbps: mbPerSec,
    gbps: mbPerSec / 1000,
    memoryBaselineBytes: memBaselineBytes,
    memoryLinearBaselineBytes: baselinePages * <u64>WASM_PAGE_SIZE,
    memoryLinearPeakBytes: memPeakBytes,
    memoryLinearGrowthBytes: (peakPages - baselinePages) * <u64>WASM_PAGE_SIZE,
    memoryRetainedBytes: memRetainedBytes,
    memoryCollectAndSnapshotMs: collectAndSnapshotMs,
    heapDetail: heapDetailJson,
  };

  console.log(log + "\n");
}

export function dumpToFile(suite: string): void {
  const fileName = "./build/logs/as/" + benchRuntimeName() + "/" + suite + ".as.json";
  const json = serializeResult();
  // All engines use the host runner to attach source/build metadata atomically.
  console.log("__AS_BENCH_JSON__" + fileName + "\t" + json);
}

function serializeResult(): string {
  if (result == null) return "{}";
  const r = result!;
  let features = "[";
  for (let i = 0; i < r.features.length; i++) {
    if (i > 0) features += ",";
    features += '"' + r.features[i] + '"';
  }
  features += "]";

  return (
    '{"benchmarkSchemaVersion":3,"language":"' + r.language +
    '","description":"' + r.description +
    '","runtime":"' + r.runtime +
    // @ts-ignore
    '","elapsed":' + r.elapsed.toString() +
    // @ts-ignore
    ',"bytes":' + r.bytes.toString() +
    // @ts-ignore
    ',"operations":' + r.operations.toString() +
    ',"features":' + features +
    // @ts-ignore
    ',"nsPerOp":' + r.nsPerOp.toString() +
    // @ts-ignore
    ',"opsPerSecond":' + r.opsPerSecond.toString() +
    // @ts-ignore
    ',"mbps":' + r.mbps.toString() +
    // @ts-ignore
    ',"gbps":' + r.gbps.toString() +
    // @ts-ignore
    ',"memoryBaselineBytes":' + r.memoryBaselineBytes.toString() +
    // @ts-ignore
    ',"memoryLinearBaselineBytes":' + r.memoryLinearBaselineBytes.toString() +
    // @ts-ignore
    ',"memoryLinearPeakBytes":' + r.memoryLinearPeakBytes.toString() +
    // @ts-ignore
    ',"memoryLinearGrowthBytes":' + r.memoryLinearGrowthBytes.toString() +
    // @ts-ignore
    ',"memoryRetainedBytes":' + r.memoryRetainedBytes.toString() +
    // @ts-ignore
    ',"memoryCollectAndSnapshotMs":' + r.memoryCollectAndSnapshotMs.toString() +
    ',"heapDetail":' + (r.heapDetail.length > 0 ? r.heapDetail : "{}") +
    "}"
  );
}

// One decimal digit; cheap stand-in for the missing F64.toFixed.
// @ts-ignore: decorator allowed
@inline function fixed1(v: f64): string {
  const r = Math.round(v * 10) / 10;
  const whole = <i64>r;
  const frac = <i32>Math.abs(Math.round((r - <f64>whole) * 10));
  // @ts-ignore
  return whole.toString() + "." + frac.toString();
}

// Up to two decimals, rounded: integers print clean ("17"), non-integers cap at
// two places with trailing zeros trimmed ("7.07", "3.5"). For ns/op display.
// @ts-ignore: decorator allowed
@inline function fixed2(v: f64): string {
  const s = <i64>Math.round(Math.abs(v) * 100); // value in hundredths
  const whole = s / 100;
  const frac = <i32>(s % 100);
  // @ts-ignore
  if (frac == 0) return whole.toString();
  // @ts-ignore
  if (frac % 10 == 0) return whole.toString() + "." + (frac / 10).toString();
  // @ts-ignore
  return whole.toString() + "." + (frac < 10 ? "0" : "") + frac.toString();
}

const blackBoxArea = memory.data(64);
export function blackbox<T>(value: T): T {
  store<T>(blackBoxArea, value);
  return load<T>(blackBoxArea);
}
