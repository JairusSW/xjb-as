# AssemblyScript PR #3025 benchmark charts

Compares AssemblyScript `main` at `b6bda05c29c9eb7d07d7f6cb2703508483b30493` with PR #3025 at `881a8ec43979cd2f72824bb05f87c3942b01854c`.

- Host: AMD Ryzen 7 7800X3D, Node 24.18.0, V8 13.6.233.17-node.50.
- Build: each revision's own `asc`, `--enable simd -O3 --runtime incremental`, identical `harness.ts`.
- Inputs: the `dtoa-comp` and `ftoa-comp` buckets from xjb-as. Each bucket has 8 values, except `randomish` (16).
- Timing: paired alternating order, 11 trials; median ns per conversion. Each buffered trial performs at least 1,000,000 conversions and each allocating trial at least 100,000.
- Buffered means `util/number.dtoa_buffered<T>` writing into a static UTF-16 scratch buffer. Allocating means `util/number.dtoa<T>` returning a string.

`results.json` contains the values and host metadata. `runner.mjs` takes the two compiled Wasm modules. To recreate the images, run `XJB_AS_ROOT=/path/to/xjb-as node render.mjs` with xjb-as dependencies installed.
