// V8 ground-truth oracle for dtoa/ftoa, shared by scripts/dtoa/verify.mjs and
// the fuzz bindings runner (.as-test/runners/default.bindings.js).
//
//  f64: dtoa(v) must equal v.toString() (V8 is the exact oracle).
//  f32: ftoa(v) must equal the shortest decimal that round-trips to the f32,
//       formatted per ECMA-262 Number::toString. The oracle computes the exact
//       decimal with BigInt, tests floor/ceil candidates at each length, and
//       applies closest/ties-to-even selection. The ECMA formatter (ecmaFormat)
//       is cross-validated against V8 on the f64 path, so a bug in it surfaces
//       as an f64 mismatch too.

const f64buf = new DataView(new ArrayBuffer(8));
const f32buf = new DataView(new ArrayBuffer(4));

export function f64bits(v) { f64buf.setFloat64(0, v); return f64buf.getBigUint64(0).toString(16).padStart(16, "0"); }
export function f32bits(v) { f32buf.setFloat32(0, v); return f32buf.getUint32(0).toString(16).padStart(8, "0"); }
export function f64from(b) { f64buf.setBigUint64(0, b); return f64buf.getFloat64(0); }
export function f32from(b) { f32buf.setUint32(0, b >>> 0); return f32buf.getFloat32(0); }

// ECMA-262 Number::toString formatter from significant digits `s` (k>=1 digit
// chars, no sign) and point position `n` (value = s × 10^(n-k)).
export function ecmaFormat(neg, s, n) {
  const k = s.length;
  let out;
  if (k <= n && n <= 21) out = s + "0".repeat(n - k);
  else if (0 < n && n <= 21) out = s.slice(0, n) + "." + s.slice(n);
  else if (-6 < n && n <= 0) out = "0." + "0".repeat(-n) + s;
  else {
    const e = n - 1;
    const exp = "e" + (e >= 0 ? "+" : "-") + Math.abs(e);
    out = k === 1 ? s + exp : s[0] + "." + s.slice(1) + exp;
  }
  return (neg ? "-" : "") + out;
}

// Parse a JS toExponential() string into { neg, s, n }.
function parseExp(es) {
  const neg = es[0] === "-";
  if (neg) es = es.slice(1);
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(es);
  const s = m[1] + (m[2] || "");
  const n = parseInt(m[3], 10) + 1;
  return { neg, s, n };
}

// Reference ECMAScript string for an f64 via shortest digits (cross-checks the
// JS formatter against V8's toString).
export function refDouble(v) {
  if (Object.is(v, 0)) return "0";
  if (Object.is(v, -0)) return "0";
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  const { neg, s, n } = parseExp(v.toExponential());
  return ecmaFormat(neg, s, n);
}

// Exact binary32 intervals avoid decimal -> binary64 -> binary32 double rounding.
// Represent values and midpoints as integers in units of 2^-150. Adjacent
// binary32 values are multiples of 2^-149, including the subnormal range.
function scaledFloat32(bits) {
  const exponent = (bits >>> 23) & 0xff;
  const significand = BigInt(exponent ? (bits & 0x7fffff) | 0x800000 : bits);
  return significand << BigInt(exponent || 1);
}

function roundingInterval(bits) {
  bits &= 0x7fffffff;
  const value = scaledFloat32(bits);
  // At the largest finite value, the next encoding represents the virtual
  // value 2^128 here, giving the correct overflow midpoint.
  return [
    (value + scaledFloat32(bits - 1)) / 2n,
    (value + scaledFloat32(bits + 1)) / 2n,
    (bits & 1) === 0,
  ];
}

function roundsToInterval(digits, exponent, [lower, upper, inclusive]) {
  let numerator = BigInt(digits) << 150n;
  if (exponent >= 0) {
    numerator *= 10n ** BigInt(exponent);
  } else {
    const denominator = 10n ** BigInt(-exponent);
    lower *= denominator;
    upper *= denominator;
  }
  return inclusive
    ? lower <= numerator && numerator <= upper
    : lower < numerator && numerator < upper;
}

// Candidate acceptance for finite, nonzero binary32 magnitudes. No binary64
// parsing is involved, so decimal-to-f64-to-f32 double rounding is impossible.
export function roundsToFloat32(bits, digits, exponent) {
  return roundsToInterval(digits, exponent, roundingInterval(bits));
}

export function shortestFloat32(bits) {
  const value = f32from(bits);
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (value === 0) return "0";

  const negative = (bits >>> 31) !== 0;
  const exponentBits = (bits >>> 23) & 0xff;
  const mantissa = bits & 0x7fffff;
  const significand = BigInt(exponentBits ? mantissa | 0x800000 : mantissa);
  const binaryExponent = exponentBits ? exponentBits - 150 : -149;
  const decimalInteger = binaryExponent >= 0
    ? significand << BigInt(binaryExponent)
    : significand * 5n ** BigInt(-binaryExponent);
  const decimalExponent = Math.min(binaryExponent, 0);
  const exactDigits = decimalInteger.toString();
  const interval = roundingInterval(bits);

  // At each length, test the two decimals bracketing the exact value. Choose
  // the closest one that parses back to the binary32 value; ties go to even.
  for (let count = 1; count <= exactDigits.length; ++count) {
    const shift = exactDigits.length - count + decimalExponent;
    const floor = exactDigits.slice(0, count);
    const ceil = (BigInt(floor) + 1n).toString();
    const roundTrips = digits => roundsToInterval(digits, shift, interval);
    const floorOk = roundTrips(floor);
    const ceilOk = roundTrips(ceil);
    if (!floorOk && !ceilOk) continue;

    let chosen;
    if (floorOk && ceilOk) {
      const unit = 10n ** BigInt(exactDigits.length - count);
      const distance = 2n * (decimalInteger % unit);
      chosen = distance < unit ? floor : distance > unit ? ceil
        : (Number(floor[floor.length - 1]) & 1) === 0 ? floor : ceil;
    } else {
      chosen = floorOk ? floor : ceil;
    }
    const point = chosen.length + shift;
    return ecmaFormat(negative, chosen.replace(/0+$/, ""), point);
  }
  throw new Error(`no shortest f32 decimal for 0x${bits.toString(16)}`);
}

export function refFloat(value) {
  f32buf.setFloat32(0, value);
  return shortestFloat32(f32buf.getUint32(0));
}
