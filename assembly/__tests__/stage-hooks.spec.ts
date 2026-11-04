import { describe, expect } from "as-test";
import { benchCoreDouble, benchDigits64, validateDigits64 } from "../__benches__/stage-hooks";
import { benchCoreFloat, validateDigits32 } from "../__benches__/stage-hooks-comp";
import { gSig, gDigNum } from "../xjb";

describe("digit kernel setup uses significands, not core checksums", () => {
    const values: f64[] = [0.30000000000000004, f64.MAX_VALUE, 1, 10, 1000, f64.MIN_VALUE];
    for (let i = 0; i < values.length; ++i) {
        benchCoreDouble(values[i]);
        const sig = <u64>gSig;
        expect(sig < 10000000000000000).toBe(true);
        validateDigits64(sig);
    }
    const checksum = benchCoreDouble(0.30000000000000004);
    expect(<u64>gSig).toBe(3000000000000000);
    expect(checksum >= 10000000000000000).toBe(true);
    benchCoreDouble(Infinity);
    expect(gSig).toBe(0);
    validateDigits64(0);
    benchCoreDouble(0);
    expect(gSig).toBe(0);
});

describe("f64 digit kernel uses production fixed-width packing", () => {
		// @ts-expect-error: valid
    gDigNum = 123;
    benchDigits64(1234567890123456);
    expect(gDigNum).toBe(123);
    validateDigits64(1234567890123456);
});

describe("f32 kernel setup validates digits and clears special values", () => {
    const values: f32[] = [0.1, 1, 1000, f32.MIN_VALUE, f32.MAX_VALUE];
    for (let i = 0; i < values.length; ++i) validateDigits32(benchCoreFloat(values[i]));
    expect(benchCoreFloat(Infinity)).toBe(0);
    expect(gSig).toBe(0);
    validateDigits32(0);
});
