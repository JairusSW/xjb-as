// ECMAScript-compatible f64 formatting. Shared machinery lives in xjb.ts.
import {
  POW10_SMALL, LOG10_2_SIGNIFICAND, LOG10_2_EXP, LOG2_POW10_SIGNIFICAND, LOG2_POW10_EXP,
  DOUBLE_EXP_OFFSET, DOUBLE_HIDDEN_BIT, DOUBLE_SIGNIFICAND_MASK, EXTRA_SHIFT, BIASED_HALF,
  MIN_FIXED_DEC_EXP, MAX_FIXED_DEC_EXP, SCRATCH, gPow10Hi, gSig,
  gExp, gLastDigit, gHasLastDigit, umul64hi, umul64hiCarry,
  toDecExponent, exponentShift, computePow10, toDigits64Fixed16, writeNaN,
  writeInfinity, writeFixed, writeExpNotation, scratchString,
  decimalLen15, writeUInt16, integerString
} from "./xjb";

// @ts-ignore: decorator
@inline function setDecimalResult(integral: u64, one: u64, decExp: i32): void {
	if (one == 10) {
		// @ts-expect-error: valid
    gSig = <i64>(integral + 1);
    // @ts-expect-error: valid
    gLastDigit = 0;
    // @ts-expect-error: valid
    gHasLastDigit = false;
  } else if (one == 0) {
  // @ts-expect-error: valid
    gSig = <i64>integral;
    // @ts-expect-error: valid
    gLastDigit = 0;
    // @ts-expect-error: valid
    gHasLastDigit = false;
  } else {
  // @ts-expect-error: valid
    gSig = <i64>integral;
    // @ts-expect-error: valid
    gLastDigit = <i32>one;
    // @ts-expect-error: valid
    gHasLastDigit = true;
  }
  // @ts-expect-error: valid
  gExp = decExp;
}

// Normal f64 -> shortest decimal.
// @ts-ignore: decorator
@inline function toDecimalDoubleNormal(binSig: u64, rawExp: i32, regular: bool): void {
  let c = binSig | DOUBLE_HIDDEN_BIT;
  let q = rawExp - DOUBLE_EXP_OFFSET;

  if (!regular) {
    let decExp = (q * LOG10_2_SIGNIFICAND - 131072) >> LOG10_2_EXP; // 131072 = 2**17 rounding bias
    let powExp = -decExp - 1;
    let h = q + ((powExp * LOG2_POW10_SIGNIFICAND) >> LOG2_POW10_EXP);

    computePow10(powExp + 293);
    let pow10Hi = gPow10Hi;

    let integral = pow10Hi >> (11 - h);
    let halfUlp = pow10Hi >> (-h);
    let dotOne = pow10Hi << (53 + h);

    let one = ((((dotOne >> (53 + h)) * 5) + (((<u64>1) << (9 - h)))) >> (10 - h));
    one = ((((dotOne >> 54) * 5) & 0x1ff) > ((halfUlp >> 55) * 5))
      ? ((((dotOne >> 54) * 5) >> 9) + 1)
      : one;
    one = dotOne == ((<u64>1) << 62) ? 2 : one;
    one = (halfUlp >> 1) > dotOne ? 0 : one;
    one = halfUlp > u64.MAX_VALUE - dotOne ? 10 : one;

    setDecimalResult(integral, one, decExp);
    return;
  }

  let decExp = ((rawExp - DOUBLE_EXP_OFFSET) * 78913) >> 18; // 78913/2**18 ~= log10(2) (Q18)
  let powExp = -decExp - 1;
  let h = q + ((powExp * LOG2_POW10_SIGNIFICAND) >> LOG2_POW10_EXP);
  let shift = h + 1 + EXTRA_SHIFT;

  // xjb64 rounds up the negative-power low limb by one.
  let pLo = computePow10(powExp + 293) + u64(powExp < 0);
  let pHi = gPow10Hi;
  let y = c << shift;

  let a = umul64hi(pHi, y);
  let pLo64 = pHi * y;
  let lo = pLo64 + umul64hi(pLo, y);
  let pHi64 = a + u64(lo < pLo64);

  let integral = pHi64 >> EXTRA_SHIFT;
  let dotOne = (pHi64 << (64 - EXTRA_SHIFT)) | (lo >> EXTRA_SHIFT);
  let halfUlp = (pHi >> (-h)) + <u64>(1 - (c & 1));

  let one = umul64hiCarry(dotOne, 10, dotOne == ((<u64>1) << 62) ? 0 : BIASED_HALF);
  one = dotOne < halfUlp ? 0 : one;
  one = u64.MAX_VALUE - dotOne < halfUlp ? 10 : one;

  setDecimalResult(integral, one, decExp);
}

// bin_sig * 2**(raw_exp - exp_offset) -> shortest decimal.
// @ts-ignore: decorator
@inline export function toDecimalDouble(binSig: u64, rawExp: i32, regular: bool): void {
  if (rawExp != 0) return toDecimalDoubleNormal(binSig, rawExp, regular);

  let decExp = toDecExponent(-1074);
  let shift = exponentShift(-1074, decExp + 1) + EXTRA_SHIFT;

  let powExp = -decExp - 1;
  let pLo = computePow10(powExp + 293) + u64(powExp < 0);
  let pHi = gPow10Hi;
  let y = binSig << shift;

  let a = umul64hi(pHi, y);
  let pLo64 = pHi * y;
  let lo = pLo64 + umul64hi(pLo, y);
  let pHi64 = a + u64(lo < pLo64);

  let integral = pHi64 >> EXTRA_SHIFT;
  let dotOne = (pHi64 << (64 - EXTRA_SHIFT)) | (lo >> EXTRA_SHIFT);
  let halfUlp = (pHi >> (EXTRA_SHIFT + 1 - shift)) + <u64>(1 - (binSig & 1));

  let one = umul64hiCarry(dotOne, 10, BIASED_HALF);
  one = dotOne < halfUlp ? 0 : one;
  one = u64.MAX_VALUE - dotOne < halfUlp ? 10 : one;

  setDecimalResult(integral, one, decExp);
}

// @ts-ignore: decorator
@inline export function normalizeDoubleShortest(): void {
  let full = <u64>gSig * 10 + <u64>(gHasLastDigit ? gLastDigit : 0);
  if (full >= 1000000000000000) {
  	// @ts-expect-error: valid
    gSig = <i64>full;
    // @ts-expect-error: valid
    --gExp;
    // @ts-expect-error: valid
    gLastDigit = 0;
    // @ts-expect-error: valid
    gHasLastDigit = false;
    return;
  }
  let scale = 16 - decimalLen15(full);
	let mul = load<u64>(POW10_SMALL + (<usize>scale << 3));
	// @ts-expect-error: valid
  gSig = <i64>(full * mul);
  // @ts-expect-error: valid
  gExp -= scale + 1;
  // @ts-expect-error: valid
  gLastDigit = 0;
  // @ts-expect-error: valid
  gHasLastDigit = false;
}

// @ts-ignore: decorator
@inline function formatDecodedDouble(buf: usize, bits: u64, binExp: i32, binSig: u64): usize {
  let neg = bits >> 63 != 0;
  let threshold: u64 = 1000000000000000;

  // is_normal: 1 <= bin_exp <= 2046
  let isNormal = <u32>(binExp - 1) < <u32>2046;
  if (!isNormal) {
    if (binExp != 0) {
      if (binSig != 0) return writeNaN(buf);
      return writeInfinity(buf, neg);
    }
    // +/-0 -> "0"
    if (binSig == 0) {
      store<u16>(buf, 0x30);
      return buf + 2;
    }
  }

  if (neg) {
    store<u16>(buf, 0x2d);
    buf += 2;
  }
  if (isNormal) {
    let q = binExp - DOUBLE_EXP_OFFSET;
    let c = binSig | DOUBLE_HIDDEN_BIT;
    let intValue: u64 = 0;
    if (q < 0) {
      let shift = -q;
      if (shift <= 52) {
        let mask = ((<u64>1) << shift) - 1;
        if ((c & mask) == 0) intValue = c >> shift;
      }
    } else if (q < 11) {
      intValue = c << q;
      if (intValue >= 10000000000000000) intValue = 0;
    }
    if (intValue != 0) return writeUInt16(buf, intValue);
  }

  if (isNormal) {
    toDecimalDoubleNormal(binSig, binExp, binSig != 0);
  } else {
    toDecimalDouble(binSig, 0, true);
  }
  if (<u64>gSig < threshold) normalizeDoubleShortest();

  let hasLastDigit = gHasLastDigit;
  let decExp = gExp + 16;
  let start = buf;
  toDigits64Fixed16(<u64>gSig);
  if (decExp >= MIN_FIXED_DEC_EXP && decExp <= MAX_FIXED_DEC_EXP)
    return writeFixed(buf, start, decExp, hasLastDigit);
  return writeExpNotation(buf, start, decExp, hasLastDigit, true, 16);
}

// @ts-ignore: decorator
@inline function formatDouble(buf: usize, value: f64): usize {
  let bits = reinterpret<u64>(value);
  let binExp = <i32>((bits << 1) >> 53);
  let binSig = bits & DOUBLE_SIGNIFICAND_MASK;
  return formatDecodedDouble(buf, bits, binExp, binSig);
}

export function dtoa(value: f64): string {
  if (value == 0) return "0";
  if (!isFinite(value)) {
    if (isNaN(value)) return "NaN";
    return select<string>("-Infinity", "Infinity", value < 0);
  }

  let magnitude = reinterpret<u64>(value) & 0x7fffffffffffffff;
  if (magnitude >= 0x3ff0000000000000 && magnitude <= 0x41cdcd6500000000) {
    let integer = <i32>value;
    if (value == <f64>integer) return integerString(integer);
  }

  return scratchString(<usize>dtoa_buffered(SCRATCH, value) << 1);
}

export function dtoa_buffered(buffer: usize, value: f64): u32 {
  return <u32>((formatDouble(buffer, value) - buffer) >> 1);
}
