import { describe, expect } from "as-test";
import { dtoa } from "../dtoa";

describe("dtoa: exact-integer string fast path", () => {
  for (let value = 1; value < 10000; ++value) {
    let expected = value.toString();
    expect(dtoa(<f64>value)).toBe(expected);
    expect(dtoa(<f64>-value)).toBe("-" + expected);
  }
  expect(dtoa(99999)).toBe("99999");
  expect(dtoa(1234567)).toBe("1234567");
  expect(dtoa(16777216)).toBe("16777216");
  expect(dtoa(123456789)).toBe("123456789");
  expect(dtoa(999999999)).toBe("999999999");
  expect(dtoa(1000000000)).toBe("1000000000");
  expect(dtoa(1234.5)).toBe("1234.5");
});
