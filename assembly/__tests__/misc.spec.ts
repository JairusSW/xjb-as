import { describe, expect } from "as-test";
import { dtoa, ftoa, dtoa_buffered, ftoa_buffered, toDecimalDouble, gSig } from "../dtoa";

const BUF = new ArrayBuffer(128);
const BUF_PTR = changetype<usize>(BUF);

function bufDtoa(v: f64): string {
    const units = dtoa_buffered(BUF_PTR, v);
    return String.UTF16.decodeUnsafe(BUF_PTR, (<usize>units) << 1);
}
function bufFtoa(v: f32): string {
    const units = ftoa_buffered(BUF_PTR, v);
    return String.UTF16.decodeUnsafe(BUF_PTR, (<usize>units) << 1);
}

const f64s: f64[] = [
    reinterpret<f64>(<u64>0x0), // +0
    reinterpret<f64>(<u64>0x8000000000000000), // -0
    1.0,
    -1.0,
    0.5,
    reinterpret<f64>(<u64>0x3fb999999999999a), // 0.1
    reinterpret<f64>(<u64>0x40fe240c9fbe76c9), // 123456.789
    reinterpret<f64>(<u64>0x444b1ae4d6e2ef50), // 1e+21 (exp notation)
    reinterpret<f64>(<u64>0x3e7ad7f29abcaf48), // 1e-7  (exp notation)
    reinterpret<f64>(<u64>0x1), // 5e-324 (subnormal)
    reinterpret<f64>(<u64>0x7fefffffffffffff), // 1.7976931348623157e+308 (two digit blocks)
    reinterpret<f64>(<u64>0x4340000000000000), // 9007199254740992
    Infinity,
    -Infinity,
    NaN,
];

describe("dtoa_buffered == dtoa", () => {
    for (let i = 0; i < f64s.length; i++) {
        expect(bufDtoa(f64s[i])).toBe(dtoa(f64s[i]));
    }
});

const f32s: f32[] = [
    reinterpret<f32>(<u32>0x0), // +0
    reinterpret<f32>(<u32>0x80000000), // -0
    <f32>1.0,
    <f32>-1.0,
    <f32>0.5,
    reinterpret<f32>(<u32>0x3dcccccd), // 0.1
    reinterpret<f32>(<u32>0x42c80000), // 100
    reinterpret<f32>(<u32>0x4728ca1a), // 43210.1
    reinterpret<f32>(<u32>0x60ad78ec), // 1e20 (exp notation)
    reinterpret<f32>(<u32>0x33d6bf95), // 1e-7 (exp notation)
    reinterpret<f32>(<u32>0x800000), // 1.1754944e-38 (smallest normal)
    reinterpret<f32>(<u32>0x1), // 1e-45 (subnormal)
    reinterpret<f32>(<u32>0x7f7fffff), // 3.4028235e+38
    <f32>Infinity,
    reinterpret<f32>(<u32>0xff800000), // -Infinity
    <f32>NaN,
];

describe("ftoa_buffered == ftoa", () => {
    for (let i = 0; i < f32s.length; i++) {
        expect(bufFtoa(f32s[i])).toBe(ftoa(f32s[i]));
    }
});

// ftoa's signed-Infinity ternary (the generated spec only covers +Infinity).
describe("ftoa -Infinity", () => {
    expect(ftoa(reinterpret<f32>(<u32>0xff800000))).toBe("-Infinity");
});

describe("dtoa f64 power boundary core", () => {
    let seen: u64 = 0;
    for (let rawExp = 1; rawExp < 2047; rawExp++) {
        toDecimalDouble(0, rawExp, false);
        seen ^= <u64>gSig;
    }
    expect(seen).not.toBe(0);
});
