// Per-stage latency: zmij-as v0.1 vs xjb-as, f64, by input complexity.
// Grouped stacked bars — each bucket shows a zmij stack next to an xjb stack,
// both split into core / digits / layout+UTF-16 / string-overhead.
// Run first: npm run bench -- dtoa-zmij-vs-xjb-stages

import fs from "node:fs";
import path from "node:path";
import ChartDataLabels from "chartjs-plugin-datalabels";
import {
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
const LOGS = path.join(ROOT, "build", "logs", "as", RUNTIME);

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
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")).nsPerOp;
};

function buildBreakdown() {
    const labels = [];
    // Four stage arrays, two impls each: zmij then xjb interleaved.
    const out = {
        zmijCore: [], zmijDigits: [], zmijNoallocRest: [], zmijStringOverhead: [],
        xjbCore:  [], xjbDigits:  [], xjbNoallocRest:  [], xjbStringOverhead:  [],
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
        // digits = core-digits - core (toDigits64 only)
        // noallocRest = buffered - core-digits (layout + UTF-16 encoding)
        out.zmijCore.push(vals["zmij-core"]);
        out.zmijDigits.push(Math.max(0, vals["zmij-core-digits"] - vals["zmij-core"]));
        out.zmijNoallocRest.push(Math.max(0, vals["zmij-buffered"] - vals["zmij-core-digits"]));
        out.zmijStringOverhead.push(Math.max(0, vals["zmij-string"] - vals["zmij-buffered"]));
        out.xjbCore.push(vals["xjb-core"]);
        out.xjbDigits.push(Math.max(0, vals["xjb-core-digits"] - vals["xjb-core"]));
        out.xjbNoallocRest.push(Math.max(0, vals["xjb-buffered"] - vals["xjb-core-digits"]));
        out.xjbStringOverhead.push(Math.max(0, vals["xjb-string"] - vals["xjb-buffered"]));
    }

    return any ? { labels, ...out } : null;
}

function makeConfig(bd) {
    const { labels } = bd;

    // Datasets ordered bottom->top for each stack. Chart.js stacks datasets with
    // the same `stack` value and groups different stacks side-by-side.
    const datasets = [
        { label: "zmij core",           data: bd.zmijCore,           stack: "zmij-as v0.1", ...ZMIJ_BARS.core },
        { label: "zmij digits",         data: bd.zmijDigits,         stack: "zmij-as v0.1", ...ZMIJ_BARS.digits },
        { label: "zmij layout+UTF-16",  data: bd.zmijNoallocRest,    stack: "zmij-as v0.1", ...ZMIJ_BARS.noallocRest },
        { label: "zmij string-overhead",data: bd.zmijStringOverhead, stack: "zmij-as v0.1", ...ZMIJ_BARS.stringOverhead },
        { label: "xjb core",            data: bd.xjbCore,            stack: "xjb-as",       ...STAGE_BARS.core },
        { label: "xjb digits",          data: bd.xjbDigits,          stack: "xjb-as",       ...STAGE_BARS.digits },
        { label: "xjb layout+UTF-16",   data: bd.xjbNoallocRest,     stack: "xjb-as",       ...STAGE_BARS.noallocRest },
        { label: "xjb string-overhead", data: bd.xjbStringOverhead,  stack: "xjb-as",       ...STAGE_BARS.stringOverhead },
    ].map((d) => ({ ...d, backgroundColor: d.bg, borderColor: d.border, borderWidth: 1 }));

    return {
        type: "bar",
        data: { labels, datasets },
        options: {
            responsive: false,
            plugins: {
                title: {
                    display: true,
                    text: "dtoa (f64) stage breakdown: zmij-as v0.1 vs xjb-as",
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
                    stacked: true,
                    ticks: {
                        font: { size: 11 },
                        color: INK.subtitle,
                        maxRotation: 30,
                        minRotation: 30,
                    },
                    grid: { color: INK.grid },
                },
                y: {
                    stacked: true,
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
