import fs from 'node:fs';
import os from 'node:os';
const paths=process.argv.slice(2);
if(paths.length!==2) throw Error('usage: node run.mjs main.wasm pr.wasm');
const modules=await Promise.all(paths.map(async path=>{
  const {instance}=await WebAssembly.instantiate(fs.readFileSync(path),{env:{abort:()=>{throw Error('abort')}}});
  return instance.exports;
}));
const f64={
  'zero-special':[0,-0,Infinity,-Infinity,NaN,0,-0,Infinity],
  'tiny-fixed':[1,-1,.5,-.5,10,100,1000,1e-6],
  'fixed-fractions':[.1,.2,.3,.30000000000000004,123456.789,43210.1,.0001220703125,Math.PI],
  'long-fixed':[999999999999999.9,123456789012345.67,9007199254740992,1e20,9e20,4503599627370497,-5942736479622170,5.444310685350916e14],
  'small-exponent':[1e-7,1e-12,1e-50,1e-100,2.9802322387695312e-8,6.62607015e-34,-1.2345678901234567e-123,2.2250738585072009e-308],
  'large-exponent':[1e21,1e22,1.5e21,3.439070283483335e35,1.3076622631878654e65,9.03725590277404e159,-1.2345678901234567e123,Number.MAX_VALUE],
  'subnormal-boundary':[5e-324,1e-323,1.2e-322,2.2250738585072014e-308,2.2250738585072009e-308,Number.MAX_VALUE,9007199254740993,.30000000000000004],
  randomish:[6.62607015e-34,5.444310685350916e14,3.439070283483335e35,.1,43210.1,-5942736479622170,2.2250738585072004e-308,.0001220703125,1.3076622631878654e65,9.03725590277404e159,.5,123456.789,-1.2345678901234567e123,2.9802322387695312e-8,Math.PI,.30000000000000004]
};
const f32={
  'zero-special':[0,-0,Infinity,-Infinity,NaN,0,-0,Infinity],
  'tiny-fixed':[1,-1,.5,-.5,10,100,1e-6,2.5],
  'fixed-fractions':[3.14159,.1,43210.1,1.25,-3.5,.0001,123.4567,-.0625],
  'small-exponent':[1e-7,1e-12,1e-20,6.62607e-34,2.9802322e-8,1.5e-45,7.0064923e-44,9.999999e-5],
  'large-exponent':[1e21,1e25,1e30,1e35,3.4028235e38,9.999999e9,1.342178e8,1.3421781e8],
  'subnormal-boundary':[1.401298464324817e-45,1.1754943508222875e-38,3.4028234663852886e38,16777216,8388608,9.999999e9,1.5e-45,7.0064923e-44],
  randomish:[6.62607e-34,1.342178e8,1.3421781e8,1,43210.1,.0001220703125,3.4028235e38,1.1754944e-38,.5,123456.78,2.9802322e-8,100,9.999999e-5,1.5e-45,7.0064923e-44,8388608]
};
const result={meta:{main:paths[0],pr:paths[1],node:process.version,v8:process.versions.v8,arch:os.arch(),cpu:os.cpus()[0]?.model,flags:'asc -O3 --enable simd --runtime incremental',method:'paired median of 11 trials; 1000000 buffered or 100000 allocating conversions per trial; identical xjb-as dtoa-comp/ftoa-comp buckets'},rows:{}};
for(const [kind,buckets,TypedArray] of [['f64',f64,Float64Array],['f32',f32,Float32Array]]){
  result.rows[kind]={};
  for(const [name,values] of Object.entries(buckets)){
    for(const m of modules) new TypedArray(m.memory.buffer,m.input(),values.length).set(values);
    const row={};
    for(const [mode,repsTotal] of [['Buffered',1000000],['Alloc',100000]]){
      const method='run'+(kind==='f64'?'64':'32')+mode;
      const reps=Math.max(1,Math.ceil(repsTotal/values.length));
      const warm=Math.max(1,Math.ceil(reps/2));
      for(const m of modules)m[method](m.input(),values.length,warm);
      const times=[[],[]],checks=[[],[]];
      for(let j=0;j<11;j++){
        for(const i of (j%2?[1,0]:[0,1])){
          const m=modules[i];
          const start=process.hrtime.bigint();
          const sum=m[method](m.input(),values.length,reps);
          times[i].push(Number(process.hrtime.bigint()-start)/(reps*values.length));
          checks[i].push(sum);
        }
      }
      if(checks.some(a=>a.some(v=>v!==a[0])))throw Error(`unstable checksum ${kind} ${name} ${mode}`);
      row[mode.toLowerCase()]={main:times[0].sort((a,b)=>a-b)[5],pr:times[1].sort((a,b)=>a-b)[5],mainChecksum:checks[0][0],prChecksum:checks[1][0]};
    }
    result.rows[kind][name]=row;
  }
}
console.log(JSON.stringify(result,null,2));
