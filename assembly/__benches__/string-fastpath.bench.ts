// assembly/__benches__ twin of benches/string-fastpath.bench.ts.

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { dtoa } from "../dtoa";
import { ftoa } from "../ftoa";

const OPS: u64 = 100_000;
const F64_SMALL: f64[] = [1, -7, 42, -99, 100, -999, 1000, -9999];
const F64_LARGE: f64[] = [
  10000, -123456, 1000000, -12345678, 99999999, -100000000, 999999999, -1000000000,
];
const F32_SMALL: f32[] = [1, -7, 42, -99, 100, -999, 1000, -9999];
const F32_LARGE: f32[] = [
  10000, -123456, 1000000, -1234567, 9999999, -10000000, 16777215, -16777216,
];
const F32_EIGHT_DIGITS: f32[] = [
  10000000, -10000001, 12345678, -12345679, 16000000, -16000001, 16777215, -16777216,
];

bench("string-fastpath-f64-small", benchF64Small, OPS);
dumpToFile("string-fastpath-f64-small");
bench("string-fastpath-f64-large", benchF64Large, OPS);
dumpToFile("string-fastpath-f64-large");
bench("string-fastpath-f32-small", benchF32Small, OPS);
dumpToFile("string-fastpath-f32-small");
bench("string-fastpath-f32-large", benchF32Large, OPS);
dumpToFile("string-fastpath-f32-large");
bench("string-fastpath-f32-eight-digits", benchF32EightDigits, OPS);
dumpToFile("string-fastpath-f32-eight-digits");

function benchF64Small(): void {
  for (let i = 0; i < F64_SMALL.length; ++i) blackbox<i32>(dtoa(unchecked(F64_SMALL[i])).length);
}

function benchF64Large(): void {
  for (let i = 0; i < F64_LARGE.length; ++i) blackbox<i32>(dtoa(unchecked(F64_LARGE[i])).length);
}

function benchF32Small(): void {
  for (let i = 0; i < F32_SMALL.length; ++i) blackbox<i32>(ftoa(unchecked(F32_SMALL[i])).length);
}

function benchF32Large(): void {
  for (let i = 0; i < F32_LARGE.length; ++i) blackbox<i32>(ftoa(unchecked(F32_LARGE[i])).length);
}

function benchF32EightDigits(): void {
  for (let i = 0; i < F32_EIGHT_DIGITS.length; ++i) blackbox<i32>(ftoa(unchecked(F32_EIGHT_DIGITS[i])).length);
}
