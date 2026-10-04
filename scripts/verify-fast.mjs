import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {launchBrowser,loadCurrentExtension} from './browser-runtime.mjs';
const kind=process.argv[2]||'chrome',live=process.argv.includes('--live'),generic=process.argv.includes('--generic'),dense=process.argv.includes('--dense'),nonce=crypto.randomBytes(5).toString('hex');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>公开快速翻译样本</title><style>body{font:18px/1.5 Arial;max-width:620px;margin:30px auto}p{display:block;margin:30px 0}</style></head><body><main><article data-testid="tweet"><p id="p0" data-testid="tweetText">Visible posts should remain readable while a translation is loading. Sample ${nonce}-0.</p><p id="p1" data-testid="tweetText">Keep <a href="#p0">this link</a> and <code>cacheKey</code> intact. Sample ${nonce}-1.</p><p id="p2" data-testid="tweetText">Reliable translation preserves numbers such as 25 and the original meaning. Sample ${nonce}-2.</p></article><div contenteditable="true" id="editor">Public editable test data must not be sent.</div></main></body></html>`;
let pageHtml=generic?html.replaceAll(' data-testid="tweet"','').replaceAll(' data-testid="tweetText"','').replace('Visible posts should remain readable','Visible <span style="font-style:italic">posts should remain readable</span>'):html;
if(dense)pageHtml=pageHtml.replace(/<p id="p0"[^>]*>.*?<\/p>/,`<p id="p0">${Array.from({length:9},(_,i)=>`<span>Public formatted phrase ${i}</span>`).join(' ')}</p>`);
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(pageHtml);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
let browser,workerSession,listener,failure=false,calls=0,denseWhole=0,denseFragments=0;const checks=[],pendingTasks=new Set(),network=[];
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
  for(const text of data)if(text.includes('Public formatted phrase')){if((text.match(/⟦CLR/g)||[]).length>16)denseWhole++;else denseFragments++;}
  const failed=failure,task=(async()=>{await new Promise(r=>setTimeout(r,500));const payload=failed?{}:data.map(text=>({translations:[{text:dense&&(text.match(/⟦CLR/g)||[]).length>16?'故意丢失格式标记的测试结果。':'公开测试中文译文。'+text}]}));await cdp.call('Fetch.fulfillRequest',{requestId:e.params.requestId,responseCode:failed?403:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'x-clearling-test-provider',value:'true'}],body:Buffer.from(JSON.stringify(payload)).toString('base64')},workerSession).catch(()=>{});})();pendingTasks.add(task);void task.finally(()=>pendingTasks.delete(task));
 };cdp.listeners.add(listener);
 const page=await cdp.page(origin,{hidden:false});await cdp.call('Emulation.setDeviceMetricsOverride',{width:1000,height:800,deviceScaleFactor:1,mobile:false},page.sessionId);
 const ready=generic?'document.querySelectorAll("[data-cl-native][data-cl-phase=ready]").length===3':'document.querySelectorAll("[data-clearling=translation][data-phase=ready]").length===3';
 if(!live){await cdp.wait(page,generic?'!!document.querySelector("[data-cl-phase=pending]")':'!!document.querySelector("[data-phase=pending]")');assert.equal(await cdp.evaluate(page,'getComputedStyle(document.querySelector("#p0")).display!=="none"'),true);checks.push('waiting preserves readable original');}
 await cdp.wait(page,ready,30000);
 if(generic){assert.equal(await cdp.evaluate(page,'document.querySelectorAll("[data-clearling=translation]").length'),0);assert.equal(await cdp.evaluate(page,'[...document.querySelectorAll("main p")].every(e=>/[\\u3400-\\u9fff]/.test(e.textContent))'),true);checks.push('native generic paragraphs render Chinese in original markup without added layout nodes');}
 else assert.equal(await cdp.evaluate(page,'document.querySelector("#p0").hasAttribute("data-cl-source")'),true);
 const translatedBody=generic?'document.querySelector("#p1")':'document.querySelector("#p1").nextElementSibling';
 assert.equal(await cdp.evaluate(page,`${translatedBody}.querySelector("code").textContent`),'cacheKey');
 assert.equal(await cdp.evaluate(page,`${translatedBody}.querySelector("a").href`),origin+'/#p0');
 assert.equal(await cdp.evaluate(page,'document.querySelector("#editor").querySelector("[data-clearling]")===null'),true);checks.push('no-key fast translation completes with protected link/code and editor exclusion');
 if(dense&&!live){assert.ok(denseWhole>0&&denseFragments>=9);assert.equal(await cdp.evaluate(page,'document.querySelectorAll("#p0 > span").length'),9);checks.push('marker loss in dense formatting recovers through the same machine provider using native text slots');}
 const before=live?network.length:calls,beforeFragments=denseFragments;await cdp.call('Page.reload',{},page.sessionId);await cdp.wait(page,ready,20000);
 if(dense&&!live){assert.equal(denseFragments,beforeFragments);assert.ok(calls<=before+3);checks.push('after a bounded formatting retry, warm native text slots are served from cache');}
 else{assert.equal(live?network.length:calls,before);checks.push('warm page uses cache without a new provider request');}
 if(!live){
  await rpc({type:'CLEAR_CACHE'});failure=true;await cdp.call('Page.reload',{},page.sessionId);await cdp.wait(page,generic?'!!document.querySelector("[data-cl-phase=failed]")':'!!document.querySelector("[data-phase=failed]")',10000);assert.equal(await cdp.evaluate(page,'getComputedStyle(document.querySelector("#p0")).display!=="none"'),true);checks.push('provider failure keeps original readable');
  const model=state.settings.selection.modelId;state=await rpc({type:'GET_STATE'});state=await rpc({type:'SET_READING_ENGINE',engine:'ai',expectedRevision:state.settings.revision});assert.equal(state.settings.selection.modelId,model);assert.equal(state.settings.hasKey,false);
  const start=calls;await cdp.call('Page.reload',{},page.sessionId);await new Promise(r=>setTimeout(r,300));assert.equal(calls,start);assert.equal(await cdp.evaluate(options,'!document.querySelector("#setup-prompt").hidden'),true);checks.push('unconfigured AI pauses translation and preserves model selection');
  failure=false;state=await rpc({type:'SET_READING_ENGINE',engine:'bing',expectedRevision:state.settings.revision});await cdp.wait(page,ready,10000);checks.push('explicit switch resumes a paused fast provider');
 }
 const report={version:await cdp.evaluate(options,'chrome.runtime.getManifest().version'),browser:kind,realMV3:true,nativeGeneric:generic,readingEngine:'bing',hasKey:false,syntheticOnly:!live,publicInputsOnly:true,checks,providerRequests:live?network.length:calls,network,time:new Date().toISOString()};
 await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/fast-${kind}-${generic?'generic-':''}${dense?'dense-':''}${live?'live':'synthetic'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser){if(listener)browser.cdp.listeners.delete(listener);await Promise.allSettled([...pendingTasks]);await browser.cdp.call('Browser.close').catch(()=>{});browser.cdp.close();}server.closeAllConnections();server.close();}
