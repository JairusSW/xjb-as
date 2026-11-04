// f32 core stage hook; decimal-result slots are shared with the f64 engine.
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
    		// @ts-expect-error: valid
        if (binExp != 0) { gSig = 0; return 0; }
        // @ts-expect-error: valid
        if (binSig == 0) { gSig = 0; return 0; }
        toDecimalFloat(binSig, 1, true);
        let decSig = gSig * 10 + (gHasLastDigit ? gLastDigit : 0);
        let decExp = gExp;
        if (<u64>decSig < 10000) { decSig *= 10000; decExp -= 4; }
        if (<u64>decSig < 1000000) { decSig *= 100; decExp -= 2; }
        if (<u64>decSig < threshold) { decSig *= 10; --decExp; }
        const q = <i64>(<u64>decSig / 10);
        const last = <i32>(decSig - q * 10);
        // @ts-expect-error: valid
        gSig = q;
        // @ts-expect-error: valid
        gExp = decExp;
        // @ts-expect-error: valid
        gLastDigit = last;
        // @ts-expect-error: valid
        gHasLastDigit = last != 0;
    } else {
        toDecimalFloat(binSig | ((<u64>1) << 23), binExp, binSig != 0);
    }
    let hasLastDigit = gHasLastDigit;
    const hasExtraDigit = <u64>gSig >= threshold;
    let decExp = gExp + FLOAT_MAX_DIGITS10 - 2 + i32(hasExtraDigit);
    if (<u64>gSig < 1000000) {
    		// @ts-expect-error: valid
        gSig = 10 * gSig + (hasLastDigit ? gLastDigit : 0);
        --decExp;
    }
    return <u64>gSig;
}

export function validateDigits32(sig: u64): void {
    if (sig >= 100000000) throw new Error("invalid f32 digit-kernel input");
		benchDigits32(sig);
		// @ts-ignore
    const expected = sig.toString().padStart(8, "0");
    for (let i = 0; i < 8; ++i)
        if ((<u32>(gDigHi >> (i << 3)) & 255) != expected.charCodeAt(i))
            throw new Error("invalid f32 packed digits");
}
