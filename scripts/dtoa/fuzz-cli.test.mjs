import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

for (const args of [
  ["--seed", "0"], ["--seed", "4294967296"], ["--seed", "-1"],
  ["--seed", "nope"], ["--seed", "1.5"], ["--seed"],
  ["--runs", "-1"], ["--runs", "0"], ["--runs", "NaN"],
  ["--time", "0"], ["--time", "Infinity"], ["--max-report", "-1"],
  ["--f64-only", "--f32-only"], ["--runs", "1", "--runs", "2"],
  ["--unknown"],
]) {
  test(`rejects ${args.join(" ")}`, () => {
    const result = spawnSync(process.execPath, ["scripts/dtoa/fuzz.mjs", ...args], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /invalid fuzz arguments:/);
    assert.doesNotMatch(result.stdout, /checks in/);
  });
}
