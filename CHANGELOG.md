# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

- `dtoa`: swapped the `f64` shortest-decimal core to an AssemblyScript port of `xjb64` v2 while preserving the existing ECMAScript formatting surface.
- Vendored the upstream xjb paper and source snapshot used for the `f64` port under `vendor/xjb/81af30358003c98eda6429fbff0d826e0c259302/`.
- Added Apache-2.0 notice files for the xjb-derived `f64` implementation and vendored references.

## [0.1.0] - 2026-06-06

Initial release.

- `dtoa` / `ftoa`: shortest f64/f32 to string, byte-for-byte V8 `Number.toString`.
- `dtoa_buffered` / `ftoa_buffered`: allocation-free, write UTF-16 into your buffer.
- SIMD digit kernel with a scalar SWAR fallback.
- Power-of-ten tables baked at compile time (no runtime setup).
- Verified against V8 (tests, `verify`, fuzzer); 100% coverage.

[0.1.0]: https://github.com/JairusSW/zmij-as/releases/tag/v0.1.0
