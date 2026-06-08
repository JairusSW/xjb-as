// dtoa/ftoa throughput (MB/s of decimal output) vs the AssemblyScript stdlib,
// by input complexity. Same bench logs as dtoa-comp.mjs (dtoa-comp-* /
// ftoa-comp-*); MB/s is already a rate, so it is NOT normalized by sample count.
//   bun run bench -- --v8 dtoa-comp ftoa-comp

import fs from "node:fs";
import path from "node:path";
import { createBarChart, generateChart, withRuntime, subtitle, RUNTIME } from "../lib/bench-chart.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LOGS = path.join(ROOT, "build", "logs", "as", RUNTIME);

const BUCKETS_F64 = [
  ["zero-special", "zero/special"], ["tiny-fixed", "tiny fixed"],
  ["fixed-fractions", "fixed fractions"], ["long-fixed", "long fixed"],
  ["small-exponent", "small exponent"], ["large-exponent", "large exponent"],
  ["subnormal-boundary", "subnormal/boundary"], ["randomish", "randomish"],
];
const BUCKETS_F32 = [
  ["zero-special", "zero/special"], ["tiny-fixed", "tiny fixed"],
  ["fixed-fractions", "fixed fractions"], ["small-exponent", "small exponent"],
  ["large-exponent", "large exponent"], ["subnormal-boundary", "subnormal/boundary"],
  ["randomish", "randomish"],
];

const SERIES = [
  ["xjb-noalloc", "xjb no-alloc"],
  ["zmij-noalloc", "zmij no-alloc"],
  ["stdlib-noalloc", "stdlib no-alloc"],
  ["xjb-alloc", "xjb alloc"],
  ["zmij-alloc", "zmij alloc"],
  ["stdlib-alloc", "stdlib alloc"],
];

function buildData(prefix, buckets) {
  const data = {};
  for (const [key, label] of buckets) {
    data[label] = {};
    for (const [suffix, seriesLabel] of SERIES) {
      const p = path.join(LOGS, `${prefix}-${key}-${suffix}.as.json`);
      if (!fs.existsSync(p)) continue;
      data[label][seriesLabel] = JSON.parse(fs.readFileSync(p, "utf8")); // mbps is a rate
    }
  }
  return data;
}

const sub = subtitle();
const opts = {
  metric: "mbps",
  yLabel: "MB/s of decimal output (higher is better)",
  xRotation: 30,
  labelFormatter: (v) => Math.round(v).toString(),
};

const f64 = buildData("dtoa-comp", BUCKETS_F64);
if (Object.values(f64).some((g) => Object.keys(g).length)) {
  generateChart(
    createBarChart(f64, { ...opts, title: "dtoa (f64) throughput: xjb-as vs zmij-as vs stdlib", subtitle: sub }),
    withRuntime("./charts/dtoa-throughput-f64.png"),
    { width: 1600, height: 800 },
  );
}

const f32 = buildData("ftoa-comp", BUCKETS_F32);
if (Object.values(f32).some((g) => Object.keys(g).length)) {
  generateChart(
    createBarChart(f32, { ...opts, title: "ftoa (f32) throughput: xjb-as vs zmij-as vs stdlib", subtitle: sub }),
    withRuntime("./charts/dtoa-throughput-f32.png"),
    { width: 1600, height: 800 },
  );
}
