// dtoa/ftoa latency vs the AssemblyScript stdlib, by input complexity.
// Reads dtoa-comp-* (f64) / ftoa-comp-* (f32) bench JSON. Run first:
//   bun run bench -- --v8 dtoa-comp ftoa-comp   (or --wavm / --wazero)

import fs from "node:fs";
import path from "node:path";
import {
    createBarChart,
    generateChart,
    withRuntime,
    subtitle,
    RUNTIME,
    fmtNs1,
} from "../lib/bench-chart.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LOGS = path.join(ROOT, "build", "logs", "as", RUNTIME);

// [key, label, sampleCount] - counts must match the bench arrays so per-pass
// nsPerOp can be normalized to ns per single conversion.
const BUCKETS_F64 = [
    ["zero-special", "zero/special", 8],
    ["tiny-fixed", "tiny fixed", 8],
    ["fixed-fractions", "fixed fractions", 8],
    ["long-fixed", "long fixed", 8],
    ["small-exponent", "small exponent", 8],
    ["large-exponent", "large exponent", 8],
    ["subnormal-boundary", "subnormal/boundary", 8],
    ["randomish", "randomish", 16],
];
const BUCKETS_F32 = [
    ["zero-special", "zero/special", 8],
    ["tiny-fixed", "tiny fixed", 8],
    ["fixed-fractions", "fixed fractions", 8],
    ["small-exponent", "small exponent", 8],
    ["large-exponent", "large exponent", 8],
    ["subnormal-boundary", "subnormal/boundary", 8],
    ["randomish", "randomish", 16],
];

const SERIES = [
    ["xjb-noalloc", "xjb no-alloc"],
    ["xjb-alloc", "xjb alloc"],
    ["zmij-noalloc", "zmij no-alloc"],
    ["zmij-alloc", "zmij alloc"],
    ["stdlib-noalloc", "stdlib no-alloc"],
    ["stdlib-alloc", "stdlib alloc"],
];

// Loads { groupLabel: { seriesLabel: benchResult-with-normalized-nsPerOp } }.
export function buildData(prefix, buckets) {
    const data = {};
    for (const [key, label, n] of buckets) {
        data[label] = {};
        for (const [suffix, seriesLabel] of SERIES) {
            const p = path.join(LOGS, `${prefix}-${key}-${suffix}.as.json`);
            if (!fs.existsSync(p)) continue;
            const r = JSON.parse(fs.readFileSync(p, "utf8"));
            data[label][seriesLabel] = { ...r, nsPerOp: r.nsPerOp / n }; // per conversion
        }
    }
    return data;
}

const sub = subtitle();
const opts = {
    metric: "nsPerOp",
    yLabel: "ns per conversion (lower is better)",
    xRotation: 30,
    labelFormatter: fmtNs1,
};

const f64 = buildData("dtoa-comp", BUCKETS_F64);
if (Object.values(f64).some((g) => Object.keys(g).length)) {
    generateChart(
        createBarChart(f64, {
            ...opts,
            title: "dtoa (f64) latency: xjb-as vs zmij-as vs stdlib",
            subtitle: sub,
        }),
        withRuntime("./charts/dtoa-comp-f64.png"),
        { width: 1600, height: 800 },
    );
}

const f32 = buildData("ftoa-comp", BUCKETS_F32);
if (Object.values(f32).some((g) => Object.keys(g).length)) {
    generateChart(
        createBarChart(f32, {
            ...opts,
            title: "ftoa (f32) latency: xjb-as vs zmij-as vs stdlib",
            subtitle: sub,
        }),
        withRuntime("./charts/dtoa-comp-f32.png"),
        { width: 1600, height: 800 },
    );
}
