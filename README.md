<h1 align="center"><pre>╦ ╦  ╦ ╔╗     ╔═╗ ╔═╗
 ╬   ║ ╠╩╗ ══ ╠═╣ ╚═╗
╝ ╚ ╚╝ ╚═╝    ╩ ╩ ╚═╝</pre></h1>

<p align="center">
The fastest <strong>ECMAScript-<code>Number.toString</code>-compatible</strong>
<code>f64</code>/<code>f32</code> → string for
<a href="https://www.assemblyscript.org/">AssemblyScript</a>, built on the
<strong><a href="https://github.com/xjb714/xjb">xjb</a></strong> / <strong><a href="https://github.com/vitaut/zmij" >Żmij</a></strong> family of shortest-decimal cores.
</p>

<details>
<summary>Table of Contents</summary>

- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
- [Performance](#performance)
- [Verification](#verification)
- [Benchmarks](#benchmarks)
- [Architecture](#architecture)
- [Credits](#credits)
- [License](#license)
- [Contact](#contact)

</details>

## Installation

```bash
npm install xjb-as
```

`xjb-as` is plain exported functions - no compiler transform required. The digit
kernel uses [SIMD](https://en.wikipedia.org/wiki/Single_instruction,_multiple_data) when available
and falls back to scalar [SWAR](https://en.wikipedia.org/wiki/SWAR) otherwise.

To enable SIMD, add to your `asc` command:

```bash
--enable simd
```

Or in your `asconfig.json`:

```json
{
  "options": {
    "enable": ["simd"]
  }
}
```

## Usage

```typescript
import { dtoa, dtoa_buffered, ftoa, ftoa_buffered } from "xjb-as";

dtoa(3.14159);     // "3.14159"
dtoa(1e21);        // "1e+21"
dtoa(-0.0);        // "0"
ftoa(0.1);         // "0.1"
```

Writing a serializer with its own buffer? Skip the `String` allocation and write
UTF-16 straight into your buffer:

```typescript
// UTF-16 written directly into your buffer (>= 64 bytes); no allocation.
const codeUnits = dtoa_buffered(buffer, value);
```

`dtoa(x)` matches V8 `x.toString()` / `JSON.stringify(x)` byte-for-byte -
including `Infinity`, `-Infinity`, `NaN`, `-0 → "0"`, `1e21 → "1e+21"`,
`1e-7 → "1e-7"`, the fixed-vs-exponential thresholds, and the minimal-width
signed exponent per [ECMAScript Specification](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-tostring).

## API

```typescript
dtoa(value: f64): string                 // shortest round-trip, ECMAScript-formatted
dtoa_buffered(buffer, value: f64): u32   // write UTF-16 into buffer, return code-unit count
ftoa(value: f32): string                 // shortest round-trip, ECMAScript-formatted
ftoa_buffered(buffer, value: f32): u32   // write UTF-16 into buffer, return code-unit count
```

**Buffer contract.** `dtoa_buffered` / `ftoa_buffered` write the shortest decimal
as UTF-16 *directly* into `buffer` (no intermediate ASCII pass or widening);
`buffer` needs ≥ 64 bytes. The returned code-unit count is exact - the extra
headroom covers the in-register digit-block stores, which can overshoot the
logical end by up to one 8-char block.

## Performance

<p align="center">
<img src="https://raw.githubusercontent.com/JairusSW/xjb-as/refs/heads/docs/charts/v0.1.0/01-59184cf/dtoa-comp-f64-wavm.png" alt="dtoa (f64) latency vs the AssemblyScript stdlib, by input complexity">
</p>
<p align="center">
<img src="https://raw.githubusercontent.com/JairusSW/xjb-as/refs/heads/docs/charts/v0.1.0/01-59184cf/dtoa-comp-f32-wavm.png" alt="ftoa (f32) latency vs the AssemblyScript stdlib, by input complexity">
</p>
<p align="center">
<img src="https://raw.githubusercontent.com/JairusSW/xjb-as/refs/heads/docs/charts/v0.1.0/01-59184cf/dtoa-stages-f64-wavm.png" alt="dtoa (f64) per-stage latency breakdown">
</p>

Charts are published per release to the `docs` branch via `npm run charts:publish`
(`scripts/publish-charts.sh`) and pinned here by version.

## Verification

`dtoa`/`ftoa` are checked against V8 ground truth (`Number::toString` for f64; the
exact BigInt shortest-round-trip for f32) - 0 failures across every power of two
(±1/±0xF ulp), every power of ten, tens of millions of random values, and a
generated assertion suite with 100% line/branch coverage.

```bash
# generate the as-test spec from the V8 oracle, then run the suite
npm run gen-spec
npm test

# build the verify wasm + check against V8 (fixed edge + 2M random; pass a count)
npm run verify
node scripts/dtoa/verify.mjs 3000

# open-ended differential fuzz vs V8 (seeded, repro-friendly; --runs/--time/--seed)
npm run fuzz
```

## Benchmarks

```bash
npm run bench -- --v8 --wavm
npm run charts:build -- --v8 --wavm
npm run charts:serve
```

## Binary size

Float→string code is mostly its pow10 lookup table. Build with `-Oz` (or
`-Os`) and the f64 table shrinks from ~9.9 KB to ~5 KB: a Dragonbox-style
**compressed anchor cache** reconstructed at load time (one multiply-by-5 per
in-between power), selected automatically via `ASC_SHRINK_LEVEL` and **bit-identical**
to the full table. The f32 path is a compact, self-contained core (~1.2 KB
hi-only table) — an f32-only build never pulls in the f64 machinery.

| build (`--runtime stub`, SIMD) |   `-O3` |   `-Oz` |
| ------------------------------ | ------: | ------: |
| `dtoa` (f64)                   | 13.4 KB |  9.0 KB |
| `ftoa` (f32)                   |  2.9 KB |  2.9 KB |
| both                           | 21.9 KB | 17.9 KB |

## Architecture

Three modules under `assembly/`:

- **`dtoa.ts`** (f64) — ports the upstream `xjb64` v2 shortest-decimal core.
- **`ftoa.ts`** (f32) — a self-contained port of xjb's compact
  single-hi-multiply f32 core (24-bit significand ⇒ a hi-only table and a
  narrow 64×24 product).
- **`xjb.ts`** — the shared f64 engine `dtoa.ts` builds on: 128-bit math, the
  pow10 tables + loads (full, or the compressed anchor cache at `-Oz`), the
  SIMD/SWAR digit kernel, and the UTF-16 layout writers.

The formatter lays out digits per the [ECMA-262 `Number::toString` decision tree](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-tostring) and stores UTF-16 directly.

## Credits

The shortest-decimal **digits** are identical to Ryū/Dragonbox (shortest,
round-to-nearest-even) - exactly what ECMA-262 mandates; only the surface
formatting differs.

## License

[MIT + Apache-2.0 notices](./LICENSE)

## Contact

Please send all issues to [GitHub Issues](https://github.com/JairusSW/xjb-as/issues) and to converse, please send me an email at [me@jairus.dev](mailto:me@jairus.dev)

- **Email:** Send me inquiries, questions, or requests at [me@jairus.dev](mailto:me@jairus.dev)
- **GitHub:** Visit the official GitHub repository [Here](https://github.com/JairusSW/xjb-as)
- **Website:** Visit my official website at [jairus.dev](https://jairus.dev/)
- **Discord:** Contact me at [My Discord](https://discord.com/users/600700584038760448) or on the [AssemblyScript Discord Server](https://discord.gg/assemblyscript/)
