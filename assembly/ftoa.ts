// ECMAScript-compatible f32 formatting using the shared compact power cache.
import {
  BCD_ZEROS, MIN_FIXED_DEC_EXP, MAX_FIXED_DEC_EXP, POW10_SHARED, SCRATCH,
  gPow10Hi, gDigHi, gDigNum, gSig, gExp,
  gLastDigit, gHasLastDigit, computePow10Compact, writeUnpacked8, writeNaN,
  writeInfinity, writeExponent, scratchString, writeUInt16,
  toDigits32, integerString
} from "./xjb";

@lazy @inline const FLOAT_EXP_OFFSET = 150; // exp_bias(127) + num_sig_bits(23)
@lazy const FLOAT_SIGNIFICAND_SIZE = 23; // explicit mantissa bits
@lazy @inline const FLOAT_HIDDEN_BIT: u64 = (<u64>1) << FLOAT_SIGNIFICAND_SIZE; // implicit leading 1
@lazy const FLOAT_SIGNIFICAND_MASK: u32 = (<u32>1 << FLOAT_SIGNIFICAND_SIZE) - 1;
@lazy @inline const FLOAT_BIT = 36; // xjb's fixed-point split for the f32 core
// xjb's c1, ASCII offset stripped so the `one` digit comes out numeric.
@lazy @inline const FLOAT_ONE_BIAS: u64 = ((<u64>1) << (FLOAT_BIT - 2)) - 7;

export const FLOAT_MAX_DIGITS10 = 9;
// Fixed-notation tail: 8-digit significand block (gDigHi) plus an optional 9th
// ("extra") digit.
// @ts-ignore: decorator
@inline function writeFixedFloat(
  buf: usize,
  start: usize,
  decExp: i32,
  hasLastDigit: bool,
  hasExtraDigit: bool,
): usize {
  if (decExp < 0) writeUnpacked8(start, BCD_ZEROS);
  let lastDigitChar = <u64>(0x30 + (hasLastDigit ? gLastDigit : 0));
  let numDigits = hasLastDigit ? 8 : gDigNum - i32(hasExtraDigit);

  // !hasExtraDigit: gSig has a leading '0'; shift it out and fold the last digit
  // into the freed low slot, so the block is exactly 8 chars (no memmove).
  let dHi = gDigHi;
  if (!hasExtraDigit) {
    dHi = (dHi >> 8) | (lastDigitChar << 56);
  }

  // decExp >= 8: integer rendered as significant digits then trailing zeros.
  if (decExp >= 8) {
    writeUnpacked8(buf, dHi);
    if (hasExtraDigit) store<u16>(buf + 16, <u32>lastDigitChar);
    let sig = 8 + i32(hasExtraDigit);
    let endByte = buf + ((decExp + 1) << 1);
    for (let z = buf + (sig << 1); z < endByte; z += 16) {
      writeUnpacked8(z, BCD_ZEROS);
    }
    return endByte;
  }

  let n = numDigits + i32(hasExtraDigit);
  let endPos = n;
  if (decExp >= 0) {
    endPos = n > decExp + 1 ? n + 1 : decExp + 1;
  }

  // Branchless `decExp < 0 ? 1 - decExp : 0` (decExp >> 31 is all-ones if < 0).
  let startPos = (1 - decExp) & (decExp >> 31);

  buf += startPos << 1;
  writeUnpacked8(buf, dHi);
  if (hasExtraDigit) store<u16>(buf + 16, <u32>lastDigitChar);

  if (decExp >= 0) {
    // Place '.' after k integer digits with no memmove: re-store the digits
    // shifted right by k chars (fractional part at [k+1,...]), then drop '.' at k.
    let k = decExp + 1;
    let d16: u64 = hasExtraDigit ? lastDigitChar : 0;
    let s = k << 3;
    let fHi = s < 64 ? (dHi >> s) | (d16 << (64 - s)) : d16;
    writeUnpacked8(buf + ((k + 1) << 1), fHi);
    store<u16>(buf + (k << 1), 0x2e);
  } else {
    store<u16>(start, 0x2e, 2); // "0." prefix
  }

  let end = buf + (endPos << 1);
  if (decExp >= 0 && endPos == decExp + 1) return end;
  while (end > start + 2 && load<u16>(end - 2) == 0x30) {
    end -= 2;
  }
  if (load<u16>(end - 2) == 0x2e) {
    end -= 2;
  }
  return end;
}

// Exponential-notation tail. Lays the mantissa "d.ddd" (single leading digit)
// then the "e +/- d" exponent.
// @ts-ignore: decorator
@inline function writeExpNotationFloat(
  buf: usize,
  start: usize,
  decExp: i32,
  hasLastDigit: bool,
  hasExtraDigit: bool,
): usize {
  buf += usize(hasExtraDigit) << 1;
  writeUnpacked8(buf, gDigHi);
  store<u16>(buf + 16, <u32>(0x30 + gLastDigit));
  buf += (hasLastDigit ? 9 : gDigNum + i32(!hasExtraDigit)) << 1;
  while (buf > start + 4 && load<u16>(buf - 2) == 0x30) {
    buf -= 2;
  }
  // Move the lead digit to pos 0, drop '.' at pos 1.
  let lead: u32 = <u32>load<u16>(start, 2);
  store<u16>(start, lead);
  store<u16>(start, 0x2e, 2);
  buf -= usize(buf - 2 == start + 2) << 1; // drop a trailing point
  return writeExponent(buf, decExp);
}

// xjb's single-multiply f32 shortest-decimal core. One hi-only pow10 multiply
// covers both regular and irregular cases, taken as a narrow 64x24 product (two
// 32-bit partial products + a shift) since the significand is < 2**24. Sets
// gSig (integral), gExp (= k), gLastDigit (the "one" digit), gHasLastDigit.
// @ts-ignore: decorator
@inline export function toDecimalFloat(binSig: u64, rawExp: i32, regular: bool): void {
  let expBin = rawExp - FLOAT_EXP_OFFSET;

  let k: i32, h: i32;
  if (regular) {
    k = (expBin * 1233) >> 12;
    h = 37 + expBin + (((-k - 1) * 1701) >> 9);
  } else {
    k = (expBin * 1233 - 512) >> 12;
    h = 37 + expBin + ((k * -1701 + (-1701)) >> 9);
  }
  let pow10Hi: u64;
  if (k >= -28 && k <= 16) {
    pow10Hi = load<u64>(POW10_SHARED + (<usize>(28 + k) << 3));
  } else {
    let lo = computePow10Compact(292 - k);
    pow10Hi = gPow10Hi + u64(lo != 0);
  }

  // hi64 = (binSig * pow10Hi) >> (64 - h), split as >> 24 (folded into the
  // partial-product combine; exact since 64 - h >= 24) then >> (40 - h).
  let t0 = (pow10Hi & 0xffffffff) * binSig;
  let t1 = (pow10Hi >> 32) * binSig + (t0 >> 32);
  let mid = (t1 << 8) | ((t0 & 0xffffffff) >> 24);
  let hi64 = mid >> (40 - h);

  let halfUlp = (pow10Hi >> (65 - h)) + (1 - (binSig & 1));
  let dotOne = hi64 & (((<u64>1) << FLOAT_BIT) - 1);
  let mUp = (hi64 + halfUlp) >> FLOAT_BIT;
  let one = <i32>((dotOne * 5 + FLOAT_ONE_BIAS + (dotOne >> 32)) >> (FLOAT_BIT - 1));

  let upDown: bool;
  if (regular) {
    upDown = mUp > ((hi64 - halfUlp) >> FLOAT_BIT);
  } else {
    // Three exact-boundary exponents need a +1 nudge to the last digit.
    if (expBin == -119 || expBin == 64 || expBin == 67) ++one;
    upDown = mUp > ((hi64 - (halfUlp >> 1)) >> FLOAT_BIT);
  }

  gSig = <i64>mUp;
  gExp = k;
  gLastDigit = one;
  gHasLastDigit = !upDown;
}

// @ts-ignore: decorator
@inline function formatDecodedFloat(buf: usize, bits: u32, binExp: i32, binSig: u64): usize {
  let neg = bits >> 31 != 0;
  const THRESHOLD: u64 = 10000000;

  let isNormal = <u32>(binExp - 1) < <u32>254;
  if (!isNormal) {
    if (binExp != 0) {
      if (binSig != 0) return writeNaN(buf);
      return writeInfinity(buf, neg);
    }
    if (binSig == 0) {
      store<u16>(buf, 0x30);
      return buf + 2;
    }
    if (neg) {
      store<u16>(buf, 0x2d);
      buf += 2;
    }
    toDecimalFloat(binSig, 1, true);
    let decSig = gSig * 10 + (gHasLastDigit ? gLastDigit : 0);
    let decExp = gExp;
    // At most seven powers of ten are needed; apply them in 4, 2, 1 steps.
    if (<u64>decSig < 10000) {
      decSig *= 10000;
      decExp -= 4;
    }
    if (<u64>decSig < 1000000) {
      decSig *= 100;
      decExp -= 2;
    }
    if (<u64>decSig < THRESHOLD) {
      decSig *= 10;
      --decExp;
    }
    let q = <i64>(<u64>decSig / 10);
    let last = <i32>(decSig - q * 10);
    gSig = q;
    gExp = decExp;
    gLastDigit = last;
    gHasLastDigit = last != 0;
  } else {
    if (neg) {
      store<u16>(buf, 0x2d);
      buf += 2;
    }
    let q = binExp - FLOAT_EXP_OFFSET;
    if (q >= -FLOAT_SIGNIFICAND_SIZE && q < 24) {
      let c = binSig | FLOAT_HIDDEN_BIT;
      let intValue: u64 = 0;
      if (q < 0) {
        let shift = -q;
        let mask = ((<u64>1) << shift) - 1;
        if ((c & mask) == 0) intValue = c >> shift;
      } else {
        intValue = c << q;
        if (intValue > 16777216) intValue = 0;
      }
      if (intValue != 0) return writeUInt16(buf, intValue);
    }
    toDecimalFloat(binSig | FLOAT_HIDDEN_BIT, binExp, binSig != 0);
  }

  let hasLastDigit = gHasLastDigit;
  let hasExtraDigit = <u64>gSig >= THRESHOLD;
  let decExp = gExp + FLOAT_MAX_DIGITS10 - 2 + i32(hasExtraDigit);

  if (<u64>gSig < 1000000) {
    gSig = 10 * gSig + (hasLastDigit ? gLastDigit : 0);
    hasLastDigit = false;
    --decExp;
  }

  let start = buf;
  toDigits32(<u64>gSig);

  if (decExp >= MIN_FIXED_DEC_EXP && decExp <= MAX_FIXED_DEC_EXP)
    return writeFixedFloat(buf, start, decExp, hasLastDigit, hasExtraDigit);
  return writeExpNotationFloat(buf, start, decExp, hasLastDigit, hasExtraDigit);
}

export function ftoa(value: f32): string {
  if (value == 0) return "0";
  if (!isFinite(value)) {
    if (isNaN(value)) return "NaN";
    return select<string>("-Infinity", "Infinity", value < 0);
  }

  let magnitude = reinterpret<u32>(value) & 0x7fffffff;
  if (magnitude >= 0x3f800000 && magnitude <= 0x4b800000) {
    let integer = <i32>value;
    if (value == <f32>integer) return integerString(integer);
  }

  return scratchString(<usize>ftoa_buffered(SCRATCH, value) << 1);
}

export function ftoa_buffered(buffer: usize, value: f32): u32 {
  let bits = reinterpret<u32>(value);
  let binExp = <i32>((bits << 1) >> 24);
  let binSig = <u64>(bits & FLOAT_SIGNIFICAND_MASK);
  return <u32>((formatDecodedFloat(buffer, bits, binExp, binSig) - buffer) >> 1);
}

// Internal stage-benchmark hooks share the engine result slots.
export { toDigits32, gSig, gExp, gLastDigit, gHasLastDigit, gDigHi, gDigNum } from "./xjb";
