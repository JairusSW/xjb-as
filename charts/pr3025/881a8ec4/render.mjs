import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.XJB_AS_ROOT ?? process.cwd();
const {createBarChart,generateChart,fmtNs1}=await import(pathToFileURL(path.join(root,'scripts/lib/bench-chart.mjs')));
const results=JSON.parse(fs.readFileSync(path.join(dir,'results.json'),'utf8'));
const subtitle='AMD 7800X3D • V8 13.6 • 2026-09-21';
for(const kind of ['f64','f32'])for(const mode of ['buffered','alloc']){
  const data={};
  for(const [name,row] of Object.entries(results.rows[kind]))data[name.replaceAll('-',' ')]={
    'main (Grisu2)':{nsPerOp:row[mode].main},
    'PR #3025 (xjb)':{nsPerOp:row[mode].pr},
  };
  const config=createBarChart(data,{metric:'nsPerOp',title:`${kind} to string: ${mode==='buffered'?'buffered UTF-16':'string allocation'}`,subtitle,yLabel:'ns per conversion (lower is better)',xRotation:30,labelFormatter:fmtNs1});
  config.options.plugins.datalabels.align='end';
  config.options.plugins.datalabels.color='#374151';
  config.options.plugins.datalabels.offset=2;
  config.plugins.unshift({id:'whiteBackground',beforeDraw(chart){const {ctx,width,height}=chart;ctx.save();ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.restore();}});
  generateChart(config,path.join(dir,`${kind}-${mode}-v8.png`),{width:1600,height:800});
}
