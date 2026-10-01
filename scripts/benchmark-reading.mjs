import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {launchBrowser,loadCurrentExtension} from './browser-runtime.mjs';
const kind=process.argv[2]||'chrome',extension=path.resolve(process.argv[3]||'dist');
const trials=Number(process.env.CLEARLING_BENCH_TRIALS||20),label=process.argv[4]||'current';
const server=spawn(process.execPath,['scripts/fixture-server.mjs'],{env:{...process.env,CLEARLING_FIXTURE_PORT:'0',CLEARLING_FIXTURE_CHINESE:'1'},stdio:['ignore','pipe','inherit']});
const origin=await new Promise(resolve=>{const reader=createInterface({input:server.stdout});reader.once('line',s=>{reader.close();resolve(JSON.parse(s).url);});});
let browser,options;const results=[];
try {
 browser=await launchBrowser(kind,{profileName:`${kind}-qa-bench-${label}`});const cdp=browser.cdp;
 const id=await loadCurrentExtension(cdp,extension);options=await cdp.page(`chrome-extension://${id}/options.html`,{hidden:false});await cdp.wait(options,'document.querySelector("#model")?.options.length>0');
 const rpc=m=>cdp.evaluate(options,`chrome.runtime.sendMessage(${JSON.stringify(m)})`,true);
 let state=await rpc({type:'GET_STATE'});if(state.settings.hasKey)throw new Error('QA_PROFILE_HAS_EXISTING_CONNECTION');
 state=await rpc({type:'SAVE_CONNECTION',endpoint:origin,apiKey:'fixture',connectionKind:'cindy',expectedRevision:state.settings.revision});
 // Both old and new use bilingual for the self-baseline comparison; old has no pure mode.
 if(state.settings.displayMode)state=await rpc({type:'SET_DISPLAY_MODE',mode:'bilingual',expectedPresentationRevision:state.settings.presentationRevision});
 const page=await cdp.page('about:blank',{hidden:false});await cdp.call('Emulation.setDeviceMetricsOverride',{width:1000,height:800,deviceScaleFactor:1,mobile:false},page.sessionId);
 const run=async(trace,trial,cache)=>{
   const calls=await fetch(`${origin}/metrics`).then(r=>r.json()).then(v=>v.calls);
   await cdp.call('Page.navigate',{url:`${origin}/scroll?trial=${trace}-${trial}`},page.sessionId);await cdp.wait(page,'!!document.querySelector("#row-11")');
   return cdp.evaluate(page,`(async()=>{
    const samples=new Map(),arrivals=new Map(),tasks=[];let observing=true;
    const ready=s=>{const n=s.nextElementSibling;return n?.matches('[data-clearling="translation"]') && (!n.dataset.phase || n.dataset.phase==='ready')};
    const sample=()=>{for(const source of document.querySelectorAll('[data-testid="tweetText"]')){const r=source.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight&&!arrivals.has(source.id)){arrivals.set(source.id,performance.now());if(ready(source))samples.set(source.id,0);}if(arrivals.has(source.id)&&!samples.has(source.id)&&ready(source))samples.set(source.id,performance.now()-arrivals.get(source.id));}};
    const timer=setInterval(sample,8);const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});
    const trace=${JSON.stringify(trace)};const offsets=trace==='jump'?[0,1700,450,1700]:[0,450,900,1350,1700];const pause=trace==='slow'?200:trace==='fast'?50:70;
    for(const y of offsets){scrollTo(0,y);sample();await new Promise(r=>setTimeout(r,pause));}
    const finalVisible=[...document.querySelectorAll('[data-testid="tweetText"]')].filter(s=>{const r=s.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight});
    const stop=performance.now();while(finalVisible.some(s=>!ready(s))&&performance.now()-stop<6000)await new Promise(r=>setTimeout(r,20));
    clearInterval(timer);sample();observer.disconnect();return {latencies:[...samples.values()],seen:arrivals.size,translated:samples.size,abandonedOffscreen:arrivals.size-samples.size,finalVisible:finalVisible.length,finalMissing:finalVisible.filter(s=>!ready(s)).length,longTasks:tasks,stopToCompleteMs:performance.now()-stop,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1};
   })()`,true).then(async values=>({...values,trace,trial,cache,apiCalls:(await fetch(`${origin}/metrics`).then(r=>r.json())).calls-calls}));
 };
 for(let trial=0;trial<trials;trial++) {
   for(const trace of ['slow','fast','jump']) {
     await rpc({type:'CLEAR_CACHE'});results.push(await run(trace,trial,'cold'));
     // Visit the exact same public fixture without clearing its translation cache.
     results.push(await run(trace,trial,'warm'));
   }
   if((trial+1)%5===0)console.log(JSON.stringify({progress:trial+1,trials,label,browser:kind}));
 }
 const percentile=(values,q)=>{const s=values.slice().sort((a,b)=>a-b);return Math.round(s[Math.min(s.length-1,Math.max(0,Math.ceil(s.length*q)-1))]||0);};
 const groups=[];
 for(const trace of ['slow','fast','jump'])for(const cache of ['cold','warm']){const rows=results.filter(r=>r.trace===trace&&r.cache===cache);const times=rows.flatMap(r=>r.latencies);groups.push({trace,cache,runs:rows.length,samples:times.length,p50:percentile(times,.5),p95:percentile(times,.95),seen:rows.reduce((n,r)=>n+r.seen,0),translated:rows.reduce((n,r)=>n+r.translated,0),apiCalls:rows.reduce((n,r)=>n+r.apiCalls,0),finalMissing:rows.reduce((n,r)=>n+r.finalMissing,0),abandonedOffscreen:rows.reduce((n,r)=>n+r.abandonedOffscreen,0),maxLongTaskMs:Math.round(Math.max(0,...rows.flatMap(r=>r.longTasks))),overflow:rows.some(r=>r.horizontalOverflow)});}
 const report={version:await cdp.evaluate(options,'chrome.runtime.getManifest().version'),browser:kind,label,syntheticOnly:true,mode:'bilingual',providerDelayMs:35,notes:'Public fixed-height fixture; measures client scheduling, not model speed or Immersive Translate superiority. Ready-before-entry counts as zero. Warm entries not seen during cold navigation may still miss cache. Latency includes completed samples only; abandonedOffscreen is reported separately. finalMissing must be zero. Long tasks include the entire page, not just the extension.',groups,results,time:new Date().toISOString()};
 await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/benchmark-${kind}-${label}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({version:report.version,browser:kind,label,groups}));
}finally{
 if(browser&&options)await browser.cdp.evaluate(options,'(async()=>{const s=await chrome.runtime.sendMessage({type:"GET_STATE"});if(s.settings?.hasKey)await chrome.runtime.sendMessage({type:"CLEAR_CONNECTION",expectedRevision:s.settings.revision});await chrome.runtime.sendMessage({type:"CLEAR_CACHE"})})()',true).catch(()=>{});
 if(browser){await browser.cdp.call('Browser.close').catch(()=>{});browser.cdp.close();}server.kill('SIGTERM');
}
