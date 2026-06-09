# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-08

### Added

- `dtoa` / `ftoa`: shortest f64/f32 to string, byte-for-byte V8 `Number.toString`.
- `dtoa_buffered` / `ftoa_buffered`: allocation-free, write UTF-16 into your buffer.
- SIMD digit kernel with a scalar SWAR fallback.
- Power-of-ten tables baked at compile time (no runtime setup).
- Verified against V8 (tests, `verify`, fuzzer); 100% coverage.
- **Smaller binaries via `-Oz`.** The `f64` pow10 table now has a Dragonbox-style
  compressed form: a ~5 KB anchor cache reconstructed at load (one multiply-by-5
  per in-between power) replaces the full ~9.9 KB table, selected automatically by
  `ASC_SHRINK_LEVEL` (`-Os`/`-Oz`) and **bit-identical** to the full table. Cuts
  the `f64` module from ~13.4 KB to ~9.0 KB; an `f32`-only build is ~2.9 KB.
- Differential fuzzer and verifier now cover all build targets against the V8
  oracle — full-table `f64`, compressed `f64`, and the compact `f32` — with
  per-target tallies (`scripts/dtoa/{build,fuzz,verify}.mjs`).
- The as-test suite runs every spec across the full matrix of SIMD/SWAR ×
  `ASC_SHRINK_LEVEL` 0/1/2, so every table and digit-path condition is exercised.

### Changed

- **`f64` core** swapped to an AssemblyScript port of `xjb64` v2, preserving the
  ECMAScript formatting surface byte-for-byte.
- **`f32` core** swapped to a self-contained port of xjb's compact single-hi-
  multiply core (24-bit significand ⇒ a hi-only pow10 table and a narrow 64×24
  product) — smaller and faster than the prior Żmij/xjb-derived shared-table path,
  with identical output (verified exhaustively over all 2³² floats).
- Source split into focused modules under `assembly/`: `dtoa.ts` (f64),
  `ftoa.ts` (compact f32), and the shared `f64` engine `xjb.ts`.
- Pruned f32-only code that became unreachable once `ftoa.ts` went
  self-contained (orphaned digit/layout helpers in `xjb.ts`, an `f64`-impossible
  exponent branch, etc.) and specialized the shared layout writer to `f64` -
  restoring 100% line/branch coverage across all three modules.
- Vendored the upstream xjb paper and source snapshot used for the `f64` and
  `f32` ports under `vendor/xjb/81af30358003c98eda6429fbff0d826e0c259302/`, and
  added Apache-2.0 notice files for the xjb-derived implementations.

[0.1.0]: https://github.com/JairusSW/xjb-as/releases/tag/v0.1.0
