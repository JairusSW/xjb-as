// dtoa/ftoa overhead ratios vs the AssemblyScript stdlib, by input complexity.
// Derived from the dtoa-comp-* / ftoa-comp-* bench logs (ratios use raw nsPerOp;
// the per-pass->per-conversion factor cancels). Four ratios per bucket:
//   alloc tax        = xjb alloc / xjb no-alloc        (> 1: the String cost)
//   no-alloc speedup = stdlib no-alloc / xjb no-alloc  (> 1: we win)
//   alloc speedup    = stdlib alloc / xjb alloc         (> 1: we win)
//   zmij / xjb       = zmij no-alloc / xjb no-alloc    (> 1: xjb is faster)
//   bun run bench -- --v8 dtoa-comp ftoa-comp

import fs from "node:fs";
import path from "node:path";
import {
    createBarChart,
    generateChart,
    withRuntime,
    subtitle,
    RUNTIME,
} from "../lib/bench-chart.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LOGS = path.join(ROOT, "build", "logs", "as", RUNTIME);

const BUCKETS_F64 = [
    "zero-special",
    "tiny-fixed",
    "fixed-fractions",
    "long-fixed",
    "small-exponent",
    "large-exponent",
    "subnormal-boundary",
    "randomish",
];
const BUCKETS_F32 = [
    "zero-special",
    "tiny-fixed",
    "fixed-fractions",
    "small-exponent",
    "large-exponent",
    "subnormal-boundary",
    "randomish",
];

const ns = (prefix, bucket, suffix) => {
    const p = path.join(LOGS, `${prefix}-${bucket}-${suffix}.as.json`);
    return fs.existsSync(p)
        ? JSON.parse(fs.readFileSync(p, "utf8")).nsPerOp
        : null;
};

const ALLOC_TAX = "xjb alloc / no-alloc";
const NOALLOC_WIN = "stdlib / xjb (no-alloc)";
const ALLOC_WIN = "stdlib / xjb (alloc)";
const ZMIJ_XJB = "zmij / xjb (no-alloc)";

function addBuckets(data, prefix, buckets, tag) {
    for (const bucket of buckets) {
        const xn = ns(prefix, bucket, "xjb-noalloc");
        const xa = ns(prefix, bucket, "xjb-alloc");
        const zn = ns(prefix, bucket, "zmij-noalloc");
        const sn = ns(prefix, bucket, "stdlib-noalloc");
        const sa = ns(prefix, bucket, "stdlib-alloc");
        if ([xn, xa, sn, sa].some((v) => v == null)) continue;
        const label = `${tag} ${bucket}`;
        data[label] = {
            [ALLOC_TAX]: { ratio: xa / xn },
            [NOALLOC_WIN]: { ratio: sn / xn },
            [ALLOC_WIN]: { ratio: sa / xa },
            ...(zn != null ? { [ZMIJ_XJB]: { ratio: zn / xn } } : {}),
        };
    }
}

const data = {};
addBuckets(data, "dtoa-comp", BUCKETS_F64, "f64");
addBuckets(data, "ftoa-comp", BUCKETS_F32, "f32");

if (Object.keys(data).length) {
    generateChart(
        createBarChart(data, {
            metric: "ratio",
            yLabel: "ratio (× - higher = bigger gap)",
            title: "dtoa/ftoa overhead ratios: xjb-as vs zmij-as vs stdlib",
            subtitle: subtitle(),
            xRotation: 60,
            labelFormatter: (v) => v.toFixed(2),
        }),
        withRuntime("./charts/dtoa-overhead.png"),
        { width: 1700, height: 800 },
    );
} else {
    console.warn(
        `no dtoa-comp/ftoa-comp logs in ${LOGS} - run: bun run bench -- --${RUNTIME} dtoa-comp ftoa-comp`,
    );
}
