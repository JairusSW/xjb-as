// Per-stage latency of the ftoa (f32) pipeline, by input complexity.
// f32 counterpart of dtoa-stages.bench.ts; stems are ftoa-stages-*. See that
// file for the stage definitions and how the chart derives the rest.

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { ftoa, ftoa_buffered } from "../dtoa";
import { benchCoreFloat, benchDigits32 } from "./stage-hooks";

const U16 = memory.data(128);
const SIG_STORE = memory.data(16 * 8);
const OPS: u64 = 100_000;

function asciiBytes(samples: f32[]): u64 {
  return u64(samples.map<string>((s) => s.toString()).join("").length);
}

const ZERO_SPECIAL: f32[] = [
  0, -0, Infinity, -Infinity, NaN, 0, -0, Infinity,
];
const TINY_FIXED: f32[] = [
  1, -1, 0.5, -0.5, 10, 100, 1e-6, 2.5,
];
const FIXED_FRACTIONS: f32[] = [
  3.14159, 0.1, 43210.1, 1.25, -3.5, 0.0001, 123.4567, -0.0625,
];
const SMALL_EXPONENT: f32[] = [
  1e-7, 1e-12, 1e-20, 6.62607e-34, 2.9802322e-8, 1.5e-45, 7.0064923e-44, 9.999999e-5,
];
const LARGE_EXPONENT: f32[] = [
  1e21, 1e25, 1e30, 1e35, 3.4028235e38, 9.999999e9, 1.342178e8, 1.3421781e8,
];
const SUBNORMAL_BOUNDARY: f32[] = [
  1.401298464324817e-45, 1.1754943508222875e-38, 3.4028234663852886e38,
  16777216, 8388608, 9.999999e9, 1.5e-45, 7.0064923e-44,
];
const RANDOMISH: f32[] = [
  6.62607e-34, 1.342178e8, 1.3421781e8, 1.0, 43210.1, 0.0001220703125,
  3.4028235e38, 1.1754944e-38, 0.5, 123456.78, 2.9802322e-8, 100.0,
  9.999999e-5, 1.5e-45, 7.0064923e-44, 8388608.0,
];

let current: f32[] = ZERO_SPECIAL;

benchBucket("zero-special", ZERO_SPECIAL);
benchBucket("tiny-fixed", TINY_FIXED);
benchBucket("fixed-fractions", FIXED_FRACTIONS);
benchBucket("small-exponent", SMALL_EXPONENT);
benchBucket("large-exponent", LARGE_EXPONENT);
benchBucket("subnormal-boundary", SUBNORMAL_BOUNDARY);
benchBucket("randomish", RANDOMISH);

function benchBucket(bucket: string, samples: f32[]): void {
  current = samples;
  for (let i = 0, n = samples.length; i < n; i++) {
    store<u64>(SIG_STORE + (<usize>i << 3), benchCoreFloat(unchecked(samples[i])));
  }
  const bytes = asciiBytes(samples);
  const prefix = "ftoa-stages-" + bucket;

  bench(prefix + "-core", benchCore, OPS, bytes);
  dumpToFile(prefix + "-core");
  bench(prefix + "-digits", benchDigits, OPS, bytes);
  dumpToFile(prefix + "-digits");
  bench(prefix + "-buffered", benchBuffered, OPS, bytes);
  dumpToFile(prefix + "-buffered");
  bench(prefix + "-string", benchString, OPS, bytes);
  dumpToFile(prefix + "-string");
}

function benchCore(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u64>(benchCoreFloat(unchecked(current[i])));
  }
}
function benchDigits(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u64>(benchDigits32(load<u64>(SIG_STORE + (<usize>i << 3))));
  }
}
function benchBuffered(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u32>(ftoa_buffered(U16, unchecked(current[i])));
  }
}
function benchString(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<i32>(ftoa(unchecked(current[i])).length);
  }
}
