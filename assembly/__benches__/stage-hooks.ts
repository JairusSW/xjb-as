// Bench-only stage hooks.
//
// NOT part of the public API (the package surface is index.ts, which exports
// only the stdlib-shaped dtoa/ftoa/*_buffered functions). These live outside
// dtoa.ts so the production file stays reachable - and therefore measurable at
// 100% coverage - purely through its four public entry points; the hooks here
// are exercised only by the *-stages benches, never by the test specs.
//
// They let dtoa-stages.bench.ts / ftoa-stages.bench.ts time each pipeline stage
// of dtoa()/ftoa() in isolation:
//
//   core   -> benchCore*    binary -> shortest decimal (Schubfach)
//   digits -> benchDigits*  decimal significand -> packed ASCII digit block
//
// (the layout and String-allocation steps are derived in the chart from the
// full dtoa_buffered / dtoa totals - see scripts/charts/dtoa-stages.mjs).
//
// The benchCore* hooks mirror the formatDouble / formatFloat prologue exactly -
// including special/subnormal handling and the f32 short-significand fixup - so
// per-bucket costs stay faithful and the returned value is precisely the
// significand the writers feed to toDigits64/toDigits32. Keep in sync with
// formatDouble / formatFloat in dtoa.ts. Each returns a value derived from the
// stage outputs so the optimizer cannot eliminate the work.
import { toDecimalDouble } from "../dtoa";
import {
    toDigits64,
    gSig,
    gExp,
    gLastDigit,
    gHasLastDigit,
    gDigHi,
    gDigLo,
    gDigNum,
} from "../xjb";

export function benchCoreDouble(value: f64): u64 {
    const bits = reinterpret<u64>(value);
    const binExp = <i32>((bits << 1) >> 53);
    const binSig = bits & (((<u64>1) << 52) - 1);
    const expMask = 2047;
    const isNormal = <u32>(binExp - 1) < <u32>(expMask - 1);
    if (!isNormal) {
        if (binExp != 0) return 0; // NaN / Infinity: no decimal core work
        if (binSig == 0) return 0; // +/-0
        // subnormal (mirrors formatDouble)
        toDecimalDouble(binSig, 0, true);
    } else {
        toDecimalDouble(binSig, binExp, binSig != 0);
    }
    const threshold: u64 = 1000000000000000;
    if (<u64>gSig < threshold) {
        let decSig = <u64>gSig * 10 + <u64>(gHasLastDigit ? gLastDigit : 0);
        let decExp = gExp;
        while (decSig < threshold) {
            decSig *= 10;
            --decExp;
        }
        if (decSig < 10000000000000000) {
            gSig = <i64>decSig;
            gExp = decExp - 1;
            gLastDigit = 0;
            gHasLastDigit = false;
        } else {
            const q = <i64>(decSig / 10);
            const last = <i32>(decSig - <u64>q * 10);
            gSig = q;
            gExp = decExp;
            gLastDigit = last;
            gHasLastDigit = last != 0;
        }
    }
    return <u64>gSig ^ (<u64>gLastDigit << 60) ^ (<u64>i32(gHasLastDigit) << 63);
}

export function benchCoreDoubleRaw(value: f64): u64 {
    const bits = reinterpret<u64>(value);
    const binExp = <i32>((bits << 1) >> 53);
    const binSig = bits & (((<u64>1) << 52) - 1);
    const expMask = 2047;
    const isNormal = <u32>(binExp - 1) < <u32>(expMask - 1);
    if (!isNormal) {
        if (binExp != 0) return 0; // NaN / Infinity: no decimal core work
        if (binSig == 0) return 0; // +/-0
        toDecimalDouble(binSig, 0, true);
    } else {
        toDecimalDouble(binSig, binExp, binSig != 0);
    }
    return <u64>gSig ^ (<u64>gExp << 32) ^ (<u64>gLastDigit << 60) ^ (<u64>i32(gHasLastDigit) << 63);
}

// The f32 core hook lives in stage-hooks-comp.ts (ftoa.ts is self-contained with
// its own decimal-result globals, so it can't share these xjb.ts ones).

export function benchDigits64(sig: u64): u64 {
    toDigits64(sig);
    return gDigHi ^ gDigLo ^ (<u64>gDigNum);
}

// benchDigits32 lives in stage-hooks-comp.ts (f32 digit conversion is in ftoa.ts).
