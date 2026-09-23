// Isolates the normalized 16-digit f64 packing and layout path. Each operation
// formats eight values; divide ns/op by eight for per-conversion latency.

import { bench, dumpToFile, blackbox } from "../assembly/__benches__/lib/bench";
import { dtoa_buffered } from "../assembly/dtoa";

const U16 = memory.data(128);
const OPS: u64 = 100_000;
const FIXED: f64[] = [
  0.1, 0.2, 0.3, 0.30000000000000004, 123456.789, 43210.1,
  0.0001220703125, 3.141592653589793,
];
const EXPONENT: f64[] = [
  1e-7, 1e-50, 1e-100, 6.62607015e-34, 1e21, 3.439070283483335e35,
  -1.2345678901234567e123, 1.7976931348623157e308,
];

bench("f64-fixed16-fixed", benchFixed, OPS);
dumpToFile("f64-fixed16-fixed");
bench("f64-fixed16-exponent", benchExponent, OPS);
dumpToFile("f64-fixed16-exponent");

function benchFixed(): void {
  for (let i = 0; i < FIXED.length; ++i) blackbox<u32>(dtoa_buffered(U16, unchecked(FIXED[i])));
}

function benchExponent(): void {
  for (let i = 0; i < EXPONENT.length; ++i) blackbox<u32>(dtoa_buffered(U16, unchecked(EXPONENT[i])));
}
