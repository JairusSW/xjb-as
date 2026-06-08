// Shared helpers for chart-building scripts under scripts/charts/*.mjs.
// Runtime is selected by the BENCH_CHART_RUNTIME env var (set by
// scripts/build-charts.sh from --v8/--wavm/--wazero flags). Default: wavm.
//
// Each chart .mjs file:
//   1. import { loadResults, createBarChart, generateChart } from "../lib/bench-chart.mjs"
//   2. assemble a Record<label, BenchResult[]>
//   3. createBarChart + generateChart("./charts/<name>-<runtime>.png")

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { BARS, GRAY, INK } from "./palette.mjs";

export { INK, STAGE_BARS } from "./palette.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LOGS_DIR = path.join(ROOT, "build", "logs", "as");

const RAW_RUNTIME = (process.env.BENCH_CHART_RUNTIME ?? "wavm")
    .trim()
    .toLowerCase();
export const RUNTIME = ["v8", "wavm", "wazero"].includes(RAW_RUNTIME)
    ? RAW_RUNTIME
    : "v8";

/** Read a single bench JSON (returns null if missing). */
export function loadBench(stem) {
    const p = path.join(LOGS_DIR, RUNTIME, `${stem}.as.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Bulk load - returns { stem: payload } for every stem found. Stems missing
 *  on disk are silently omitted; check `.length` if completeness matters. */
export function loadResults(stems) {
    const out = {};
    for (const stem of stems) {
        const v = loadBench(stem);
        if (v) out[stem] = v;
    }
    return out;
}

/**
 * Data-label formatter for ns values: rounds to at most 1 decimal, trims a
 * trailing zero, and prints integers cleanly ("17", "7.1", "3.5").
 */
export const fmtNs1 = (v) => parseFloat(Number(v).toFixed(1)).toString();

/** Sidebar text, matching json-as's format:
 *  `<date> • v<version> • <engine> [ver] • <hash> • <branch>`.
 *  Best-effort - missing tokens (engine version / git) are silently dropped. */
export function subtitle() {
    const sh = (cmd) =>
        execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim();
    const tokens = [new Date().toDateString()];
    try {
        tokens.push(
            "v" +
                JSON.parse(
                    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
                ).version,
        );
    } catch {}
    // Engine token, mirroring json-as's "v8 <version>" but for the active runtime.
    let engine = RUNTIME;
    try {
        const m = sh(`${RUNTIME} --version`)
            .split("\n")[0]
            .match(/\d+\.\d+(?:\.\d+)?/);
        if (m) engine += " " + m[0];
    } catch {}
    tokens.push(engine);
    try {
        tokens.push(sh("git rev-parse --short HEAD"));
    } catch {}
    try {
        tokens.push(sh("git rev-parse --abbrev-ref HEAD"));
    } catch {}
    return tokens.join(" • ");
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
    const metric = opts.metric ?? "mbps";

    const datasets = seriesLabels.map((label, i) => {
        const { bg, border } = colorFor(i);
        return {
            label,
            data: groups.map((g) => data[g][label]?.[metric] ?? 0),
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
                    text: opts.subtitle ?? subtitle(),
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
    const abs = path.isAbsolute(outPath) ? outPath : path.join(ROOT, outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, getCanvas(width, height).renderToBufferSync(config));
    console.log("wrote", path.relative(ROOT, abs));
    return abs;
}

/** Append `-<runtime>` before the extension. `/x/chart.png` -> `/x/chart-v8.png`. */
export function withRuntime(outPath) {
    const ext = path.extname(outPath);
    return outPath.slice(0, -ext.length) + "-" + RUNTIME + ext;
}
