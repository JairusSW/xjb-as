// f32 core stage hook for ftoa.ts (the self-contained compact f32). Kept separate
// from stage-hooks.ts because ftoa.ts has its own decimal-result globals.
import {
    toDecimalFloat,
    FLOAT_MAX_DIGITS10,
    toDigits32,
    gSig,
    gExp,
    gLastDigit,
    gHasLastDigit,
    gDigHi,
    gDigNum,
} from "../ftoa";

export function benchDigits32(sig: u64): u64 {
    toDigits32(sig);
    return gDigHi ^ (<u64>gDigNum);
}

export function benchCoreFloat(value: f32): u64 {
    const bits = reinterpret<u32>(value);
    const binExp = <i32>((bits << 1) >> 24);
    const binSig = <u64>(bits & (((<u32>1) << 23) - 1));
    const threshold: u64 = 10000000;
    const expMask = 255;
    const isNormal = <u32>(binExp - 1) < <u32>(expMask - 1);
    if (!isNormal) {
        if (binExp != 0) return 0;
        if (binSig == 0) return 0;
        toDecimalFloat(binSig, 1, true);
        let decSig = gSig * 10 + (gHasLastDigit ? gLastDigit : 0);
        let decExp = gExp;
        while (<u64>decSig < threshold) {
            decSig *= 10;
            --decExp;
        }
        const q = <i64>(<u64>decSig / 10);
        const last = <i32>(decSig - q * 10);
        gSig = q;
        gExp = decExp;
        gLastDigit = last;
        gHasLastDigit = last != 0;
    } else {
        toDecimalFloat(binSig | ((<u64>1) << 23), binExp, binSig != 0);
    }
    let hasLastDigit = gHasLastDigit;
    const hasExtraDigit = <u64>gSig >= threshold;
    let decExp = gExp + FLOAT_MAX_DIGITS10 - 2 + i32(hasExtraDigit);
    if (<u64>gSig < 1000000) {
        gSig = 10 * gSig + (hasLastDigit ? gLastDigit : 0);
        --decExp;
    }
    return <u64>gSig;
}
