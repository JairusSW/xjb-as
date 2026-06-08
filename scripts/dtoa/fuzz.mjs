// Differential fuzzer for assembly/dtoa.ts (dtoa/ftoa) against V8's
// Number::toString. Drives the wasm `dtoa_buffered` / `ftoa_buffered` exports
// over randomly generated IEEE-754 bit patterns and compares each result to the
// shared V8 oracle (scripts/dtoa/lib/oracle.mjs):
//
//   f64 -> v.toString()                              (V8 is the exact oracle)
//   f32 -> exact shortest round-trip, ECMA-262 form  (BigInt oracle)
//
// `ast fuzz` can't host a JS oracle (its harness instantiates fuzz targets with
// no custom imports), so the fuzzer runs here in Node - same pattern as
// verify.mjs, but seedable, mix-weighted toward rounding-boundary inputs, and
// repro-friendly. verify.mjs stays the fixed exhaustive gate; this is the
// open-ended, re-seedable hunt.
//
// Usage:
//   node scripts/dtoa/fuzz.mjs [--runs N] [--time SECONDS] [--seed N]
//                              [--f64-only] [--f32-only] [--max-report N]
//   (npm run fuzz builds build/dtoa.wasm first, then runs this with defaults.)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
    refDouble,
    refFloat,
    f64bits,
    f32bits,
    f64from,
    f32from,
} from "./lib/oracle.mjs";

// ---- args -----------------------------------------------------------------
function argVal(name, def) {
    const i = process.argv.indexOf(name);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const hasFlag = (name) => process.argv.includes(name);

const seed =
    argVal("--seed", null) != null
        ? Number(argVal("--seed")) >>> 0
        : (Date.now() ^ (process.pid * 2654435761)) >>> 0 || 1;
const runs = Number(argVal("--runs", "5000000"));
const timeLimitMs =
    argVal("--time", null) != null ? Number(argVal("--time")) * 1000 : Infinity;
const maxReport = Number(argVal("--max-report", "20"));
const doF64 = !hasFlag("--f32-only");
const doF32 = !hasFlag("--f64-only");
const crashDir = new URL("../../.as-test/crashes/", import.meta.url);

// ---- wasm -----------------------------------------------------------------
const wasmPath = new URL("../../build/dtoa.wasm", import.meta.url);
let bytes;
try {
    bytes = readFileSync(wasmPath);
} catch {
    console.error(
        "missing build/dtoa.wasm - run `npm run verify:build` first (npm run fuzz does this).",
    );
    process.exit(2);
}
const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
        abort() {
            throw new Error("wasm abort");
        },
    },
});
const { memory, dtoa_buffered, ftoa_buffered } = instance.exports;
const DST = memory.buffer.byteLength - 256;
function readUtf16(len) {
    const view = new Uint16Array(memory.buffer, DST, len);
    let s = "";
    for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
    return s;
}
const asDtoa = (v) => readUtf16(dtoa_buffered(DST, v));
const asFtoa = (v) => readUtf16(ftoa_buffered(DST, v));

// ---- seeded RNG (xorshift32) ----------------------------------------------
let rng = seed >>> 0;
function r32() {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    return rng >>> 0;
}
function r64() {
    return (BigInt(r32()) << 32n) | BigInt(r32());
}
const POW10 = [];
for (let p = -323; p <= 308; p++) POW10.push(Number(`1e${p}`));
const POW10F = [];
for (let p = -45; p <= 38; p++) POW10F.push(Math.fround(Number(`1e${p}`)));

// ---- input generators (weighted mix) --------------------------------------
// Uniform full-domain bits dominate; the rest pile density onto the decimal
// rounding boundaries (powers of ten, near-integers, subnormals, tiny
// mantissas) where shortest-digit selection is most fragile.
function genF64() {
    switch (r32() % 8) {
        case 0:
        case 1:
        case 2:
        case 3: // uniform full domain
            return f64from(r64());
        case 4: {
            // power of ten ± a few ulps
            const base = POW10[r32() % POW10.length];
            return f64from(
                (f64bitsBig(base) + BigInt((r32() % 9) - 4)) &
                    0xffffffffffffffffn,
            );
        }
        case 5: // near-integer / small magnitude
            return (
                (r32() % 2 ? -1 : 1) *
                (r32() % 2
                    ? r32() >>> (r32() % 30)
                    : r32() / (1 + (r32() % 1000)))
            );
        case 6: // subnormal
            return f64from(
                (r64() & 0x000fffffffffffffn) |
                    (r32() % 2 ? 0x8000000000000000n : 0n),
            );
        default: // random exponent, tiny mantissa
            return f64from(
                (BigInt(r32() % 2047) << 52n) |
                    BigInt(r32() % 16) |
                    (r32() % 2 ? 0x8000000000000000n : 0n),
            );
    }
}
function genF32() {
    switch (r32() % 8) {
        case 0:
        case 1:
        case 2:
        case 3:
            return f32from(r32());
        case 4: {
            const base = POW10F[r32() % POW10F.length];
            return f32from((f32bitsU32(base) + ((r32() % 9) - 4)) >>> 0);
        }
        case 5:
            return Math.fround(
                (r32() % 2 ? -1 : 1) *
                    (r32() % 2
                        ? r32() >>> (r32() % 16)
                        : r32() / (1 + (r32() % 1000))),
            );
        case 6:
            return f32from(
                (r32() & 0x007fffff) | ((r32() % 2 ? 0x80000000 : 0) >>> 0),
            );
        default:
            return f32from(
                (((r32() % 255) << 23) |
                    (r32() % 16) |
                    (r32() % 2 ? 0x80000000 : 0)) >>>
                    0,
            );
    }
}
const f64View = new DataView(new ArrayBuffer(8));
function f64bitsBig(v) {
    f64View.setFloat64(0, v);
    return f64View.getBigUint64(0);
}
function f32bitsU32(v) {
    f64View.setFloat32(0, v);
    return f64View.getUint32(0) >>> 0;
}

// ---- run ------------------------------------------------------------------
const crashes = [];
function record(kind, bitsHex, v, got, want) {
    if (crashes.length < maxReport) {
        console.error(
            `${kind} MISMATCH bits=0x${bitsHex} v=${v}\n  got =${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`,
        );
    }
    crashes.push({ kind, bits: "0x" + bitsHex, value: String(v), got, want });
}

console.log(
    `fuzz: seed=${seed} runs=${Number.isFinite(runs) ? runs : "∞"}${Number.isFinite(timeLimitMs) ? ` time=${timeLimitMs / 1000}s` : ""} f64=${doF64} f32=${doF32}`,
);
const start = Date.now();
let nF64 = 0,
    nF32 = 0;
for (let i = 0; i < runs; i++) {
    if (doF64) {
        const v = genF64();
        nF64++;
        const got = asDtoa(v),
            want = refDouble(v);
        if (got !== want) record("f64", f64bits(v), v, got, want);
    }
    if (doF32) {
        const v = genF32();
        nF32++;
        const got = asFtoa(v),
            want = refFloat(v);
        if (got !== want) record("f32", f32bits(v), v, got, want);
    }
    if ((i & 0x3ffff) === 0) {
        if (Date.now() - start > timeLimitMs) break;
        if (i > 0)
            process.stdout.write(
                `\r  ${nF64 + nF32} checked, ${crashes.length} fails…`,
            );
    }
    if (crashes.length >= 500) {
        console.error("\n…stopping early (500+ fails)");
        break;
    }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
process.stdout.write("\r");
console.log(
    `fuzz: f64=${nF64} f32=${nF32} checked in ${elapsed}s, ${crashes.length} mismatch(es)`,
);

if (crashes.length) {
    mkdirSync(crashDir, { recursive: true });
    const out = new URL(`fuzz-${seed}.json`, crashDir);
    writeFileSync(out, JSON.stringify({ seed, runs, crashes }, null, 2));
    console.error(`repro: node scripts/dtoa/fuzz.mjs --seed ${seed}`);
    console.error(`saved: ${out.pathname}`);
    process.exit(1);
}
process.exit(0);
