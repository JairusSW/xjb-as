// dtoa / ftoa per-stage latency breakdown by input complexity.
//
// Stacked bars - each bucket's bar is split into the pipeline stages, summing to
// the full dtoa()/ftoa() cost:
//   core   (measured)  binary -> shortest decimal (Schubfach)
//   digits (measured)  decimal significand -> packed ASCII digit block
//   noalloc-rest (derived) digit placement + direct UTF-16 stores
//   string-overhead (derived) allocation + string-path widening
//
// where noalloc-rest = buffered - core - digits and
// string-overhead = string - buffered.
//
// Run the bench first:
//   bun run bench -- --v8 dtoa-stages     (or --wavm / --wazero)

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

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LOGS = path.join(ROOT, "build", "logs", "as", RUNTIME);

// [key, label, sampleCount] - counts must match the arrays in the bench so the
// per-pass nsPerOp can be normalized to ns per single conversion.
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

// Stacked stages, bottom -> top, coloured from the shared json-as palette.
const STAGES = [
    ["core", "core (binary->decimal)", STAGE_BARS.core.bg, STAGE_BARS.core.border],
    ["digits", "digits (->ASCII)", STAGE_BARS.digits.bg, STAGE_BARS.digits.border],
    ["noallocRest", "layout + UTF-16", STAGE_BARS.noallocRest.bg, STAGE_BARS.noallocRest.border],
    ["stringOverhead", "string overhead", STAGE_BARS.stringOverhead.bg, STAGE_BARS.stringOverhead.border],
];

const ns = (prefix, bucket, stem) => {
    const p = path.join(LOGS, `${prefix}-${bucket}-${stem}.as.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")).nsPerOp;
};

// Returns { labels, stages: { core:[], digits:[], noallocRest:[], stringOverhead:[] } }
// or null if no bench data is present for this type.
function buildBreakdown(type, buckets) {
    const labels = [];
    const stages = Object.fromEntries(STAGES.map(([k]) => [k, []]));
    let any = false;

    for (const [key, label, count] of buckets) {
        let core = ns(type, key, "core");
        let digits = ns(type, key, "digits");
        let buffered = ns(type, key, "buffered");
        let string = ns(type, key, "string");
        if ([core, digits, buffered, string].some((v) => v == null)) continue;
        any = true;

        // Each routine times one pass over `count` samples; normalize to ns per
        // single conversion so buckets of different sizes are comparable.
        core /= count;
        digits /= count;
        buffered /= count;
        string /= count;

        // Derived stages. Clamp at 0 - measurement noise (and, for the degenerate
        // zero/special bucket, the isolated digit kernel running on a 0 significand)
        // can push a remainder slightly negative.
        const noallocRest = Math.max(0, buffered - core - digits);
        const stringOverhead = Math.max(0, string - buffered);

        labels.push(label);
        stages.core.push(core);
        stages.digits.push(digits);
        stages.noallocRest.push(noallocRest);
        stages.stringOverhead.push(stringOverhead);
    }

    return any ? { labels, stages } : null;
}

function makeConfig(breakdown, title) {
    const { labels, stages } = breakdown;
    const datasets = STAGES.map(([key, label, fill, border]) => ({
        label,
        data: stages[key],
        backgroundColor: fill,
        borderColor: border,
        borderWidth: 1,
    }));

    return {
        type: "bar",
        data: { labels, datasets },
        options: {
            responsive: false,
            plugins: {
                title: {
                    display: true,
                    text: title,
                    font: { size: 20, weight: "bold" },
                },
                subtitle: {
                    display: true,
                    text: subtitle(),
                    position: "right", // vertical sidebar on the right edge
                    font: { size: 14, weight: "bold" },
                    color: INK.subtitle,
                    padding: 16,
                },
                legend: {
                    position: "top",
                    labels: { font: { size: 13, weight: "bold" } },
                },
                datalabels: {
                    color: "#fff",
                    font: { size: 10, weight: "bold" },
                    // Hide labels on tiny segments to avoid clutter.
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
                    ticks: {
                        color: INK.subtitle,
                        font: { size: 13, weight: "bold" },
                    },
                    grid: { color: INK.grid },
                },
            },
        },
        plugins: [ChartDataLabels],
    };
}

let wrote = 0;

const f64 = buildBreakdown("dtoa-stages", BUCKETS_F64);
if (f64) {
    generateChart(
        makeConfig(f64, "dtoa (f64) stage breakdown by complexity"),
        withRuntime("./charts/dtoa-stages-f64.png"),
        { width: 1600, height: 800 },
    );
    wrote++;
}

const f32 = buildBreakdown("ftoa-stages", BUCKETS_F32);
if (f32) {
    generateChart(
        makeConfig(f32, "ftoa (f32) stage breakdown by complexity"),
        withRuntime("./charts/dtoa-stages-f32.png"),
        { width: 1600, height: 800 },
    );
    wrote++;
}

if (wrote === 0) {
    console.warn(
        `no dtoa-stages bench data in ${LOGS} - run: bun run bench -- --${RUNTIME} dtoa-stages`,
    );
}
