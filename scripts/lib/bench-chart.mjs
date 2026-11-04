// Shared helpers for chart-building scripts under scripts/charts/*.mjs.
// Runtime is selected by the BENCH_CHART_RUNTIME env var (set by
// scripts/build-charts.sh from runtime flags). Default: wavm.
//
// Each chart .mjs file:
//   1. import { loadResults, createBarChart, generateChart } from "../lib/bench-chart.mjs"
//   2. assemble a Record<label, BenchResult[]>
//   3. createBarChart + generateChart("./charts/<name>-<runtime>.png")

import fs from "node:fs";
import path from "node:path";
import { validateMetadata } from "./bench-metadata.mjs";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { BARS, GRAY, INK } from "./palette.mjs";

export { INK, STAGE_BARS } from "./palette.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LOGS_DIR = process.env.BENCH_CHART_LOGS_DIR ?? path.join(ROOT, "build", "logs", "as");

const RAW_RUNTIME = (process.env.BENCH_CHART_RUNTIME ?? "wavm")
    .trim()
    .toLowerCase();
export const RUNTIME = RAW_RUNTIME === "llvm" ? "wavm" : RAW_RUNTIME;
if (!["v8", "wavm", "wasmtime", "wazero"].includes(RUNTIME))
    throw new Error(`Unknown chart runtime: ${RAW_RUNTIME}`);
export const RESULTS_DIR = path.join(LOGS_DIR, RUNTIME);
const loaded = new Map();
let measurement;

/** Required benchmark input: never silently turn missing data into a result. */
export function readBenchFile(filename) {
    if (!fs.existsSync(filename)) throw new Error(`Missing benchmark result: ${filename}`);
    const row = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (row.benchmarkSchemaVersion !== 3) throw new Error(`Outdated benchmark schema: ${filename}; rerun benchmarks.`);
    const m = validateMetadata(row.measurement);
    if (m.runtime.name !== RUNTIME || row.runtime !== RUNTIME) throw new Error(`Runtime mismatch in ${filename}`);
    if (measurement && measurement.group !== m.group) throw new Error(`Mixed measurement runs in ${filename}; rerun all selected benchmarks together.`);
    for (const metric of ["nsPerOp", "opsPerSecond", "mbps", "elapsed", "operations", "bytes"])
        if (!Number.isFinite(row[metric]) || row[metric] < 0 || (["nsPerOp", "opsPerSecond", "elapsed", "operations"].includes(metric) && row[metric] === 0))
            throw new Error(`Invalid ${metric} in ${filename}`);
    measurement = m;
    loaded.set(filename, m);
    return row;
}

export function loadBench(stem) {
    return readBenchFile(path.join(LOGS_DIR, RUNTIME, `${stem}.as.json`));
}
export function loadResults(stems) {
    return Object.fromEntries(stems.map(stem => [stem, loadBench(stem)]));
}

/**
 * Data-label formatter for ns values: rounds to at most 1 decimal, trims a
 * trailing zero, and prints integers cleanly ("17", "7.1", "3.5").
 */
export const fmtNs1 = (v) => parseFloat(Number(v).toFixed(1)).toString();

/** Labels describe measurements, never the chart-rendering environment. */
export function subtitle() {
    if (!measurement) throw new Error("No measurement metadata loaded for chart subtitle");
    const m = measurement;
    return [m.measuredAt.slice(0, 10), `v${m.packageVersion}`, `${m.runtime.name} ${m.runtime.version}`,
        m.compiler.version, m.source.commit.slice(0, 7) + (m.source.dirty ? " (dirty)" : ""),
        m.machine.cpu, m.machine.arch].join(" • ");
}

// Series colours come from the shared json-as palette; overflow -> GRAY.
const colorFor = (i) => BARS[i] ?? GRAY;

/**
 * Build a grouped-bar chart config.
 *
 * `data` shape: `{ <groupLabel>: { <seriesLabel>: BenchResult } }`
 * The chart groups by group (x-axis) and one bar per series.
 *
 * `opts.metric` picks the field to plot - default "mbps". Use "gbps" for
 * GB/s, or any other numeric field on BenchResult.
 */
export function createBarChart(data, opts = {}) {
    const groups = Object.keys(data);
    if (groups.length === 0) throw new Error("createBarChart: no groups");
    const seriesLabels = [
        ...new Set(groups.flatMap((g) => Object.keys(data[g]))),
    ];
    if (!seriesLabels.length) throw new Error("createBarChart: no series");
    const metric = opts.metric ?? "mbps";

    const datasets = seriesLabels.map((label, i) => {
        const { bg, border } = colorFor(i);
        return {
            label,
            data: groups.map((g) => {
                const row = data[g][label];
                if (row == null) {
                    if (opts.allowIncomplete) return null;
                    throw new Error(`Missing series ${label} in ${g}`);
                }
                const value = row[metric];
                if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${metric} for ${label} in ${g}`);
                return value;
            }),
            backgroundColor: bg,
            borderColor: border,
            borderWidth: 1,
        };
    });

    return {
        type: "bar",
        data: { labels: groups, datasets },
        options: {
            responsive: false,
            plugins: {
                title: opts.title
                    ? {
                          display: true,
                          text: opts.title,
                          font: { size: 20, weight: "bold" },
                      }
                    : { display: false },
                subtitle: {
                    display: true,
                    text: (opts.subtitle ?? subtitle()) + (opts.allowIncomplete ? " • incomplete data" : ""),
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
                    anchor: "end",
                    align: "start",
                    offset: 4,
                    color: "#fff",
                    font: { size: 11, weight: "bold" },
                    formatter:
                        opts.labelFormatter ??
                        ((v) => Math.round(v).toLocaleString()),
                },
            },
            layout: { padding: { top: 24 } },
            scales: {
                y: {
                    beginAtZero: true,
                    grace: "8%",
                    title: {
                        display: true,
                        text: opts.yLabel ?? metricLabel(metric),
                        color: INK.subtitle,
                        font: { size: 16, weight: "bold" },
                    },
                    ticks: {
                        color: INK.subtitle,
                        font: { size: 13, weight: "bold" },
                    },
                    grid: { color: INK.grid },
                },
                x: {
                    ticks: {
                        font: { size: 11 },
                        color: INK.subtitle,
                        maxRotation: opts.xRotation ?? 45,
                        minRotation: opts.xRotation ?? 45,
                    },
                    grid: { color: INK.grid },
                },
            },
        },
        plugins: [ChartDataLabels],
    };
}

function metricLabel(metric) {
    if (metric === "mbps") return "MB/s";
    if (metric === "gbps") return "GB/s";
    if (metric === "nsPerOp") return "ns/op";
    if (metric === "opsPerSecond") return "ops/s";
    return metric;
}

// Shared canvas instances keyed by "WxH" - avoids re-registering ChartDataLabels
// across multiple generateChart() calls in the same process (double-registration
// corrupts the plugin's state and drops labels from the second chart onward).
const canvasCache = new Map();

function getCanvas(width, height) {
    const key = `${width}x${height}`;
    if (!canvasCache.has(key)) {
        canvasCache.set(
            key,
            new ChartJSNodeCanvas({
                width,
                height,
                backgroundColour: "transparent",
                chartCallback: (ChartJS) => {
                    ChartJS.register(ChartDataLabels);
                    // All chart text defaults to the sidebar ink.
                    ChartJS.defaults.color = INK.subtitle;
                },
            }),
        );
    }
    return canvasCache.get(key);
}

/** Render a Chart.js config to PNG. Returns the absolute output path. */
export function generateChart(
    config,
    outPath,
    { width = 1280, height = 720 } = {},
) {
    if (!measurement || !loaded.size) throw new Error("Cannot render chart without measurement provenance");
    const abs = process.env.BENCH_CHART_OUTPUT_DIR
        ? path.resolve(process.env.BENCH_CHART_OUTPUT_DIR, path.basename(outPath))
        : path.isAbsolute(outPath) ? outPath : path.join(ROOT, outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, getCanvas(width, height).renderToBufferSync(config));
    fs.writeFileSync(abs + ".measurement.json", JSON.stringify({
        measurement,
        inputs: [...loaded].map(([filename, m]) => ({ filename: path.relative(ROOT, filename), measurement: m })),
    }, null, 2) + "\n");
    console.log("wrote", path.relative(ROOT, abs));
    return abs;
}

/** Append `-<runtime>` before the extension. `/x/chart.png` -> `/x/chart-v8.png`. */
export function withRuntime(outPath) {
    const ext = path.extname(outPath);
    return outPath.slice(0, -ext.length) + "-" + RUNTIME + ext;
}
