import { describe, expect } from "as-test";
import { SCRATCH, scratchString } from "../xjb";

describe("scratch strings preserve every UTF-16 unit across copy boundaries", () => {
    for (let units: usize = 0; units <= 64; ++units) {
        let expected = "";
        for (let i: usize = 0; i < units; ++i) {
            const code = 0x100 + <i32>i;
            store<u16>(SCRATCH + (i << 1), code);
            expected += String.fromCharCode(code);
        }
        const actual = scratchString(units << 1);
        __collect();
        expect(actual).toBe(expected);
    }
});
