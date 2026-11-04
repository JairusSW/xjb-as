// Per-stage latency: zmij-as v0.1 vs xjb-as, f64, by input complexity.
// Grouped independent measurements for general kernels and complete API calls.
// Run first: npm run bench -- dtoa-zmij-vs-xjb-stages

import fs from "node:fs";
import path from "node:path";
import ChartDataLabels from "chartjs-plugin-datalabels";
import {
    RESULTS_DIR,
    readBenchFile,
    generateChart,
    withRuntime,
    subtitle,
    RUNTIME,
    fmtNs1,
    INK,
    STAGE_BARS,
} from "../lib/bench-chart.mjs";
import { rgba, BASE } from "../lib/palette.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LOGS = RESULTS_DIR;

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

// Muted variants for zmij (same hue, lower alpha), vivid for xjb.
const ZMIJ_BARS = {
    core:           { bg: rgba("pacificBlue", 0.45), border: BASE.pacificBlue },
    digits:         { bg: rgba("jungleGreen", 0.40), border: BASE.jungleGreen },
    noallocRest:    { bg: rgba("orange",      0.40), border: BASE.orange },
    stringOverhead: { bg: rgba("strawberryRed", 0.40), border: BASE.strawberryRed },
};

const ns = (bucket, impl, stem) => {
    const p = path.join(LOGS, `dtoa-zmij-vs-xjb-stages-${bucket}-${impl}-${stem}.as.json`);
    const row = readBenchFile(p);
    if (row.benchmarkSchemaVersion !== 3)
        throw new Error(`Outdated kernel measurements in ${p}; rerun the stage benchmarks.`);
    return row.nsPerOp;
};

function buildBreakdown() {
    const labels = [];
    // Four independent measurements for each implementation.
    const out = {
        zmijCore: [], zmijCoreDigits: [], zmijBuffered: [], zmijString: [],
        xjbCore:  [], xjbCoreDigits:  [], xjbBuffered:  [], xjbString:  [],
    };
    let any = false;

    for (const [key, label, count] of BUCKETS) {
        const vals = {};
        for (const impl of ["zmij", "xjb"]) {
            // "core-digits" stem measures core+toDigits64 chained (avoids pre-computation stall)
            for (const stem of ["core", "core-digits", "buffered", "string"]) {
                const v = ns(key, impl, stem);
                if (v == null) continue;
                vals[`${impl}-${stem}`] = v / count;
            }
        }
        const needed = ["zmij-core","zmij-core-digits","zmij-buffered","zmij-string",
                        "xjb-core", "xjb-core-digits", "xjb-buffered", "xjb-string"];
        if (!needed.every((k) => vals[k] != null)) continue;
        any = true;

        labels.push(label);
        // Kernels and public APIs are independent measurements.
        for (const impl of ["zmij", "xjb"]) {
            out[`${impl}Core`].push(vals[`${impl}-core`]);
            out[`${impl}CoreDigits`].push(vals[`${impl}-core-digits`]);
            out[`${impl}Buffered`].push(vals[`${impl}-buffered`]);
            out[`${impl}String`].push(vals[`${impl}-string`]);
        }
    }

    return any ? { labels, ...out } : null;
}

function makeConfig(bd) {
    const { labels } = bd;

    // Compare complete measured quantities; no subtraction or stacking.
    const datasets = [
        { label: "zmij core",           data: bd.zmijCore,            ...ZMIJ_BARS.core },
        { label: "zmij core+digits kernel",         data: bd.zmijCoreDigits,          ...ZMIJ_BARS.digits },
        { label: "zmij buffered API",  data: bd.zmijBuffered,     ...ZMIJ_BARS.noallocRest },
        { label: "zmij string API",data: bd.zmijString,  ...ZMIJ_BARS.stringOverhead },
        { label: "xjb core",            data: bd.xjbCore,                   ...STAGE_BARS.core },
        { label: "xjb core+digits kernel",          data: bd.xjbCoreDigits,                 ...STAGE_BARS.digits },
        { label: "xjb buffered API",   data: bd.xjbBuffered,            ...STAGE_BARS.noallocRest },
        { label: "xjb string API", data: bd.xjbString,         ...STAGE_BARS.stringOverhead },
    ].map((d) => ({ ...d, backgroundColor: d.bg, borderColor: d.border, borderWidth: 1 }));

    return {
        type: "bar",
        data: { labels, datasets },
        options: {
            responsive: false,
            plugins: {
                title: {
                    display: true,
                    text: "dtoa (f64) kernels and complete calls: zmij-as v0.1 vs xjb-as",
                    font: { size: 20, weight: "bold" },
                },
                subtitle: {
                    display: true,
                    text: subtitle(),
                    position: "right",
                    font: { size: 14, weight: "bold" },
                    color: INK.subtitle,
                    padding: 16,
                },
                legend: {
                    position: "top",
                    labels: { font: { size: 12, weight: "bold" } },
                },
                datalabels: {
                    color: "#fff",
                    font: { size: 10, weight: "bold" },
                    display: (ctx) => ctx.dataset.data[ctx.dataIndex] >= 1.5,
                    formatter: fmtNs1,
                },
            },
            layout: { padding: { top: 24 } },
            scales: {
                x: {
                    stacked: false,
                    ticks: {
                        font: { size: 11 },
                        color: INK.subtitle,
                        maxRotation: 30,
                        minRotation: 30,
                    },
                    grid: { color: INK.grid },
                },
                y: {
                    stacked: false,
                    beginAtZero: true,
                    grace: "8%",
                    title: {
                        display: true,
                        text: "ns per conversion (lower is better)",
                        color: INK.subtitle,
                        font: { size: 16, weight: "bold" },
                    },
                    ticks: { color: INK.subtitle, font: { size: 13, weight: "bold" } },
                    grid: { color: INK.grid },
                },
            },
        },
        plugins: [ChartDataLabels],
    };
}

const bd = buildBreakdown();
if (bd) {
    generateChart(
        makeConfig(bd),
        withRuntime("./charts/dtoa-zmij-vs-xjb-stages.png"),
        { width: 1800, height: 900 },
    );
} else {
    console.error(`No stages bench data in ${path.relative(ROOT, LOGS)}.`);
    console.error("Run: npm run bench -- dtoa-zmij-vs-xjb-stages");
    process.exit(1);
}
