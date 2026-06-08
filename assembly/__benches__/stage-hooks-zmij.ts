// Stage hooks for zmij-as v0.1 (submodule). Mirrors stage-hooks.ts exactly,
// but imports from vendor/zmij-as so both implementations can be timed in
// isolation within the same bench compilation unit.
import {
    toDecimalDouble,
    toDecimalFloat,
    toDigits64,
    toDigits32,
    FLOAT_MAX_DIGITS10,
    gSig,
    gExp,
    gLastDigit,
    gHasLastDigit,
    gDigHi,
    gDigLo,
    gDigNum,
} from "../../vendor/zmij-as/assembly/dtoa";

export function benchCoreDouble(value: f64): u64 {
    const bits = reinterpret<u64>(value);
    const binExp = <i32>((bits << 1) >> 53);
    const binSig = bits & (((<u64>1) << 52) - 1);
    const expMask = 2047;
    const isNormal = <u32>(binExp - 1) < <u32>(expMask - 1);
    if (!isNormal) {
        if (binExp != 0) return 0;
        if (binSig == 0) return 0;
        toDecimalDouble(binSig, 0, true); // subnormal: no implicit 1 bit
    } else {
        // zmij's toDecimalDouble expects the full significand (caller adds implicit 1 bit,
        // unlike the xjb version which handles it internally)
        toDecimalDouble(binSig | ((<u64>1) << 52), binExp, binSig != 0);
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
        if (binExp != 0) return 0;
        if (binSig == 0) return 0;
        toDecimalDouble(binSig, 0, true);
    } else {
        toDecimalDouble(binSig | ((<u64>1) << 52), binExp, binSig != 0);
    }
    return <u64>gSig ^ (<u64>gExp << 32) ^ (<u64>gLastDigit << 60) ^ (<u64>i32(gHasLastDigit) << 63);
}

export function benchDigits64(sig: u64): u64 {
    toDigits64(sig);
    return gDigHi ^ gDigLo ^ (<u64>gDigNum);
}
