// Verifies assembly/dtoa.ts (dtoa/ftoa) against V8 ground truth.
//
//  f64: dtoa(v) must equal v.toString() (V8 is the exact oracle).
//  f32: ftoa(v) must equal the shortest decimal that round-trips to the f32,
//       formatted per ECMA-262 Number::toString. The oracle computes the exact
//       decimal with BigInt, tests floor/ceil candidates at each length, and
//       applies closest/ties-to-even selection. The ECMA formatter (ecmaFormat
//       below) is cross-validated against V8 on the f64 path, so a bug in it
//       surfaces as an f64 mismatch too.
//
// Usage: node scripts/dtoa/verify.mjs [nRandom]
import { readFileSync } from "node:fs";
import {
  ecmaFormat, refDouble, refFloat,
  f64bits, f32bits, f64from, f32from,
} from "./lib/oracle.mjs";

const wasmPath = new URL("../../build/dtoa.wasm", import.meta.url);
const bytes = readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, {
  env: { abort() { throw new Error("wasm abort"); } },
});
const {
  memory, dtoa_buffered, ftoa_buffered,
} = instance.exports;
// Exercise the public buffered UTF-16 writers into a separate buffer, then read
// the UTF-16 result.
const DST = memory.buffer.byteLength - 256;

function readUtf16(len) {
  const view = new Uint16Array(memory.buffer, DST, len);
  let s = "";
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  return s;
}
const asDtoa = (v) => readUtf16(dtoa_buffered(DST, v));
const asFtoa = (v) => readUtf16(ftoa_buffered(DST, v));

let fails = 0;
const maxReport = 40;
function checkD(v) {
  const got = asDtoa(v);
  const want = Number.isFinite(v) ? v.toString() : refDouble(v);
  // also cross-check our JS formatter equals V8 on finite values
  if (Number.isFinite(v) && refDouble(v) !== want) {
    if (fails++ < maxReport) console.log(`FORMATTER-BUG v=${v} ref=${refDouble(v)} v8=${want}`);
  }
  if (got !== want) {
    if (fails++ < maxReport) console.log(`f64 MISMATCH bits=0x${f64bits(v)} v=${v}\n  got =${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`);
    return false;
  }
  return true;
}
function checkF(v32) {
  const v = Math.fround(v32);
  const got = asFtoa(v);
  const want = refFloat(v);
  if (got !== want) {
    if (fails++ < maxReport) console.log(`f32 MISMATCH bits=0x${f32bits(v)} v=${v}\n  got =${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`);
    return false;
  }
  return true;
}

// ---- Edge cases -----------------------------------------------------------
const edgeD = [
  0, -0, 1, -1, 0.5, -0.5, 0.1, 0.2, 0.3, 100, 1000, 1e21, 1e-7, 1e-6, 1e-5,
  1e20, 1e22, 9e20, 1.5e21, 123456.789, -5942736479622170.0, 5e-324,
  2.2250738585072014e-308, 2.2250738585072009e-308, 1.7976931348623157e308,
  9007199254740992, 9007199254740993, 4503599627370497, 0.0001, 0.00001,
  Infinity, -Infinity, NaN, 1e-323, 1.2e-322, 3.141592653589793,
  100000000000000000000, 1000000000000000000000, 0.30000000000000004,
];
for (const v of edgeD) checkD(v);
// powers of two and ±1 ulp
for (let e = 0; e < 2047; e++) {
  const b = BigInt(e) << 52n;
  checkD(f64from(b)); checkD(f64from(b | 1n)); checkD(f64from(b | 0xFn));
}
// powers of ten
for (let p = -323; p <= 308; p++) checkD(Number(`1e${p}`));

const edgeF = [
  0, -0, 1, -1, 0.5, 0.1, 100, 1e20, 1e-7, 3.4028235e38, 1.1754944e-38,
  1.4e-45, 1e-45, 16777216, 8388608, 1.342178e8, 9.999999e9, Infinity, NaN,
];
for (const v of edgeF) checkF(v);
// all f32 powers of two + low bits
for (let e = 0; e < 255; e++) {
  const b = (e << 23) >>> 0;
  checkF(f32from(b)); checkF(f32from((b | 1) >>> 0)); checkF(f32from((b | 0xF) >>> 0));
}

const edgeFails = fails;
console.log(`edge cases: ${edgeFails === 0 ? "OK" : edgeFails + " FAIL"}`);

// ---- Random fuzz -----------------------------------------------------------
const N = parseInt(process.argv[2] || "2000000", 10);
let rng = 0x12345678 >>> 0;
function rand32() { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return rng >>> 0; }
function randBig64() { return (BigInt(rand32()) << 32n) | BigInt(rand32()); }

let cntD = 0, cntF = 0;
for (let i = 0; i < N; i++) {
  const v = f64from(randBig64());
  if (Number.isNaN(v)) continue;
  cntD++;
  if (!checkD(v) && fails > 200) break;
}
for (let i = 0; i < N; i++) {
  const v = f32from(rand32());
  if (Number.isNaN(v)) continue;
  cntF++;
  if (!checkF(v) && fails > 200) break;
}
console.log(`random: f64=${cntD} f32=${cntF} checked, total fails=${fails}`);
process.exit(fails === 0 ? 0 : 1);
