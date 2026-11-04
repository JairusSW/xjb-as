// Host-side measurement provenance. The runner calls begin before compiling and
// finish after executing; source changes during a batch invalidate its results.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(import.meta.dirname, "../..");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
export function sourceSnapshot() {
  const files = git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean).sort();
  const digest = crypto.createHash("sha256");
  for (const name of files) {
    const full = path.join(ROOT, name);
    digest.update(name + "\0");
    if (fs.existsSync(full) && fs.statSync(full).isFile()) digest.update(fs.readFileSync(full));
    else if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      // Include the actual checked-out submodule revision and local changes.
      digest.update(execFileSync("git", ["-C", full, "rev-parse", "HEAD"]));
      digest.update(execFileSync("git", ["-C", full, "diff", "--binary", "HEAD"]));
    } else digest.update("<missing>");
    digest.update("\0");
  }
  return {
    commit: git("rev-parse", "HEAD").trim(),
    branch: git("rev-parse", "--abbrev-ref", "HEAD").trim(),
    dirty: git("status", "--porcelain").length > 0,
    fingerprint: digest.digest("hex"),
  };
}
const version = (binary, args = ["--version"]) => execFileSync(binary, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
export function groupIdentity(m) {
  return hash(JSON.stringify([m.runId, m.source, m.packageVersion, m.compiler, m.runtime, m.compilerFlags, m.optimizer, m.runtimeFlags, m.machine]));
}
export function validateMetadata(m) {
  if (!m || m.schemaVersion !== 1 || !m.source?.commit || typeof m.source.dirty !== "boolean" ||
      !m.source.fingerprint || !m.runId || !m.compiler?.version || !m.runtime?.version ||
      !m.machine?.hostname || !m.measuredAt || !Number.isFinite(Date.parse(m.measuredAt)) ||
      !Array.isArray(m.compilerFlags) || !Array.isArray(m.runtimeFlags) ||
      !Array.isArray(m.optimizer?.flags) || !m.artifact?.sha256 || !m.group || groupIdentity(m) !== m.group)
    throw new Error("Missing or invalid measurement metadata; rerun benchmarks with scripts/run-bench.sh.");
  return m;
}
export function validatePublication(manifests, current = sourceSnapshot()) {
  if (!manifests.length) throw new Error("No chart manifests to publish");
  const groups = new Map();
  for (const manifest of manifests) {
    const m = validateMetadata(manifest.measurement);
    if (m.source.dirty || current.dirty || m.source.commit !== current.commit || m.source.fingerprint !== current.fingerprint)
      throw new Error("Publication requires clean measurements matching the current source revision; rerun benchmarks on a clean checkout.");
    if (groups.has(m.runtime.name) && groups.get(m.runtime.name) !== m.group)
      throw new Error("Mixed measurement runs for " + m.runtime.name);
    groups.set(m.runtime.name, m.group);
  }
  return manifests[0].measurement;
}

function main([command, metaFile, ...args]) {
  if (command === "begin") {
    const [runId, runtime, binary, entry, artifact, ...flags] = args;
    const sections = { compiler: [], optimizer: [], runtime: [] };
    let section;
    for (const flag of flags) {
      if (["--compiler-flags", "--optimizer-flags", "--runtime-flags"].includes(flag)) section = flag.slice(2).replace("-flags", "");
      else if (section) sections[section].push(flag);
      else throw new Error("Expected flag section");
    }
    const compilerPath = fs.realpathSync(process.env.ASC_BIN ?? path.join(ROOT, "node_modules/assemblyscript/bin/asc.js"));
    const m = {
      schemaVersion: 1, runId, source: sourceSnapshot(),
      packageVersion: JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"))).version,
      compiler: {
        version: version(process.execPath, [compilerPath, "--version"]),
        moduleSHA256: hash(fs.readFileSync(path.resolve(path.dirname(compilerPath), "../dist/asc.js"))),
      },
      runtime: { name: runtime, binary, version: version(binary, [runtime === "wavm" || runtime === "wazero" ? "version" : "--version"]) },
      compilerFlags: sections.compiler,
      optimizer: { version: sections.optimizer.length ? version("wasm-opt") : "disabled", flags: sections.optimizer },
      runtimeFlags: sections.runtime,
      machine: { hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model },
      buildStartedAt: new Date().toISOString(), entry, artifact: { path: artifact },
    };
    fs.writeFileSync(metaFile, JSON.stringify(m));
  } else if (command === "finish") {
    const m = JSON.parse(fs.readFileSync(metaFile));
    if (JSON.stringify(sourceSnapshot()) !== JSON.stringify(m.source)) throw new Error("Source changed during benchmark batch; results rejected");
    m.finishedAt = new Date().toISOString();
    m.measuredAt = m.measurementStartedAt;
    m.artifact.sha256 = hash(fs.readFileSync(m.artifact.path));
    m.group = groupIdentity(m);
    validateMetadata(m);
    const records = [];
    for (const line of fs.readFileSync(args[0], "utf8").split(/\r?\n/)) {
      if (!line.startsWith("__AS_BENCH_JSON__")) { if (line) console.log(line); continue; }
      const payload = line.slice("__AS_BENCH_JSON__".length), tab = payload.indexOf("\t");
      if (tab < 0) throw new Error("Malformed benchmark output");
      const filename = path.resolve(ROOT, payload.slice(0, tab));
      const result = JSON.parse(payload.slice(tab + 1));
      if (path.dirname(filename) !== path.join(ROOT, "build/logs/as", m.runtime.name) || result.runtime !== m.runtime.name)
        throw new Error("Benchmark output runtime/path mismatch");
      for (const metric of ["elapsed", "operations", "nsPerOp", "opsPerSecond", "mbps", "bytes"])
        if (!Number.isFinite(result[metric]) || result[metric] < 0 || (["elapsed", "operations", "nsPerOp", "opsPerSecond"].includes(metric) && result[metric] === 0))
          throw new Error("Invalid measurement: " + metric);
      records.push([filename, { ...result, measurement: m }]);
    }
    if (!records.length) throw new Error("No benchmark results produced");
    for (const [filename, result] of records) {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename + ".tmp", JSON.stringify(result));
      fs.renameSync(filename + ".tmp", filename);
    }
  } else if (command === "start") {
    const m = JSON.parse(fs.readFileSync(metaFile));
    m.measurementStartedAt = new Date().toISOString();
    fs.writeFileSync(metaFile, JSON.stringify(m));
  } else if (command === "publish-check") {
    const manifests = fs.readdirSync(metaFile).filter(n => n.endsWith(".measurement.json")).map(n => JSON.parse(fs.readFileSync(path.join(metaFile, n))));
    const measurement = validatePublication(manifests);
    console.log(JSON.stringify({ source: measurement.source, packageVersion: measurement.packageVersion }));
  } else throw new Error("Unknown metadata command: " + command);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
