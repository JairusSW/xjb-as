import { describe, expect } from "as-test";
import { ftoa } from "../ftoa";

describe("ftoa: exact-integer fast path", () => {
  expect(ftoa(<f32>1)).toBe("1");
  expect(ftoa(<f32>-1234)).toBe("-1234");
  expect(ftoa(<f32>10000000)).toBe("10000000");
  expect(ftoa(<f32>16777215)).toBe("16777215");
  expect(ftoa(<f32>16777216)).toBe("16777216");
  expect(ftoa(<f32>16777218)).toBe("16777218");
  expect(ftoa(<f32>1234.5)).toBe("1234.5");
});
