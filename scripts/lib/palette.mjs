// Chart colour palette — ported from json-as/scripts/lib/palette.ts so the
// zmij-as charts match the json-as look. Single source of truth for every chart.
//
// Base palette:
//   jungle green #44AF69 · faded copper #9E7153 · strawberry red #F8333C
//   atomic tangerine #FA6F26 · orange #FCAB10 · palm leaf #94A562
//   pacific blue #2B9EB3 · muted teal #83BAB4 · sand dune #DBD5B5

export const BASE = {
    jungleGreen: "#44AF69",
    fadedCopper: "#9E7153",
    strawberryRed: "#F8333C",
    atomicTangerine: "#FA6F26",
    orange: "#FCAB10",
    palmLeaf: "#94A562",
    pacificBlue: "#2B9EB3",
    mutedTeal: "#83BAB4",
    sandDune: "#DBD5B5",
};

// RGB triples, for rgba() interpolation.
const RGB = {
    jungleGreen: "68,175,105",
    fadedCopper: "158,113,83",
    strawberryRed: "248,51,60",
    atomicTangerine: "250,111,38",
    orange: "252,171,16",
    palmLeaf: "148,165,98",
    pacificBlue: "43,158,179",
    mutedTeal: "131,186,180",
    sandDune: "219,213,181",
};

export const rgba = (name, alpha = 1) => `rgba(${RGB[name]},${alpha})`;

// Shared neutral inks (axis ticks/titles, subtitle sidebar, value labels, grid).
export const INK = {
    subtitle: "#6b7280",
    label: "#374151",
    grid: "rgba(0,0,0,0.08)",
};

// Ordered {bg, border} pairs for grouped-bar series. zmij paths come first, so
// "ours" lands on the cool hues (blue/green) and the stdlib baselines on the
// warm ones (red/orange) — same spirit as json-as's SIMD-gets-blue ordering.
export const BARS = [
    { bg: rgba("pacificBlue", 0.9), border: BASE.pacificBlue },
    { bg: rgba("jungleGreen", 0.85), border: BASE.jungleGreen },
    { bg: rgba("strawberryRed", 0.85), border: BASE.strawberryRed },
    { bg: rgba("orange", 0.85), border: BASE.orange },
    { bg: rgba("atomicTangerine", 0.85), border: BASE.atomicTangerine },
    { bg: rgba("mutedTeal", 0.85), border: BASE.mutedTeal },
];

// Overflow catch-all.
export const GRAY = { bg: rgba("fadedCopper", 0.85), border: BASE.fadedCopper };

// Stacked pipeline stages for dtoa-stages (bottom -> top).
export const STAGE_BARS = {
    core: { bg: rgba("pacificBlue", 0.9), border: BASE.pacificBlue },
    digits: { bg: rgba("jungleGreen", 0.85), border: BASE.jungleGreen },
    noallocRest: { bg: rgba("orange", 0.85), border: BASE.orange },
    stringOverhead: { bg: rgba("strawberryRed", 0.85), border: BASE.strawberryRed },
};
