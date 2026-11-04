import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
for(const args of [["invalid-count"],["-1"],["1.5"],["Infinity"],["9007199254740992"],[""],["1","extra"]]){
  test(`verify rejects ${JSON.stringify(args)} before loading Wasm`,()=>{
    const p=spawnSync(process.execPath,["scripts/dtoa/verify.mjs",...args],{encoding:"utf8"});
    assert.equal(p.status,2);assert.match(p.stderr,/invalid verify arguments/);assert.doesNotMatch(p.stdout,/edge cases|random:/);
  });
}
