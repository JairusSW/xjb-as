// Bench-only stage hooks.
//
// NOT part of the public API (the package surface is index.ts, which exports
// only the stdlib-shaped dtoa/ftoa/*_buffered functions). These live outside
// dtoa.ts so the production file stays reachable - and therefore measurable at
// 100% coverage - purely through its four public entry points; the hooks here
// are exercised only by the *-stages benches, never by the test specs.
//
// These are standalone general-conversion kernels. Integer/special shortcuts
// in the public API can bypass them, so their timings are not additive stages
// of a complete dtoa call. Core return values are checksums, not digit inputs.
import { toDecimalDouble, normalizeDoubleShortest } from "../dtoa";
import {
    toDigits64Fixed16,
    gSig,
    gExp,
    gLastDigit,
    gHasLastDigit,
    gDigHi,
    gDigLo,
} from "../xjb";

export function benchCoreDouble(value: f64): u64 {
    const bits = reinterpret<u64>(value);
    const binExp = <i32>((bits << 1) >> 53);
    const binSig = bits & (((<u64>1) << 52) - 1);
    const expMask = 2047;
    const isNormal = <u32>(binExp - 1) < <u32>(expMask - 1);
    if (!isNormal) {
        if (binExp != 0) { gSig = 0; return 0; } // NaN / Infinity: no decimal core work
        if (binSig == 0) { gSig = 0; return 0; } // +/-0
        // subnormal (mirrors formatDouble)
        toDecimalDouble(binSig, 0, true);
    } else {
        toDecimalDouble(binSig, binExp, binSig != 0);
    }
    const threshold: u64 = 1000000000000000;
    if (<u64>gSig < threshold) normalizeDoubleShortest();
    return <u64>gSig ^ (<u64>gLastDigit << 60) ^ (<u64>i32(gHasLastDigit) << 63);
}

export function benchCoreDoubleRaw(value: f64): u64 {
    const bits = reinterpret<u64>(value);
    const binExp = <i32>((bits << 1) >> 53);
    const binSig = bits & (((<u64>1) << 52) - 1);
    const expMask = 2047;
    const isNormal = <u32>(binExp - 1) < <u32>(expMask - 1);
    if (!isNormal) {
        if (binExp != 0) { gSig = 0; return 0; } // NaN / Infinity: no decimal core work
        if (binSig == 0) { gSig = 0; return 0; } // +/-0
        toDecimalDouble(binSig, 0, true);
    } else {
        toDecimalDouble(binSig, binExp, binSig != 0);
    }
    return <u64>gSig ^ (<u64>gExp << 32) ^ (<u64>gLastDigit << 60) ^ (<u64>i32(gHasLastDigit) << 63);
}

// The f32 core hook lives in stage-hooks-comp.ts. Both cores share result slots.

export function benchDigits64(sig: u64): u64 {
    toDigits64Fixed16(sig);
    return gDigHi ^ gDigLo;
}

// benchDigits32 lives in stage-hooks-comp.ts.

// Setup-only checks: never run inside the timed digit loop.
export function validateDigits64(sig: u64): void {
    if (sig >= 10000000000000000) throw new Error("invalid f64 digit-kernel input");
    benchDigits64(sig);
    const expected = sig.toString().padStart(16, "0");
    for (let i = 0; i < 16; ++i) {
        const block = i < 8 ? gDigHi : gDigLo;
        const digit = <u32>(block >> ((i & 7) << 3)) & 255;
        if (digit != expected.charCodeAt(i)) throw new Error("invalid f64 packed digits");
    }
}
