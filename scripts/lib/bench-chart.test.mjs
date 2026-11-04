import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { groupIdentity, validatePublication } from "./bench-metadata.mjs";

function metadata(overrides = {}) {
  const m = {
    schemaVersion: 1, runId: "test-run", source: {commit:"a".repeat(40), branch:"main", dirty:false, fingerprint:"saved-tree"},
    packageVersion:"0.1.0", compiler:{version:"Version 0.28.20"}, runtime:{name:"wasmtime", version:"wasmtime saved-version"},
    compilerFlags:["-O3"], optimizer:{version:"disabled",flags:[]}, runtimeFlags:[], machine:{hostname:"recorded-host",arch:"arm64",cpu:"recorded CPU"},
    measuredAt:"2026-01-02T03:04:05Z", artifact:{sha256:"saved-module"}, ...overrides,
  };
  m.group = groupIdentity(m);
  return m;
}
const row = (measurement) => ({benchmarkSchemaVersion:3, runtime:"wasmtime", nsPerOp:5, opsPerSecond:2e8, mbps:100, bytes:10, elapsed:1000, operations:200000000, measurement});
const moduleFor = async () => {
  process.env.BENCH_CHART_RUNTIME = "wasmtime";
  return import(`./bench-chart.mjs?test=${crypto.randomUUID()}`);
};

test("missing points fail by default; explicitly incomplete charts retain null", async () => {
  const {createBarChart} = await moduleFor();
  const data = {a:{xjb:{nsPerOp:5},stdlib:{nsPerOp:10}},b:{stdlib:{nsPerOp:12}}};
  assert.throws(() => createBarChart(data,{metric:"nsPerOp",subtitle:"fixture"}),/Missing series xjb/);
  const config = createBarChart(data,{metric:"nsPerOp",subtitle:"fixture",allowIncomplete:true});
  assert.deepEqual(config.data.datasets[0].data,[5,null]);
  assert.match(config.options.plugins.subtitle.text,/incomplete/);
  for (const value of [NaN,Infinity,-1,undefined]) assert.throws(() => createBarChart({a:{xjb:{nsPerOp:value}}},{metric:"nsPerOp",subtitle:"fixture"}),/Invalid/);
});

test("saved metadata labels charts; missing, outdated, mixed or invalid results fail", async () => {
  const {readBenchFile,subtitle,RUNTIME,withRuntime} = await moduleFor();
  assert.equal(RUNTIME,"wasmtime"); assert.equal(withRuntime("example.png"),"example-wasmtime.png");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"xjb-charts-")), filename=path.join(dir,"result.json");
  try {
    assert.throws(()=>readBenchFile(filename),/Missing benchmark/);
    fs.writeFileSync(filename,JSON.stringify(row(metadata())));readBenchFile(filename);
    assert.match(subtitle(),/2026-01-02.*wasmtime saved-version.*aaaaaaa.*recorded CPU/);
    fs.writeFileSync(filename,JSON.stringify(row(metadata({runId:"other"}))));
    assert.throws(()=>readBenchFile(filename),/Mixed measurement/);
    fs.writeFileSync(filename,JSON.stringify({...row(metadata()),nsPerOp:null}));
    assert.throws(()=>readBenchFile(filename),/Invalid nsPerOp/);
    fs.writeFileSync(filename,JSON.stringify({...row(metadata()),measurement:undefined}));
    assert.throws(()=>readBenchFile(filename),/metadata/);
    fs.writeFileSync(filename,JSON.stringify({...row(metadata()),benchmarkSchemaVersion:2}));
    assert.throws(()=>readBenchFile(filename),/Outdated/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test("publication rejects another revision, dirty measurements and mixed runs", () => {
  const m=metadata(), manifest={measurement:m};
  assert.equal(validatePublication([manifest],m.source),m);
  assert.throws(()=>validatePublication([manifest],{...m.source,commit:"b".repeat(40)}),/matching/);
  assert.throws(()=>validatePublication([manifest],{...m.source,dirty:true}),/clean/);
  const dirty=metadata({source:{...m.source,dirty:true}});
  assert.throws(()=>validatePublication([{measurement:dirty}],dirty.source),/clean/);
  assert.throws(()=>validatePublication([manifest,{measurement:metadata({runId:"other"})}],m.source),/Mixed/);
});

test("all runtime selectors route wasmtime and llvm, reject unknown values", () => {
  for (const [input,expected] of [["wasmtime","wasmtime"],["llvm","wavm"],["no-such-runtime",null]]) {
    const p=spawnSync(process.execPath,["--input-type=module","-e",'import {RUNTIME} from "./scripts/lib/bench-chart.mjs";console.log(RUNTIME)'],{encoding:"utf8",env:{...process.env,BENCH_CHART_RUNTIME:input}});
    if(expected){assert.equal(p.status,0,p.stderr);assert.equal(p.stdout.trim(),expected);}
    else {assert.notEqual(p.status,0);assert.match(p.stderr,/Unknown chart runtime/);}
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"xjb-route-"));
  try {
    fs.mkdirSync(path.join(dir,"scripts/charts"),{recursive:true});
    fs.copyFileSync("scripts/build-charts.sh",path.join(dir,"scripts/build-charts.sh"));
    fs.writeFileSync(path.join(dir,"scripts/charts/probe.mjs"),'console.log("selected="+process.env.BENCH_CHART_RUNTIME)');
    for(const [flag,expected] of [["--wasmtime","wasmtime"],["--llvm","wavm"]]){
      const p=spawnSync("bash",[path.join(dir,"scripts/build-charts.sh"),flag,"probe"],{encoding:"utf8"});
      assert.equal(p.status,0,p.stderr);assert.match(p.stdout,new RegExp("selected="+expected));
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test("unsupported memory runtimes fail before compilation or engine lookup", () => {
  for(const runtime of ["stub","minimal","custom-runtime"]){
    const p=spawnSync("bash",["scripts/run-bench.sh","--runtime",runtime,"--memory"],{encoding:"utf8"});
    assert.notEqual(p.status,0);assert.match(p.stderr,/--memory requires --runtime incremental/);
  }
});

test("every chart renders complete Wasmtime fixtures into fresh staging only",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"xjb-render-")),logs=path.join(dir,"logs/wasmtime"),stage=path.join(dir,"stage");
  fs.mkdirSync(logs,{recursive:true});fs.mkdirSync(stage);
  const buckets64=["zero-special","tiny-fixed","fixed-fractions","long-fixed","small-exponent","large-exponent","subnormal-boundary","randomish"],buckets32=buckets64.filter(s=>s!=="long-fixed");
  const m=metadata();
  const write=stem=>fs.writeFileSync(path.join(logs,stem+".as.json"),JSON.stringify({...row(m),description:stem}));
  for(const [prefix,buckets] of [["dtoa-comp",buckets64],["ftoa-comp",buckets32]])for(const bucket of buckets)for(const impl of ["xjb","stdlib"])for(const api of ["alloc","noalloc"])write(`${prefix}-${bucket}-${impl}-${api}`);
  for(const [prefix,buckets] of [["dtoa-stages",buckets64],["ftoa-stages",buckets32]])for(const bucket of buckets)for(const api of ["core","digits","buffered","string"])write(`${prefix}-${bucket}-${api}`);
  try{
    const p=spawnSync("bash",["scripts/build-charts.sh","--wasmtime"],{encoding:"utf8",env:{...process.env,BENCH_CHART_LOGS_DIR:path.join(dir,"logs"),BENCH_CHART_OUTPUT_DIR:stage}});
    assert.equal(p.status,0,p.stderr+p.stdout);
    const pngs=fs.readdirSync(stage).filter(n=>n.endsWith(".png"));assert.equal(pngs.length,7);
    for(const png of pngs){assert.match(png,/-wasmtime\.png$/);const manifest=JSON.parse(fs.readFileSync(path.join(stage,png+".measurement.json")));assert.equal(manifest.measurement.group,m.group);assert.ok(manifest.inputs.length>0);}
    fs.rmSync(path.join(logs,"dtoa-comp-tiny-fixed-xjb-alloc.as.json"));
    const missing=spawnSync("bash",["scripts/build-charts.sh","--wasmtime","dtoa-comp"],{encoding:"utf8",env:{...process.env,BENCH_CHART_LOGS_DIR:path.join(dir,"logs"),BENCH_CHART_OUTPUT_DIR:stage}});
    assert.notEqual(missing.status,0);assert.match(missing.stderr,/Missing benchmark result/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("publisher normalizes llvm and stages only newly rendered files",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"xjb-publish-"));
  const run=(cmd,args)=>spawnSync(cmd,args,{cwd:dir,encoding:"utf8"});
  try{
    fs.mkdirSync(path.join(dir,"scripts/lib"),{recursive:true});fs.mkdirSync(path.join(dir,"charts"));
    fs.copyFileSync("scripts/publish-charts.sh",path.join(dir,"scripts/publish-charts.sh"));
    fs.writeFileSync(path.join(dir,"package.json"),'{"version":"1.0.0"}');
    fs.writeFileSync(path.join(dir,"charts/stale-v8.png"),"stale");
    fs.writeFileSync(path.join(dir,"scripts/build-charts.sh"),'set -eu\nprintf "selected=%s\\n" "$1"\ntest -n "$BENCH_CHART_OUTPUT_DIR"\nprintf fresh > "$BENCH_CHART_OUTPUT_DIR/fresh-wavm.png"\n');
    // Stop at the pre-publication gate. This fixture cannot contact a remote.
    fs.writeFileSync(path.join(dir,"scripts/lib/bench-metadata.mjs"),'import fs from "node:fs";console.error("staged="+fs.readdirSync(process.argv[3]).join(","));process.exit(1);');
    assert.equal(run("git",["init","-q"]).status,0);assert.equal(run("git",["add","."]).status,0);
    assert.equal(run("git",["-c","user.name=Test","-c","user.email=test@example.com","commit","-qm","test: fixture"]).status,0);
    const p=run("bash",["scripts/publish-charts.sh","--no-run","--llvm"]);
    assert.notEqual(p.status,0);assert.match(p.stdout,/selected=--wavm/);assert.match(p.stderr,/staged=fresh-wavm\.png/);assert.doesNotMatch(p.stderr,/staged=.*stale-v8/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
