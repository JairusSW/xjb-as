// Generates assembly/__tests__/{dtoa,ftoa}.spec.ts: as-test suites whose
// expected strings are produced by the V8 oracle (f64: Number.toString; f32:
// exact shortest-round-trip + ECMA-262 formatter), so they assert the AS
// dtoa/ftoa output matches ECMAScript Number::toString exactly.
//
// Usage: node scripts/dtoa/gen-spec.mjs [N]
//   N = number of random values to generate for EACH of dtoa and ftoa
//       (default 4000). Edge cases and powers of ten are always included.
import { writeFileSync } from "node:fs";

const N = (() => {
    const arg = process.argv[2];
    if (arg === undefined) return 4000;
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 0) {
        console.error(`invalid count ${JSON.stringify(arg)}: expected a non-negative integer`);
        process.exit(1);
    }
    return n;
})();

const f64buf = new DataView(new ArrayBuffer(8));
const f32buf = new DataView(new ArrayBuffer(4));
const f64from = (b) => (f64buf.setBigUint64(0, b), f64buf.getFloat64(0));
const f32from = (b) => (f32buf.setUint32(0, b >>> 0), f32buf.getFloat32(0));
const f64bits = (v) => (f64buf.setFloat64(0, v), f64buf.getBigUint64(0));
const f32bits = (v) => (f32buf.setFloat32(0, v), f32buf.getUint32(0) >>> 0);

function ecmaFormat(neg, s, n) {
    const k = s.length;
    let out;
    if (k <= n && n <= 21) out = s + "0".repeat(n - k);
    else if (0 < n && n <= 21) out = s.slice(0, n) + "." + s.slice(n);
    else if (-6 < n && n <= 0) out = "0." + "0".repeat(-n) + s;
    else {
        const e = n - 1;
        out =
            (k === 1 ? s : s[0] + "." + s.slice(1)) +
            "e" +
            (e >= 0 ? "+" : "-") +
            Math.abs(e);
    }
    return (neg ? "-" : "") + out;
}
function refDouble(v) {
    if (Number.isNaN(v)) return "NaN";
    if (v === Infinity) return "Infinity";
    if (v === -Infinity) return "-Infinity";
    return v.toString(); // V8 == Number::toString
}
function exactF32(v) {
    const bits = f32bits(v);
    const neg = bits >>> 31 !== 0;
    const eRaw = (bits >>> 23) & 0xff;
    const mant = bits & 0x7fffff;
    let sig, exp;
    if (eRaw === 0) {
        sig = BigInt(mant);
        exp = -149;
    } else {
        sig = BigInt(mant | 0x800000);
        exp = eRaw - 150;
    }
    return exp >= 0
        ? { neg, P: sig << BigInt(exp), F: 0 }
        : { neg, P: sig * 5n ** BigInt(-exp), F: exp };
}
function refFloat(v) {
    if (Number.isNaN(v)) return "NaN";
    if (v === Infinity) return "Infinity";
    if (v === -Infinity) return "-Infinity";
    v = Math.fround(v); // operate on the exact f32 value
    if (Object.is(v, 0) || Object.is(v, -0)) return "0";
    const { neg, P, F } = exactF32(v);
    const mag = Math.abs(v);
    const dstr = P.toString();
    const L = dstr.length;
    const rt = (head, shift) =>
        Math.fround(parseFloat(head + "e" + shift)) === mag;
    for (let k = 1; k <= L; k++) {
        const shift = L - k + F;
        const floorHead = dstr.slice(0, k);
        const ceilHead = (BigInt(floorHead) + 1n).toString();
        const pow = 10n ** BigInt(L - k);
        const r = P % pow,
            twoR = 2n * r;
        const fo = rt(floorHead, shift),
            co = rt(ceilHead, shift);
        if (!fo && !co) continue;
        let head;
        if (fo && co)
            head =
                twoR < pow
                    ? floorHead
                    : twoR > pow
                      ? ceilHead
                      : ((floorHead.charCodeAt(k - 1) - 48) & 1) === 0
                        ? floorHead
                        : ceilHead;
        else head = fo ? floorHead : ceilHead;
        let s = head.replace(/0+$/, "");
        if (s === "") s = "0";
        return ecmaFormat(neg, s, head.length + shift);
    }
    throw new Error("no shortest f32 for " + v);
}

let rng = 0xc0ffee >>> 0;
const r32 = () => (
    (rng ^= rng << 13),
    (rng ^= rng >>> 17),
    (rng ^= rng << 5),
    rng >>> 0
);

// f64 literal that AS parses back to the exact same bits.
const litD = (v) =>
    Number.isFinite(v)
        ? `reinterpret<f64>(<u64>0x${f64bits(v).toString(16)})`
        : Number.isNaN(v)
          ? "NaN"
          : v < 0
            ? "-Infinity"
            : "Infinity";
const litF = (v) =>
    Number.isFinite(v)
        ? `reinterpret<f32>(<u32>0x${f32bits(v).toString(16)})`
        : Number.isNaN(v)
          ? "<f32>NaN"
          : v < 0
            ? "<f32>-Infinity"
            : "<f32>Infinity";
const esc = (s) => JSON.stringify(s);

const edgeD = [
    0,
    -0,
    1,
    -1,
    0.5,
    -0.5,
    0.1,
    0.2,
    0.3,
    100,
    1000,
    1e21,
    1e-7,
    1e-6,
    1e-5,
    1e20,
    1e22,
    9e20,
    1.5e21,
    123456.789,
    -5942736479622170.0,
    5e-324,
    2.2250738585072014e-308,
    1.7976931348623157e308,
    9007199254740992,
    4503599627370497,
    0.0001,
    0.00001,
    Infinity,
    -Infinity,
    NaN,
    1e-323,
    3.141592653589793,
    100000000000000000000,
    1000000000000000000000,
    0.30000000000000004,
    6.62607015e-34,
    5.444310685350916e14,
    2.9802322387695312e-8,
    -1.2345678901234567e123,
    43210.1,
    9.03725590277404e159,
];
const edgeF = [
    0,
    -0,
    1,
    -1,
    0.5,
    0.1,
    100,
    1e20,
    1e-7,
    3.4028235e38,
    1.1754944e-38,
    1.4e-45,
    1e-45,
    16777216,
    8388608,
    1.342178e8,
    9.999999e9,
    Infinity,
    NaN,
    6.62607e-34,
    43210.1,
];

function header(fn) {
    return [
        `// AUTO-GENERATED by scripts/dtoa/gen-spec.mjs - do not edit by hand.`,
        `// Expected strings come from V8 (f64: Number.toString; f32: exact shortest`,
        `// round-trip + ECMA-262 formatting), so this asserts ${fn} == Number::toString.`,
        `import { describe, expect } from "as-test";`,
        `import { ${fn} } from "../dtoa";`,
        "",
    ];
}

const dLines = header("dtoa");
const fLines = header("ftoa");

function emit(lines, fn, lit, ref, title, vals) {
    lines.push(`describe(${esc(title)}, () => {`);
    for (const v of vals)
        lines.push(`  expect(${fn}(${lit(v)})).toBe(${esc(ref(v))});`);
    lines.push(`});`);
    lines.push("");
}
const emitD = (title, vals) =>
    emit(dLines, "dtoa", litD, refDouble, title, vals);
const emitF = (title, vals) =>
    emit(fLines, "ftoa", litF, refFloat, title, vals);

emitD("dtoa: f64 edge cases", edgeD);
// powers of ten
emitD(
    "dtoa: powers of ten",
    Array.from({ length: 633 }, (_, i) => Number(`1e${i - 323}`)).filter(
        Number.isFinite,
    ),
);
// random f64
const randD = [];
for (let i = 0; randD.length < N; i++) {
    const v = f64from((BigInt(r32()) << 32n) | BigInt(r32()));
    if (Number.isFinite(v)) randD.push(v);
}
emitD("dtoa: random f64", randD);

emitF("ftoa: f32 edge cases", edgeF);
const randF = [];
for (let i = 0; randF.length < N; i++) {
    const v = f32from(r32());
    if (Number.isFinite(v)) randF.push(v);
}
emitF("ftoa: random f32", randF);

function write(name, lines) {
    const out = new URL(`../../assembly/__tests__/${name}`, import.meta.url);
    writeFileSync(out, lines.join("\n"));
    const n = lines.filter((l) => l.includes("expect(")).length;
    console.log(`wrote ${out.pathname} (${n} assertions)`);
}

write("dtoa.spec.ts", dLines);
write("ftoa.spec.ts", fLines);
