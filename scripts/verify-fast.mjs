import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {launchBrowser,loadCurrentExtension} from './browser-runtime.mjs';
const kind=process.argv[2]||'chrome',live=process.argv.includes('--live'),nonce=crypto.randomBytes(5).toString('hex');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>公开快速翻译样本</title><style>body{font:18px/1.5 Arial;max-width:620px;margin:30px auto}p{display:block;margin:30px 0}</style></head><body><main><article data-testid="tweet"><p id="p0" data-testid="tweetText">Visible posts should remain readable while a translation is loading. Sample ${nonce}-0.</p><p id="p1" data-testid="tweetText">Keep <a href="#p0">this link</a> and <code>cacheKey</code> intact. Sample ${nonce}-1.</p><p id="p2" data-testid="tweetText">Reliable translation preserves numbers such as 25 and the original meaning. Sample ${nonce}-2.</p></article><div contenteditable="true" id="editor">Public editable test data must not be sent.</div></main></body></html>`;
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
let browser,workerSession,listener,failure=false,calls=0;const checks=[],pendingTasks=new Set(),network=[];
try{
 browser=await launchBrowser(kind,{profileName:`${kind}-qa-fast-${Date.now().toString(36)}`});const cdp=browser.cdp;
 const id=await loadCurrentExtension(cdp,path.resolve(process.env.CLEARLING_BUILD_DIR||'dist'));
 const options=await cdp.page(`chrome-extension://${id}/options.html`,{hidden:false});await cdp.wait(options,'!!document.querySelector("#reading-engine")');
 const rpc=m=>cdp.evaluate(options,`chrome.runtime.sendMessage(${JSON.stringify(m)})`,true);
 let state=await rpc({type:'GET_STATE'});assert.equal(state.settings.readingEngine,'bing');assert.equal(state.settings.hasKey,false);assert.equal(await cdp.evaluate(options,'document.querySelector("#setup-prompt").hidden'),true);
 const targets=await cdp.call('Target.getTargets');const worker=targets.targetInfos.find(t=>t.type==='service_worker'&&t.url.startsWith(`chrome-extension://${id}/`));assert.ok(worker);
 ({sessionId:workerSession}=await cdp.call('Target.attachToTarget',{targetId:worker.targetId,flatten:true}));await cdp.call('Network.enable',{},workerSession);
 if(!live)await cdp.call('Fetch.enable',{patterns:[{urlPattern:'https://edge.microsoft.com/translate/translatetext*',requestStage:'Request'}]},workerSession);
 listener=e=>{
  if(e.sessionId!==workerSession)return;
  if(e.method==='Network.responseReceived'&&e.params.response.url.startsWith('https://edge.microsoft.com/translate/translatetext'))network.push({status:e.params.response.status,requestId:e.params.requestId});
  if(e.method!=='Fetch.requestPaused')return;
  calls++;const data=JSON.parse(e.params.request.postData);assert.ok(Array.isArray(data));assert.ok(data.every(s=>!s.includes('editable test data')));
  const failed=failure,task=(async()=>{await new Promise(r=>setTimeout(r,500));const payload=failed?{}:data.map(text=>({translations:[{text:'公开测试中文译文。'+text}]}));await cdp.call('Fetch.fulfillRequest',{requestId:e.params.requestId,responseCode:failed?403:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'x-clearling-test-provider',value:'true'}],body:Buffer.from(JSON.stringify(payload)).toString('base64')},workerSession).catch(()=>{});})();pendingTasks.add(task);void task.finally(()=>pendingTasks.delete(task));
 };cdp.listeners.add(listener);
 const page=await cdp.page(origin,{hidden:false});await cdp.call('Emulation.setDeviceMetricsOverride',{width:1000,height:800,deviceScaleFactor:1,mobile:false},page.sessionId);
 const ready='document.querySelectorAll("[data-clearling=translation][data-phase=ready]").length===3';
 if(!live){await cdp.wait(page,'!!document.querySelector("[data-phase=pending]")');assert.equal(await cdp.evaluate(page,'getComputedStyle(document.querySelector("#p0")).display!=="none"'),true);checks.push('waiting preserves readable original');}
 await cdp.wait(page,ready,30000);assert.equal(await cdp.evaluate(page,'document.querySelector("#p0").hasAttribute("data-cl-source")'),true);
 assert.equal(await cdp.evaluate(page,'document.querySelector("#p1").nextElementSibling.querySelector("code").textContent'),'cacheKey');
 assert.equal(await cdp.evaluate(page,'document.querySelector("#p1").nextElementSibling.querySelector("a").href'),origin+'/#p0');
 assert.equal(await cdp.evaluate(page,'document.querySelector("#editor").querySelector("[data-clearling]")===null'),true);checks.push('no-key fast translation completes with protected link/code and editor exclusion');
 const before=live?network.length:calls;await cdp.call('Page.reload',{},page.sessionId);await cdp.wait(page,ready,10000);assert.equal(live?network.length:calls,before);checks.push('warm page uses cache without a new provider request');
 if(!live){
  await rpc({type:'CLEAR_CACHE'});failure=true;await cdp.call('Page.reload',{},page.sessionId);await cdp.wait(page,'!!document.querySelector("[data-phase=failed]")',10000);assert.equal(await cdp.evaluate(page,'getComputedStyle(document.querySelector("#p0")).display!=="none"'),true);checks.push('provider failure keeps original readable');
  const model=state.settings.selection.modelId;state=await rpc({type:'GET_STATE'});state=await rpc({type:'SET_READING_ENGINE',engine:'ai',expectedRevision:state.settings.revision});assert.equal(state.settings.selection.modelId,model);assert.equal(state.settings.hasKey,false);
  const start=calls;await cdp.call('Page.reload',{},page.sessionId);await new Promise(r=>setTimeout(r,300));assert.equal(calls,start);assert.equal(await cdp.evaluate(options,'!document.querySelector("#setup-prompt").hidden'),true);checks.push('unconfigured AI pauses translation and preserves model selection');
  failure=false;state=await rpc({type:'SET_READING_ENGINE',engine:'bing',expectedRevision:state.settings.revision});await cdp.wait(page,ready,10000);checks.push('explicit switch resumes a paused fast provider');
 }
 const report={version:await cdp.evaluate(options,'chrome.runtime.getManifest().version'),browser:kind,realMV3:true,readingEngine:'bing',hasKey:false,syntheticOnly:!live,publicInputsOnly:true,checks,providerRequests:live?network.length:calls,network,time:new Date().toISOString()};
 await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/fast-${kind}-${live?'live':'synthetic'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser){if(listener)browser.cdp.listeners.delete(listener);await Promise.allSettled([...pendingTasks]);await browser.cdp.call('Browser.close').catch(()=>{});browser.cdp.close();}server.closeAllConnections();server.close();}
