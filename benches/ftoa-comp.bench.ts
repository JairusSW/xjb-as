// ftoa (f32) latency: xjb and stdlib, allocating and buffered APIs.
// Eight series per bucket; results in build/logs/as/<runtime>/.

import { bench, dumpToFile, blackbox } from "../assembly/__benches__/lib/bench";
import { ftoa, ftoa_buffered } from "../assembly/ftoa";
import {
  dtoa as stdlibDtoa,
  dtoa_buffered as stdlibDtoaBuffered,
} from "~lib/util/number";

const U16 = memory.data(128);
const OPS: u64 = 100_000;

// Decimal output is ASCII: one UTF-16 code unit represents one output byte.
// Measure the API actually timed, since stdlib retains trailing ".0".
function outputBytes(samples: f32[], implementation: i32): u64 {
  let bytes: u64 = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = unchecked(samples[i]);
    if (implementation == 0) bytes += ftoa_buffered(U16, value);
    else if (implementation == 1) bytes += ftoa(value).length;
    else if (implementation == 2) bytes += stdlibDtoaBuffered<f32>(U16, value);
    else bytes += stdlibDtoa<f32>(value).length;
  }
  return bytes;
}

const ZERO_SPECIAL: f32[] = [0, -0, Infinity, -Infinity, NaN, 0, -0, Infinity];
const TINY_FIXED: f32[] = [1, -1, 0.5, -0.5, 10, 100, 1e-6, 2.5];
const FIXED_FRACTIONS: f32[] = [
  3.14159, 0.1, 43210.1, 1.25, -3.5, 0.0001, 123.4567, -0.0625,
];
const SMALL_EXPONENT: f32[] = [
  1e-7, 1e-12, 1e-20, 6.62607e-34, 2.9802322e-8, 1.5e-45, 7.0064923e-44,
  9.999999e-5,
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
  3.4028235e38, 1.1754944e-38, 0.5, 123456.78, 2.9802322e-8, 100.0, 9.999999e-5,
  1.5e-45, 7.0064923e-44, 8388608.0,
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
  const prefix = "ftoa-comp-" + bucket;

  bench(prefix + "-xjb-noalloc", benchXjbNoalloc, OPS, outputBytes(samples, 0));
  dumpToFile(prefix + "-xjb-noalloc");

  bench(prefix + "-xjb-alloc", benchXjbAlloc, OPS, outputBytes(samples, 1));
  dumpToFile(prefix + "-xjb-alloc");


  bench(prefix + "-stdlib-alloc", benchStdlibAlloc, OPS, outputBytes(samples, 3));
  dumpToFile(prefix + "-stdlib-alloc");

  bench(prefix + "-stdlib-noalloc", benchStdlibNoalloc, OPS, outputBytes(samples, 2));
  dumpToFile(prefix + "-stdlib-noalloc");
}

function benchXjbNoalloc(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u32>(ftoa_buffered(U16, unchecked(current[i])));
  }
}
function benchXjbAlloc(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<i32>(ftoa(unchecked(current[i])).length);
  }
}
function benchStdlibAlloc(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<i32>(stdlibDtoa<f32>(unchecked(current[i])).length);
  }
}
function benchStdlibNoalloc(): void {
  for (let i = 0, n = current.length; i < n; i++) {
    blackbox<u32>(stdlibDtoaBuffered<f32>(U16, unchecked(current[i])));
  }
}
