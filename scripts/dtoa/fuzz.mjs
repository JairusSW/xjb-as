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
// Build targets, each its own module + memory:
//   dtoa       f64, full pow10 table       (build/dtoa.wasm)
//   dtoa-comp  f64, compressed table       (build/dtoa-comp.wasm, --shrinkLevel 1)
//   ftoa       f32, compact hi-only core   (build/ftoa.wasm)
async function loadModule(rel) {
    let bytes;
    try {
        bytes = readFileSync(new URL(`../../build/${rel}`, import.meta.url));
    } catch {
        console.error(
            `missing build/${rel} - run \`npm run verify:build\` first (npm run fuzz does this).`,
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
    const { memory } = instance.exports;
    const DST = memory.buffer.byteLength - 256;
    const read = (len) => {
        const view = new Uint16Array(memory.buffer, DST, len);
        let s = "";
        for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
        return s;
    };
    const call = (fn, v) => read(instance.exports[fn](DST, v));
    return { call };
}
const full = await loadModule("dtoa.wasm");
const comp = await loadModule("dtoa-comp.wasm");
const ftoaMod = await loadModule("ftoa.wasm");

// Every target is checked against the same oracle for each generated input.
const F64_TARGETS = [
    { name: "dtoa", run: (v) => full.call("dtoa_buffered", v) },
    { name: "dtoa-comp", run: (v) => comp.call("dtoa_buffered", v) },
];
const F32_TARGETS = [
    { name: "ftoa", run: (v) => ftoaMod.call("ftoa_buffered", v) },
];

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
const perTarget = new Map(); // name -> { checked, fails }
const tally = (name) =>
    perTarget.get(name) ?? perTarget.set(name, { checked: 0, fails: 0 }).get(name);
function record(target, bitsHex, v, got, want) {
    if (crashes.length < maxReport) {
        console.error(
            `${target} MISMATCH bits=0x${bitsHex} v=${v}\n  got =${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`,
        );
    }
    crashes.push({ target, bits: "0x" + bitsHex, value: String(v), got, want });
}

const f64Targets = doF64 ? F64_TARGETS : [];
const f32Targets = doF32 ? F32_TARGETS : [];
console.log(
    `fuzz: seed=${seed} runs=${Number.isFinite(runs) ? runs : "∞"}${Number.isFinite(timeLimitMs) ? ` time=${timeLimitMs / 1000}s` : ""}\n  targets: ${[...f64Targets, ...f32Targets].map((t) => t.name).join(", ")}`,
);
const start = Date.now();
let total = 0;
for (let i = 0; i < runs; i++) {
    if (f64Targets.length) {
        const v = genF64();
        const want = refDouble(v);
        const bits = f64bits(v);
        for (const t of f64Targets) {
            const c = tally(t.name);
            c.checked++;
            total++;
            const got = t.run(v);
            if (got !== want) {
                c.fails++;
                record(t.name, bits, v, got, want);
            }
        }
    }
    if (f32Targets.length) {
        const v = genF32();
        const want = refFloat(v);
        const bits = f32bits(v);
        for (const t of f32Targets) {
            const c = tally(t.name);
            c.checked++;
            total++;
            const got = t.run(v);
            if (got !== want) {
                c.fails++;
                record(t.name, bits, v, got, want);
            }
        }
    }
    if ((i & 0x3ffff) === 0) {
        if (Date.now() - start > timeLimitMs) break;
        if (i > 0)
            process.stdout.write(`\r  ${total} checked, ${crashes.length} fails…`);
    }
    if (crashes.length >= 500) {
        console.error("\n…stopping early (500+ fails)");
        break;
    }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
process.stdout.write("\r");
console.log(`fuzz: ${total} checks in ${elapsed}s, ${crashes.length} mismatch(es)`);
for (const [name, c] of perTarget)
    console.log(`  ${name.padEnd(10)} ${c.checked} checked, ${c.fails} fail`);

if (crashes.length) {
    mkdirSync(crashDir, { recursive: true });
    const out = new URL(`fuzz-${seed}.json`, crashDir);
    writeFileSync(out, JSON.stringify({ seed, runs, crashes }, null, 2));
    console.error(`repro: node scripts/dtoa/fuzz.mjs --seed ${seed}`);
    console.error(`saved: ${out.pathname}`);
    process.exit(1);
}
process.exit(0);
