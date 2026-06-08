// Per-stage latency of the dtoa (f64) pipeline, by input complexity.
// (f32 lives in ftoa-stages.bench.ts.) Feeds scripts/charts/dtoa-stages.mjs.
//
// Where does a dtoa() call spend its time? Each pipeline stage is timed in
// isolation across the same complexity buckets as dtoa-comp.bench.ts:
//   core     -> benchCoreDouble  binary -> shortest decimal (Schubfach)
//   digits   -> benchDigits64    decimal significand -> packed ASCII digit block
//   buffered -> dtoa_buffered    full no-alloc UTF-16 total
//   string   -> dtoa             full allocating total
//
// The chart derives the remaining stages:
//   noalloc-rest    = buffered - core - digits   (layout + direct UTF-16 stores)
//   string-overhead = string - buffered          (allocation + string widening)
// so core+digits+noalloc-rest+string-overhead sums back to dtoa().
//
// Each routine loops over the whole bucket array (nsPerOp = ns per pass); the
// chart divides by sample count. Throughput size = total ASCII output length.

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { dtoa, dtoa_buffered } from "../dtoa";
import { benchCoreDouble, benchCoreDoubleRaw, benchDigits64 } from "./stage-hooks";

const U16 = memory.data(128);
const SIG_STORE = memory.data(16 * 8); // decimal significand per sample (u64)
const OPS: u64 = 100_000;

function asciiBytes(samples: f64[]): u64 {
  return u64(samples.map<string>((s) => s.toString()).join("").length);
}

const ZERO_SPECIAL: f64[] = [
  0, -0, Infinity, -Infinity, NaN, 0, -0, Infinity,
];
const TINY_FIXED: f64[] = [
  1, -1, 0.5, -0.5, 10, 100, 1000, 1e-6,
];
const FIXED_FRACTIONS: f64[] = [
  0.1, 0.2, 0.3, 0.30000000000000004, 123456.789, 43210.1,
  0.0001220703125, 3.141592653589793,
];
const LONG_FIXED: f64[] = [
  999999999999999.9, 123456789012345.67, 9007199254740992,
  1e20, 9e20, 4503599627370497, -5942736479622170.0, 5.444310685350916e14,
];
const SMALL_EXPONENT: f64[] = [
  1e-7, 1e-12, 1e-50, 1e-100, 2.9802322387695312e-8,
  6.62607015e-34, -1.2345678901234567e-123, 2.2250738585072009e-308,
];
const LARGE_EXPONENT: f64[] = [
  1e21, 1e22, 1.5e21, 3.439070283483335e35, 1.3076622631878654e65,
  9.03725590277404e159, -1.2345678901234567e123, 1.7976931348623157e308,
];
const SUBNORMAL_BOUNDARY: f64[] = [
  5e-324, 1e-323, 1.2e-322, 2.2250738585072014e-308,
  2.2250738585072009e-308, 1.7976931348623157e308, 9007199254740993,
  0.30000000000000004,
];
const RANDOMISH: f64[] = [
  6.62607015e-34, 5.444310685350916e14, 3.439070283483335e35, 0.1,
  43210.1, -5942736479622170.0, 2.2250738585072004e-308, 0.0001220703125,
  1.3076622631878654e65, 9.03725590277404e159, 0.5, 123456.789,
  -1.2345678901234567e123, 2.9802322387695312e-8, 3.141592653589793,
  0.30000000000000004,
];

let current: f64[] = ZERO_SPECIAL;

benchBucket("zero-special", ZERO_SPECIAL);
benchBucket("tiny-fixed", TINY_FIXED);
benchBucket("fixed-fractions", FIXED_FRACTIONS);
benchBucket("long-fixed", LONG_FIXED);
benchBucket("small-exponent", SMALL_EXPONENT);
benchBucket("large-exponent", LARGE_EXPONENT);
benchBucket("subnormal-boundary", SUBNORMAL_BOUNDARY);
benchBucket("randomish", RANDOMISH);

function benchBucket(bucket: string, samples: f64[]): void {
  current = samples;
  for (let i = 0, n = samples.length; i < n; i++) {
    store<u64>(SIG_STORE + (<usize>i << 3), benchCoreDouble(unchecked(samples[i])));
  }
  const bytes = asciiBytes(samples);
  const prefix = "dtoa-stages-" + bucket;

  bench(prefix + "-core", benchCore, OPS, bytes);
  dumpToFile(prefix + "-core");
  bench(prefix + "-core-raw", benchCoreRaw, OPS, bytes);
  dumpToFile(prefix + "-core-raw");
  bench(prefix + "-digits", benchDigits, OPS, bytes);
  dumpToFile(prefix + "-digits");
  bench(prefix + "-buffered", benchBuffered, OPS, bytes);
  dumpToFile(prefix + "-buffered");
  bench(prefix + "-string", benchString, OPS, bytes);
  dumpToFile(prefix + "-string");
}

function benchCore(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u64>(benchCoreDouble(unchecked(current[i])));
  }
}
function benchCoreRaw(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u64>(benchCoreDoubleRaw(unchecked(current[i])));
  }
}
function benchDigits(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u64>(benchDigits64(load<u64>(SIG_STORE + (<usize>i << 3))));
  }
}
function benchBuffered(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u32>(dtoa_buffered(U16, unchecked(current[i])));
  }
}
function benchString(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<i32>(dtoa(unchecked(current[i])).length);
  }
}
