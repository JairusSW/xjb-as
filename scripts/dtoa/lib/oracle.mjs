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

// Exact decimal of an f32: returns { neg, P (BigInt of significant integer),
// F (so value = P * 10^F) }. Every f32 is an exact finite decimal.
function exactF32(v) {
  f32buf.setFloat32(0, v);
  const bits = f32buf.getUint32(0) >>> 0;
  const neg = (bits >>> 31) !== 0;
  const eRaw = (bits >>> 23) & 0xff;
  const mant = bits & 0x7fffff;
  let sig, exp;
  if (eRaw === 0) { sig = BigInt(mant); exp = -149; }
  else { sig = BigInt(mant | 0x800000); exp = eRaw - 150; }
  let P, F;
  if (exp >= 0) { P = sig << BigInt(exp); F = 0; }
  else { P = sig * 5n ** BigInt(-exp); F = exp; }
  return { neg, P, F };
}

// Reference ECMAScript string for an f32 value (v is its exact f64 value).
// Correct shortest-round-trip: for each length k, test BOTH the floor and ceil
// k-significant-digit decimals of the exact value; among those that fround back
// to the f32, pick the one closest to the exact value (ties -> even).
export function refFloat(v) {
  if (Object.is(v, 0)) return "0";
  if (Object.is(v, -0)) return "0";
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  const { neg, P, F } = exactF32(v);
  const mag = Math.abs(v);
  const dstr = P.toString();
  const L = dstr.length;
  const rt = (head, shift) => Math.fround(parseFloat(head + "e" + shift)) === mag;

  for (let k = 1; k <= L; k++) {
    const shift = L - k + F;
    const floorHead = dstr.slice(0, k);            // truncate to k digits
    const ceilHead = (BigInt(floorHead) + 1n).toString();
    const pow = 10n ** BigInt(L - k);
    const r = P % pow;                              // exact - floor (in 10^F units)
    const twoR = 2n * r;

    const floorOk = rt(floorHead, shift);
    const ceilOk = rt(ceilHead, shift);
    if (!floorOk && !ceilOk) continue;

    let head;
    if (floorOk && ceilOk) {
      if (twoR < pow) head = floorHead;
      else if (twoR > pow) head = ceilHead;
      else head = ((floorHead.charCodeAt(k - 1) - 48) & 1) === 0 ? floorHead : ceilHead;
    } else {
      head = floorOk ? floorHead : ceilHead;
    }
    const K = head.length;                          // k or k+1 (carry on ceil)
    let s = head.replace(/0+$/, "");
    if (s === "") s = "0";
    const n = K + shift;                            // point position
    return ecmaFormat(neg, s, n);
  }
  throw new Error("no shortest f32 found for " + v);
}
