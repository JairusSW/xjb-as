// Correctness-only benchmark execution with an artificial clock; these tests do
// not measure performance. They exercise the same setup and serialization code.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import asc from "assemblyscript/asc";
import { test } from "node:test";

async function execute(entry, {simd=false, runtime="incremental", memory=false, retainedFailure=false}={}) {
  const output=new Map(), stderr=asc.createMemoryStream();
  const result=await asc.main([entry,"-O3","--noAssert","--runtime",runtime,"--exportStart","start","-o","test.wasm",
    ...(simd?["--enable","simd"]:[]),...(memory?["--use","BENCH_TRACK_MEMORY=1","--transform","./node_modules/as-heap-analyzer/transform/addHeapAnalyzerInfo.mjs"]:[])], {
    stderr, readFile(name,base) {
      let s;try{s=fs.readFileSync(path.resolve(base,name),"utf8");}catch{return null;}
      if(name.endsWith("lib/bench.ts")){
        s=s.replace("minMs: f64 = 1000","minMs: f64 = 2");
        if(retainedFailure) s="let analyzerCalls: i32 = 0;\n"+s.replace("const used = getUsedMemorySize();","const used = analyzerCalls++ == 0 ? getUsedMemorySize() : u32.MAX_VALUE;");
      }
      if(name.endsWith(".bench.ts"))s=s.replaceAll("100_000","1");
      return s;
    }, writeFile:(name,data)=>output.set(name,data),
  });
  if(result.error)throw new Error(stderr.toString(),{cause:result.error});
  let e,tick=0;const rows=[];
  const text=p=>String.fromCharCode(...new Uint16Array(e.memory.buffer,p,new DataView(e.memory.buffer).getUint32(p-4,true)/2));
  const env=new Proxy({
    abort(a,b,l,c){throw new Error(`${text(a)} (${text(b)}:${l}:${c})`);},
    "performance.now":()=>tick++,
    "console.log"(p){const s=text(p);if(s.startsWith("__AS_BENCH_JSON__"))rows.push(JSON.parse(s.slice(s.indexOf("\t")+1)));},
  },{get:(o,k)=>o[k]??(()=>0)});
  e=new WebAssembly.Instance(new WebAssembly.Module(output.get("test.wasm")),{env}).exports;
  e.start();return rows;
}

for(const simd of [false,true])for(const [stem,expected] of [["dtoa",{tiny:[27,37],zero:[32,40],long:[143,153]}],["ftoa",{tiny:[26,34],large:[61,67],random:[133,143]}]]){
  test(`${stem} ${simd?"SIMD":"scalar"} accounts for each implementation's actual output`,async()=>{
    const rows=await execute(`assembly/__benches__/${stem}-comp.bench.ts`,{simd});
    const find=(bucket,suffix)=>rows.find(r=>r.description===`${stem}-comp-${bucket}-${suffix}`);
    for(const bucket of [...new Set(rows.map(r=>r.description.replace(`${stem}-comp-`,"").replace(/-(xjb|zmij|stdlib)-(noalloc|alloc)$/, "")))]){
      for(const impl of ["xjb","zmij","stdlib"]){assert.equal(find(bucket,`${impl}-alloc`).bytes,find(bucket,`${impl}-noalloc`).bytes);}
    }
    for(const [key,bucket] of [["tiny","tiny-fixed"],["zero","zero-special"],["long","long-fixed"],["large","large-exponent"],["random","randomish"]])if(expected[key]){
      assert.equal(find(bucket,"xjb-noalloc").bytes,expected[key][0]);
      assert.equal(find(bucket,"zmij-noalloc").bytes,expected[key][0]);
      assert.equal(find(bucket,"stdlib-noalloc").bytes,expected[key][1]);
    }
    for(const r of rows){assert.equal(r.operations,1);assert.equal(r.benchmarkSchemaVersion,3);assert.equal(r.mbps,r.bytes/(r.elapsed/1000)/1e6);}
  });
}

test("heap measurement rejects the stub sentinel and retained-snapshot failures",async()=>{
  // Keep this fixture next to the existing benchmark so module paths and the
  // production benchmark harness are used unchanged.
  const fixture="build/heap-test.bench.ts";
  fs.mkdirSync("build",{recursive:true});
  fs.writeFileSync(fixture,'import {bench,dumpToFile} from "../assembly/__benches__/lib/bench"; function noAllocation():void{} bench("heap-test",noAllocation,1,0,2);dumpToFile("heap-test");');
  try{
    await assert.rejects(execute(fixture,{memory:true,runtime:"stub"}),/Heap analyzer failed/);
    await assert.rejects(execute(fixture,{memory:true,retainedFailure:true}),/Heap analyzer failed/);
    const [r]=await execute(fixture,{memory:true});
    assert.ok(r.memoryBaselineBytes>0 && r.memoryBaselineBytes<r.memoryLinearBaselineBytes);
    assert.equal(r.memoryLinearGrowthBytes,0);assert.equal(r.memoryRetainedBytes,r.memoryBaselineBytes);
  }finally{fs.rmSync(fixture,{force:true});}
});
