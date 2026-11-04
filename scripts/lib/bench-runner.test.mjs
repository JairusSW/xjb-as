import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {test} from "node:test";

test("runner attaches measurement-time provenance to fake-clock V8 results",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"xjb-runner-"));
  const run=(cmd,args)=>{const p=spawnSync(cmd,args,{cwd:dir,encoding:"utf8",env:{...process.env,D8_BIN:path.join(dir,"fake-engine"),WASMTIME_BIN:path.join(dir,"fake-engine")}});assert.equal(p.status,0,p.stderr+p.stdout);return p;};
  try{
    for(const name of ["scripts/run-bench.sh","scripts/lib/bench-metadata.mjs","assembly/__benches__/lib/bench.ts"]){fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});fs.copyFileSync(name,path.join(dir,name));}
    fs.symlinkSync(path.resolve("node_modules"),path.join(dir,"node_modules"),"dir");
    fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({name:"runner-fixture",version:"1.2.3",type:"module"}));
    fs.writeFileSync(path.join(dir,".gitignore"),"build/\nnode_modules\n");
    fs.writeFileSync(path.join(dir,"assembly/__benches__/probe.bench.ts"),'import {bench,dumpToFile} from "./lib/bench"; function run():void{} bench("probe",run,1,5,2);dumpToFile("probe");');
    fs.writeFileSync(path.join(dir,"fake-engine"),`#!/usr/bin/env node
import fs from "node:fs";
import {WASI} from "node:wasi";
if(process.argv.includes("--version")){console.log("fixture-engine 1.0 (artificial clock)");process.exit(0);}
const isWasi=process.argv.includes("run"),bytes=fs.readFileSync(isWasi?process.argv.at(-1):"build/"+process.argv.at(-1));let e,tick=0;
const text=p=>String.fromCharCode(...new Uint16Array(e.memory.buffer,p,new DataView(e.memory.buffer).getUint32(p-4,true)/2));
if(isWasi){
 const wasi=new WASI({version:"preview1",args:[],env:{},returnOnExit:true});
 wasi.wasiImport.clock_time_get=(id,precision,p)=>{new DataView(e.memory.buffer).setBigUint64(p,BigInt(tick++)*1000000n,true);return 0;};
 const instance=new WebAssembly.Instance(new WebAssembly.Module(bytes),{wasi_snapshot_preview1:wasi.wasiImport});e=instance.exports;wasi.start(instance);
}else{
 e=new WebAssembly.Instance(new WebAssembly.Module(bytes),{env:{abort(){throw Error("abort")},"performance.now":()=>tick++,"console.log":p=>console.log(text(p))}}).exports;e.start();
}
`,{mode:0o755});
    run("git",["init","-q"]);run("git",["add","."]);run("git",["-c","user.name=Test","-c","user.email=test@example.com","commit","-qm","test: fixture"]);
    const head=run("git",["rev-parse","HEAD"]).stdout.trim();
    const command=run("bash",["scripts/run-bench.sh","--v8","--no-wasm-opt","probe"]);
    assert.ok(fs.existsSync(path.join(dir,"build/logs/as/v8/probe.as.json")),command.stderr+command.stdout);
    const r=JSON.parse(fs.readFileSync(path.join(dir,"build/logs/as/v8/probe.as.json")));
    assert.equal(r.operations,1);assert.equal(r.measurement.source.commit,head);assert.equal(r.measurement.source.dirty,false);
    assert.equal(r.measurement.runtime.version,"fixture-engine 1.0 (artificial clock)");assert.equal(r.measurement.optimizer.version,"disabled");
    assert.ok(r.measurement.compilerFlags.includes("-O3"));assert.ok(r.measurement.artifact.sha256);assert.ok(r.measurement.compiler.moduleSHA256);
    assert.ok(Number.isFinite(Date.parse(r.measurement.measuredAt)));
    run("bash",["scripts/run-bench.sh","--wasmtime","--no-wasm-opt","probe"]);
    const wasi=JSON.parse(fs.readFileSync(path.join(dir,"build/logs/as/wasmtime/probe.as.json")));
    assert.equal(wasi.runtime,"wasmtime");assert.equal(wasi.operations,1);
    assert.equal(wasi.measurement.runtime.name,"wasmtime");
    assert.ok(wasi.measurement.compilerFlags.includes("AS_BENCH_RUNTIME_WASMTIME=1"));
    fs.mkdirSync(path.join(dir,"build/stage"));
    fs.writeFileSync(path.join(dir,"build/stage/chart.png.measurement.json"),JSON.stringify({measurement:r.measurement}));
    run("node",["scripts/lib/bench-metadata.mjs","publish-check","build/stage"]);
    // Reusing A's results on B must fail before publication, not relabel A as B.
    fs.appendFileSync(path.join(dir,"assembly/__benches__/probe.bench.ts"),"\n// revision B\n");
    run("git",["add","."]);run("git",["-c","user.name=Test","-c","user.email=test@example.com","commit","-qm","test: revision B"]);
    const stale=spawnSync("node",["scripts/lib/bench-metadata.mjs","publish-check","build/stage"],{cwd:dir,encoding:"utf8"});
    assert.notEqual(stale.status,0);assert.match(stale.stderr,/matching the current source revision/);
    fs.writeFileSync(path.join(dir,"build/meta.json"),JSON.stringify(r.measurement));
    fs.writeFileSync(path.join(dir,"build/output.txt"),"");
    const changed=spawnSync("node",["scripts/lib/bench-metadata.mjs","finish","build/meta.json","build/output.txt"],{cwd:dir,encoding:"utf8"});
    assert.notEqual(changed.status,0);assert.match(changed.stderr,/Source changed during benchmark batch/);

  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
