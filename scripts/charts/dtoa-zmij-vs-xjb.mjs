// dtoa (f64) latency: zmij-as v0.1 vs xjb-as, by input complexity.
// Reads dtoa-zmij-vs-xjb-* bench JSON. Run first:
//   npm run bench -- dtoa-zmij-vs-xjb   (or with --v8 / --wavm / --wazero)

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

// [key, label, sampleCount]
const BUCKETS = [
    ["zero-special",      "zero/special",      8],
    ["tiny-fixed",        "tiny fixed",         8],
    ["fixed-fractions",   "fixed fractions",    8],
    ["long-fixed",        "long fixed",         8],
    ["small-exponent",    "small exponent",     8],
    ["large-exponent",    "large exponent",     8],
    ["subnormal-boundary","subnormal/boundary", 8],
    ["randomish",         "randomish",         16],
];

const NOALLOC_SERIES = [
    ["zmij-noalloc", "zmij-as v0.1"],
    ["xjb-noalloc",  "xjb-as"],
];

const ALLOC_SERIES = [
    ["zmij-alloc", "zmij-as v0.1"],
    ["xjb-alloc",  "xjb-as"],
];

function buildData(buckets, series) {
    const data = {};
    for (const [key, label, n] of buckets) {
        data[label] = {};
        for (const [suffix, seriesLabel] of series) {
            const p = path.join(LOGS, `dtoa-zmij-vs-xjb-${key}-${suffix}.as.json`);
            if (!fs.existsSync(p)) continue;
            const r = JSON.parse(fs.readFileSync(p, "utf8"));
            data[label][seriesLabel] = { ...r, nsPerOp: r.nsPerOp / n };
        }
    }
    return data;
}

const chartOpts = {
    metric: "nsPerOp",
    yLabel: "ns per conversion (lower is better)",
    xRotation: 30,
    labelFormatter: fmtNs1,
    subtitle: subtitle(),
};

let wrote = 0;

const noalloc = buildData(BUCKETS, NOALLOC_SERIES);
if (Object.values(noalloc).some((g) => Object.keys(g).length)) {
    generateChart(
        createBarChart(noalloc, {
            ...chartOpts,
            title: "dtoa (f64) no-alloc: zmij-as v0.1 vs xjb-as, by complexity",
        }),
        withRuntime("./charts/dtoa-zmij-vs-xjb-noalloc.png"),
        { width: 1600, height: 800 },
    );
    wrote++;
}

const alloc = buildData(BUCKETS, ALLOC_SERIES);
if (Object.values(alloc).some((g) => Object.keys(g).length)) {
    generateChart(
        createBarChart(alloc, {
            ...chartOpts,
            title: "dtoa (f64) alloc: zmij-as v0.1 vs xjb-as, by complexity",
        }),
        withRuntime("./charts/dtoa-zmij-vs-xjb-alloc.png"),
        { width: 1600, height: 800 },
    );
    wrote++;
}

if (!wrote) {
    console.error(`No bench data found in ${path.relative(ROOT, LOGS)}.`);
    console.error("Run: npm run bench -- dtoa-zmij-vs-xjb");
    process.exit(1);
}
