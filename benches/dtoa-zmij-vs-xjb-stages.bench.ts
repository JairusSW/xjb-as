// Per-stage latency comparison: zmij-as v0.1 vs xjb-as, f64, by input complexity.
//
// Stages timed:
//   core          binary -> shortest decimal (toDecimalDouble)
//   core-digits   core + toDigits64 (chain, so digits = core-digits - core)
//   buffered      full no-alloc dtoa_buffered total
//   string        full allocating dtoa total
//
// Chart derives: digits = core-digits - core
//                noalloc-rest = buffered - core-digits
//                string-overhead = string - buffered
//
// Stems: dtoa-zmij-vs-xjb-stages-<bucket>-{zmij,xjb}-{core,core-digits,buffered,string}
// Run: npm run bench -- dtoa-zmij-vs-xjb-stages

import { bench, dumpToFile, blackbox } from "../assembly/__benches__/lib/bench";
import { dtoa as zmijDtoa, dtoa_buffered as zmijBuffered } from "../vendor/zmij-as/assembly/dtoa";
import { dtoa as xjbDtoa,  dtoa_buffered as xjbBuffered  } from "../assembly/dtoa";
import {
    benchCoreDouble    as zmijBenchCoreDouble,
    benchDigits64      as zmijBenchDigits64,
} from "../assembly/__benches__/stage-hooks-zmij";
import {
    benchCoreDouble    as xjbBenchCoreDouble,
    benchDigits64      as xjbBenchDigits64,
} from "../assembly/__benches__/stage-hooks";

const U16 = memory.data(128);
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
  const bytes = asciiBytes(samples);
  const prefix = "dtoa-zmij-vs-xjb-stages-" + bucket;

  bench(prefix + "-zmij-core",         benchZmijCore,        OPS, bytes);
  dumpToFile(prefix + "-zmij-core");
  bench(prefix + "-xjb-core",          benchXjbCore,         OPS, bytes);
  dumpToFile(prefix + "-xjb-core");

  bench(prefix + "-zmij-core-digits",  benchZmijCoreDigits,  OPS, bytes);
  dumpToFile(prefix + "-zmij-core-digits");
  bench(prefix + "-xjb-core-digits",   benchXjbCoreDigits,   OPS, bytes);
  dumpToFile(prefix + "-xjb-core-digits");

  bench(prefix + "-zmij-buffered",     benchZmijBuffered,    OPS, bytes);
  dumpToFile(prefix + "-zmij-buffered");
  bench(prefix + "-xjb-buffered",      benchXjbBuffered,     OPS, bytes);
  dumpToFile(prefix + "-xjb-buffered");

  bench(prefix + "-zmij-string",       benchZmijString,      OPS, bytes);
  dumpToFile(prefix + "-zmij-string");
  bench(prefix + "-xjb-string",        benchXjbString,       OPS, bytes);
  dumpToFile(prefix + "-xjb-string");
}

// core: just toDecimalDouble (+ normalization)
function benchZmijCore(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u64>(zmijBenchCoreDouble(unchecked(current[i])));
  }
}
function benchXjbCore(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u64>(xjbBenchCoreDouble(unchecked(current[i])));
  }
}

// core-digits: core then toDigits64 chained — no pre-computed SIG_STORE needed
function benchZmijCoreDigits(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u64>(zmijBenchDigits64(zmijBenchCoreDouble(unchecked(current[i]))));
  }
}
function benchXjbCoreDigits(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u64>(xjbBenchDigits64(xjbBenchCoreDouble(unchecked(current[i]))));
  }
}

function benchZmijBuffered(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u32>(zmijBuffered(U16, unchecked(current[i])));
  }
}
function benchXjbBuffered(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u32>(xjbBuffered(U16, unchecked(current[i])));
  }
}
function benchZmijString(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<i32>(zmijDtoa(unchecked(current[i])).length);
  }
}
function benchXjbString(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<i32>(xjbDtoa(unchecked(current[i])).length);
  }
}
