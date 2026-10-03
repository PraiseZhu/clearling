import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {launchBrowser,loadCurrentExtension} from './browser-runtime.mjs';
import {PROFILES,defaultSelection} from '../extension/shared/profiles.mjs';
const kind=process.argv[2]||'chrome';
const server=spawn(process.execPath,['scripts/fixture-server.mjs'],{env:{...process.env,CLEARLING_FIXTURE_PORT:'0'},stdio:['ignore','pipe','inherit']});
const line=await new Promise(resolve=>{const reader=createInterface({input:server.stdout});reader.once('line',s=>{reader.close();resolve(JSON.parse(s));});});
let browser,options;const checks=[];
try{
 browser=await launchBrowser(kind,{profileName:`${kind}-qa-ui-v050-${Date.now().toString(36)}`});const cdp=browser.cdp;
 const id=await loadCurrentExtension(cdp,path.resolve(process.env.CLEARLING_BUILD_DIR||'dist'));
 options=await cdp.page(`chrome-extension://${id}/options.html`,{hidden:false});await cdp.wait(options,`document.querySelector('#model')?.options.length===${PROFILES.length}`);
 const rpc=m=>cdp.evaluate(options,`chrome.runtime.sendMessage(${JSON.stringify(m)})`,true);
 let state=await rpc({type:'GET_STATE'});assert.equal(state.settings.hasKey,false);
 state=await rpc({type:'SET_READING_ENGINE',engine:'ai',expectedRevision:state.settings.revision});
 assert.equal(await cdp.evaluate(options,'document.querySelector("#setup-prompt").hidden'),false);
 await cdp.evaluate(options,'document.querySelector("#configure-connection").click()');
 assert.equal(await cdp.evaluate(options,'document.activeElement.id'),'endpoint');
 assert.equal(await cdp.evaluate(options,'document.querySelector("#test-connection").disabled'),true);
 await cdp.evaluate(options,'document.querySelector("[data-tab=models]").click()');
 checks.push('unconfigured state offers a direct connection path and prevents meaningless tests');
 assert.equal(await cdp.evaluate(options,'!!document.querySelector("#compare,[data-tab=compare],#export-results")'),false);
 assert.equal((await rpc({type:'COMPARE_MODEL'})).code,'FORBIDDEN');checks.push('comparison UI, export and runtime endpoint removed');
 await cdp.evaluate(options,'document.querySelector("#model-search").value="gemini";document.querySelector("#model-search").dispatchEvent(new Event("input"))');
 assert.equal(await cdp.evaluate(options,'[...document.querySelector("#model").options].filter(o=>o.value.includes("gemini")).length'),2);
 assert.equal(await cdp.evaluate(options,'document.querySelector("#model").value'),'xiaomi/mimo-v2.6-flash');
 await cdp.evaluate(options,'document.querySelector("#model-search").value="no-such-model-xyz";document.querySelector("#model-search").dispatchEvent(new Event("input"))');
 assert.equal(await cdp.evaluate(options,'document.querySelector("#model-empty").hidden'),false);
 await cdp.evaluate(options,'document.querySelector("#model-search").value="";document.querySelector("#model-search").dispatchEvent(new Event("input"))');
 checks.push('search filters model families and preserves current selection on no matches');
 state=await rpc({type:'SAVE_CONNECTION',endpoint:line.url,apiKey:'fixture',connectionKind:'cindy',expectedRevision:state.settings.revision});assert.equal(state.ok,true);
 await cdp.wait(options,'document.querySelector("#connection-status").classList.contains("ready")');
 for(const p of PROFILES){const selection=defaultSelection(p);state=await rpc({type:'SELECT_MODEL',selection,expectedRevision:state.settings.revision});assert.equal(state.ok,true,p.id);assert.equal(state.settings.selection.modelId,p.id);}
 checks.push('all nineteen presets validate and switch through the real worker using synthetic provider');
 await cdp.evaluate(options,'document.querySelector("#model").value="google/gemini-3.8-flash";document.querySelector("#model").dispatchEvent(new Event("change"));document.querySelector("#effort").value="high";document.querySelector("#effort").dispatchEvent(new Event("change"))');
 const before=await rpc({type:'GET_STATE'});
 const display=await rpc({type:'SET_DISPLAY_MODE',mode:'bilingual',expectedPresentationRevision:before.settings.presentationRevision});
 await cdp.wait(options,'document.querySelector("#display-mode").value==="bilingual"');
 assert.equal(await cdp.evaluate(options,'document.querySelector("#model").value'),'google/gemini-3.8-flash');assert.equal(await cdp.evaluate(options,'document.querySelector("#effort").value'),'high');
 const busy=await cdp.evaluate(options,'(()=>{document.querySelector("#apply-model").click();return {busy:document.querySelector("#apply-model").getAttribute("aria-busy"),text:document.querySelector("#apply-model").textContent,locked:["model","model-search","thinking","effort"].every(id=>document.getElementById(id).disabled)}})()');
 assert.equal(busy.busy,'true');assert.match(busy.text,/应用中/);assert.equal(busy.locked,true);
 await cdp.wait(options,'document.querySelector("#notice").textContent.includes("已切换")');state=await rpc({type:'GET_STATE'});assert.equal(state.settings.selection.effort,'high');
 assert.equal(await cdp.evaluate(options,'document.querySelector("#apply-model").disabled && document.querySelector("#model-draft").hidden'),true);
 checks.push('apply exposes progress, locks its draft and settles to the applied state');
 const bad=await rpc({type:'SELECT_MODEL',selection:{modelId:'missing-model',thinking:'disabled',effort:null},expectedRevision:state.settings.revision});assert.equal(bad.ok,false);assert.equal((await rpc({type:'GET_STATE'})).settings.selection.modelId,state.settings.selection.modelId);
 checks.push('model draft survives presentation updates; invalid choices preserve working model');
 await cdp.evaluate(options,'document.querySelector("[data-tab=connection]").click();document.querySelector("#endpoint").value="https://example.invalid";document.querySelector("#endpoint").dispatchEvent(new Event("input"))');
 await rpc({type:'SET_DISPLAY_MODE',mode:'translated',expectedPresentationRevision:display.settings.presentationRevision});
 await cdp.wait(options,'document.querySelector("#display-mode").value==="translated"');assert.equal(await cdp.evaluate(options,'document.querySelector("#endpoint").value'),'https://example.invalid');
 assert.equal(await cdp.evaluate(options,'document.querySelector("#test-connection").disabled && !document.querySelector("#connection-draft").hidden'),true);
 checks.push('unsaved connection draft survives unrelated storage updates and cannot test saved credentials as if they were the draft');
 state=await rpc({type:'GET_STATE'});state=await rpc({type:'SELECT_MODEL',selection:defaultSelection(),expectedRevision:state.settings.revision});
 await cdp.evaluate(options,'document.querySelector("[data-tab=models]").click()');
 const readingPage=await cdp.page(`${line.url}/article?ui`,{hidden:false});await cdp.call('Target.activateTarget',{targetId:readingPage.targetId});
 const popup=await cdp.page(`chrome-extension://${id}/popup.html`,{hidden:false});await cdp.wait(popup,`document.querySelector('#model')?.options.length===${PROFILES.length}`);
 await mkdir('artifacts',{recursive:true});
 for(const [page,width,height,name] of [[popup,376,600,'popup'],[options,1100,1000,'settings'],[options,390,900,'settings-narrow']]){
   await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},page.sessionId);
   await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]},page.sessionId);
   await cdp.evaluate(page, '(async()=>{window.scrollTo(0,0);const content=document.querySelector(".popup-content");if(content)content.scrollTop=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))})()',true);
   const geometry=await cdp.evaluate(page,'({bg:getComputedStyle(document.body).backgroundColor,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.body.scrollHeight})');
   assert.equal(geometry.bg,'rgb(8, 8, 8)');assert.ok(geometry.scrollWidth<=geometry.width+1);
   const shot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:{x:0,y:0,width,height:name==='popup'?Math.min(geometry.height,600):height,scale:1}},page.sessionId);await writeFile(`artifacts/ui-${kind}-${name}.png`,Buffer.from(shot.data,'base64'));
   if(name==='popup')console.log({popupHeight:geometry.height});
 }
 checks.push('popup and desktop/mobile settings stay black under light OS theme without horizontal overflow');
 for(const [model,thinking,label] of [['openai/gpt-6-luna',false,'effort'],['deepseek/deepseek-v4-flash',true,'thinking'],['z-ai/glm-5.3-flash',true,'fixed']]){
  await cdp.evaluate(popup,`document.querySelector('#model').value=${JSON.stringify(model)};document.querySelector('#model').dispatchEvent(new Event('change'));document.querySelector('#thinking').checked=${thinking};document.querySelector('#thinking').dispatchEvent(new Event('change'));document.querySelector('#notice').textContent='网关请求过多，请稍后重试';document.querySelector('#notice').classList.add('error');`);
  const box=await cdp.evaluate(popup,`(()=>{const r=document.querySelector('#apply-model').getBoundingClientRect();return {height:document.documentElement.scrollHeight,top:r.top,bottom:r.bottom,width:document.documentElement.scrollWidth};})()`);
  assert.ok(box.height<=600 && box.top>=0 && box.bottom<=600 && box.width<=376,JSON.stringify(box));
  const shot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},popup.sessionId);await writeFile(`artifacts/ui-${kind}-popup-${label}.png`,Buffer.from(shot.data,'base64'));
 }
 checks.push('effort-only, thinking-enabled and fixed-thinking popup states keep apply visible at 376x600 with notices');
 await cdp.evaluate(popup,`document.querySelector('#model-search').focus()`);const focus=[];
 for(let i=0;i<8;i++){await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},popup.sessionId);await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},popup.sessionId);focus.push(await cdp.evaluate(popup,'document.activeElement?.id'));}
 assert.ok(focus.includes('model') && focus.includes('effort') && focus.includes('apply-model'),JSON.stringify(focus));checks.push('keyboard navigation reaches model, effort and apply controls');
 await cdp.wait(popup,'document.querySelector("#site-enabled").checked && !document.querySelector("#site-enabled").disabled');
 state=await rpc({type:'GET_STATE'});
 state=await rpc({type:'TOGGLE_SITE',url:line.url,expectedRevision:state.settings.revision});
 await cdp.wait(popup,'!document.querySelector("#site-enabled").checked && document.querySelector("#refresh-page").disabled');
 state=await rpc({type:'TOGGLE_SITE',url:line.url,expectedRevision:state.settings.revision});
 await cdp.wait(popup,'document.querySelector("#site-enabled").checked && !document.querySelector("#refresh-page").disabled');
 checks.push('site controls track settings changed in another surface and disable unavailable refresh');
 await fetch(line.url+'/failure-mode',{method:'POST',body:JSON.stringify({rateLimit:true})});
 state=await rpc({type:'GET_STATE'});const workingModel=state.settings.selection.modelId;
 await cdp.evaluate(options,`document.querySelector('[data-tab=models]').click();document.querySelector('#model').value='openai/gpt-5.6-luna';document.querySelector('#model').dispatchEvent(new Event('change'));document.querySelector('#apply-model').click();`);
 await cdp.wait(options,`document.querySelector('#notice').classList.contains('error') && document.querySelector('#notice').textContent.includes('请求过多')`);
 assert.equal((await rpc({type:'GET_STATE'})).settings.selection.modelId,workingModel);assert.equal(await cdp.evaluate(options,`document.querySelector('#model').value`),'openai/gpt-5.6-luna');
 await fetch(line.url+'/failure-mode',{method:'POST',body:JSON.stringify({rateLimit:false})});
 checks.push('429 apply failure preserves both active model and unsaved draft with a visible error');

 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},options.sessionId);
 assert.equal(await cdp.evaluate(options,'getComputedStyle(document.querySelector("[data-panel=models]")).animationName'),'none');
 checks.push('reduced-motion preference disables entry and busy animations');
 const errors=cdp.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text);assert.deepEqual(errors,[]);
 const report={browser:kind,version:await cdp.evaluate(options,'chrome.runtime.getManifest().version'),presets:PROFILES.length,checks,syntheticOnly:true,time:new Date().toISOString()};await writeFile(`artifacts/ui-${kind}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
 if(options&&browser)await browser.cdp.evaluate(options,'(async()=>{const s=await chrome.runtime.sendMessage({type:"GET_STATE"});if(s.settings?.hasKey)await chrome.runtime.sendMessage({type:"CLEAR_CONNECTION",expectedRevision:s.settings.revision});await chrome.runtime.sendMessage({type:"CLEAR_CACHE"})})()',true).catch(()=>{});
 if(browser){await browser.cdp.call('Browser.close').catch(()=>{});browser.cdp.close();}server.kill('SIGTERM');
}
