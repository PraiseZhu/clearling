import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {writeFile,mkdir} from 'node:fs/promises';
import {launchBrowser,loadCurrentExtension} from './browser-runtime.mjs';
const kind=process.argv[2]||'chrome';
const server=spawn(process.execPath,['scripts/fixture-server.mjs'],{env:{...process.env,CLEARLING_FIXTURE_PORT:'0',CLEARLING_FIXTURE_CHINESE:'1'},stdio:['ignore','pipe','inherit']});
const line=await new Promise(resolve=>{const r=createInterface({input:server.stdout});r.once('line',v=>{r.close();resolve(JSON.parse(v));});});
let browser,options;const checks=[];
try {
 browser=await launchBrowser(kind,{profileName:`${kind}-qa-presentation-v030`});const cdp=browser.cdp;
 const id=await loadCurrentExtension(cdp,`${process.cwd()}/${process.env.CLEARLING_BUILD_DIR || 'dist'}`);
 options=await cdp.page(`chrome-extension://${id}/options.html`,{hidden:false});await cdp.wait(options,'!!document.querySelector("#model")?.options.length');
 const rpc=m=>cdp.evaluate(options,`chrome.runtime.sendMessage(${JSON.stringify(m)})`,true);
 let state=await rpc({type:'GET_STATE'});assert.equal(state.settings.hasKey,false);assert.equal(state.settings.displayMode,'translated');
 state=await rpc({type:'SAVE_CONNECTION',endpoint:line.url,apiKey:'fixture',connectionKind:'cindy',expectedRevision:state.settings.revision});
 const page=await cdp.page(`${line.url}/x-thread`,{hidden:false});
 const ready=selector=>`document.querySelector(${JSON.stringify(selector)})?.nextElementSibling?.dataset.phase==='ready'`;
 const scroll=selector=>cdp.evaluate(page,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});(e.hasAttribute('data-cl-source')?e.nextElementSibling:e).scrollIntoView({block:'center'})})()`);
 try{await cdp.wait(page,ready('#main-text'));}catch(error){console.log({fixture:await cdp.evaluate(page,'({hidden:document.hidden,source:document.querySelector("#main-text")?.textContent,phases:[...document.querySelectorAll("[data-clearling]")].map(e=>e.dataset.phase)})'),metrics:await fetch(line.url+'/metrics').then(r=>r.json()),exceptions:cdp.events.filter(e=>e.method==="Runtime.exceptionThrown").map(e=>e.params.exceptionDetails.text)});throw error;}
 assert.equal(await cdp.evaluate(page,'getComputedStyle(document.querySelector("#main-text")).display'),'none');
 const original=await cdp.evaluate(page,'document.querySelector("#main-text").innerHTML');
 checks.push('default translation-only hides source without mutating its original children');
 for(const selector of ['#reply-text','#short','#inline','#card-title','#card-summary','#article-title','#article-paragraph','#article-list','#article-quote','#article-embedded','#recycled-text']) {
   await scroll(selector);await cdp.wait(page,ready(selector));
   assert.equal(await cdp.evaluate(page,`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).display`),'none',selector);
 }
 assert.equal(await cdp.evaluate(page,'document.querySelectorAll("#article-card [data-clearling][data-phase=ready]").length'),2);
 checks.push('quote cards, article titles, paragraphs, list items and embedded quotes translate once');
 await scroll('#inline');
 const links=await cdp.evaluate(page,'(()=>{const s=document.querySelector("#source-link"),t=document.querySelector("#inline").nextElementSibling;return {original:s.href,translated:t.querySelector("a").href,code:t.querySelector("code").textContent}})()');
 assert.equal(links.original,links.translated);assert.equal(links.code,'cacheKey');
 checks.push('translated links and protected inline code retain safe semantics');
 const metrics=()=>fetch(`${line.url}/metrics`).then(r=>r.json());
 await cdp.wait(page,`[...document.querySelectorAll('[data-clearling]')].every(e=>e.dataset.phase!=='pending')`);
 const before=(await metrics()).calls, revision=state.settings.revision;
 for(const mode of ['original','bilingual','translated']) {
  state=await rpc({type:'SET_DISPLAY_MODE',mode,expectedPresentationRevision:state.settings.presentationRevision});assert.equal(state.ok,true);assert.equal(state.settings.revision,revision);
  await cdp.wait(page,`document.querySelector('#main-text').nextElementSibling.dataset.mode===${JSON.stringify(mode)}`);
  assert.equal(await cdp.evaluate(page,'document.querySelector("#main-text").innerHTML'),original);
  if(mode==='original')assert.notEqual(await cdp.evaluate(page,'getComputedStyle(document.querySelector("#main-text")).display'),'none');
 }
 assert.equal((await metrics()).calls,before);
 checks.push('three display modes preserve DOM, request revision and API count');
 await cdp.evaluate(page,'document.querySelector("#inline").nextElementSibling.remove()');await cdp.wait(page,ready('#inline'));
 assert.equal((await metrics()).calls,before);
 checks.push('removed translated-only projection restores from local result');
 await cdp.evaluate(page,'document.querySelector("#source-link").href="#main"');
 await cdp.wait(page,'document.querySelector("#inline").nextElementSibling?.querySelector("a")?.hash==="#main"');
 checks.push('changing only a source href invalidates old projection ownership');
 // A delayed source is recycled into another source before its response arrives.
 await cdp.evaluate(page,'document.querySelector("#inline").textContent="[SLOW] stale source for translation-only test"');
 await cdp.wait(page,'document.querySelector("#inline").nextElementSibling?.dataset.phase==="pending"');
 await cdp.evaluate(page,'document.querySelector("#inline").textContent="The update preserves existing settings. If validation fails, the previous configuration remains active and no changes are applied."');
 await cdp.wait(page,'document.querySelector("#inline").nextElementSibling?.textContent.startsWith("更新会保留现有设置")');
 assert.equal(await cdp.evaluate(page,'document.querySelector("#inline").nextElementSibling.textContent.includes("stale source")'),false);
 checks.push('recycled pure-translation source rejects stale in-flight output');
 await cdp.evaluate(page,'document.querySelector("#inline").setAttribute("contenteditable","true")');
 await cdp.wait(page,'!document.querySelector("#inline").hasAttribute("data-cl-source") && !document.querySelector("#inline").nextElementSibling?.matches("[data-clearling]")');
 checks.push('becoming an editor removes translation and restores original visibility');
 for(const width of [1280,390]) {
   await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},page.sessionId);
   await cdp.evaluate(page,'window.scrollTo(0,0)');assert.equal(await cdp.evaluate(page,'document.documentElement.scrollWidth<=innerWidth+1'),true);
   const shot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},page.sessionId);await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/presentation-${kind}-${width}.png`,Buffer.from(shot.data,'base64'));
 }
 checks.push('pure translation preserves desktop and narrow column width');
 await cdp.call('Page.navigate',{url:`${line.url}/article`},page.sessionId);await cdp.wait(page,ready('#first'));
 await scroll('#table-cell');await cdp.wait(page,ready('#table-cell'));
 assert.equal(await cdp.evaluate(page,'[...document.querySelector("#table-row").children].filter(e=>getComputedStyle(e).display!=="none").length'),2);
 state=await rpc({type:'SET_DISPLAY_MODE',mode:'bilingual',expectedPresentationRevision:state.settings.presentationRevision});
 await cdp.wait(page,'!!document.querySelector("#table-cell [data-clearling]")');
 assert.equal(await cdp.evaluate(page,'[...document.querySelector("#table-row").children].filter(e=>getComputedStyle(e).display!=="none").length'),2);
 checks.push('generic paragraphs and table modes preserve visible column count');

 state=await rpc({type:'SET_DISPLAY_MODE',mode:'translated',expectedPresentationRevision:state.settings.presentationRevision});
 await cdp.wait(page,ready('#table-cell'));
 await cdp.evaluate(page,'document.querySelector("#table-cell").nextElementSibling.remove()');
 await cdp.wait(page,ready('#table-cell'));
 checks.push('table projection ownership survives mode conversion and host removal');
 await cdp.evaluate(page,`(()=>{const host=document.createElement('x-public-example');host.style.display='block';document.querySelector('main').prepend(host);setTimeout(()=>{const root=host.attachShadow({mode:'open'});root.innerHTML='<p id="shadow-text">The update preserves existing settings. If validation fails, the previous configuration remains active and no changes are applied.</p>';},50);})()`);
 await cdp.evaluate(page,'window.scrollTo(0,0)');
 await cdp.wait(page,`document.querySelector('x-public-example')?.shadowRoot?.querySelector('[data-clearling][data-phase="ready"]')?.textContent.startsWith('更新会保留现有设置')`);
 assert.equal(await cdp.evaluate(page,`getComputedStyle(document.querySelector('x-public-example').shadowRoot.querySelector('#shadow-text')).display`),'none');
 checks.push('late open Shadow DOM translates with its own visibility stylesheet');
 await cdp.evaluate(page,`(()=>{const frame=document.createElement('iframe');frame.src='/frame';frame.id='public-frame';document.querySelector('main').prepend(frame);})()`);
 await cdp.wait(page,`document.querySelector('#public-frame')?.contentDocument?.querySelector('[data-clearling][data-phase="ready"]')?.textContent.startsWith('更新会保留现有设置')`);
 checks.push('accessible iframe translates automatically in its own content context');
 await cdp.evaluate(page,`(()=>{const p=document.createElement('p');p.id='failure';p.textContent='[FAIL] Public failure must retain a way to read the original.';document.querySelector('main').prepend(p);})()`);
 await cdp.wait(page,`document.querySelector('#failure')?.nextElementSibling?.dataset.phase==='failed'`);
 await cdp.evaluate(page,`document.querySelector('#failure').nextElementSibling.querySelector('button').click()`);
 assert.notEqual(await cdp.evaluate(page,`getComputedStyle(document.querySelector('#failure')).display`),'none');
 checks.push('request failure exposes explicit original recovery without blanking content');
 // Prevent a new content Port from connecting, then restore it without reloading.
 state=await rpc({type:'SET_AUTOMATIC',value:false,expectedRevision:state.settings.revision});
 const reconnect=await cdp.page(`${line.url}/article?reconnect`,{hidden:false});

 await cdp.wait(reconnect,'!!document.querySelector("#first")');
 const contexts=cdp.events.filter(e=>e.method==='Runtime.executionContextCreated' && e.sessionId===reconnect.sessionId && e.params.context.auxData?.type==='isolated').reverse();
 let contextId;
 for(const event of contexts)try{const probe=await cdp.call('Runtime.evaluate',{contextId:event.params.context.id,expression:'globalThis.__clearlingStarted===true',returnByValue:true},reconnect.sessionId);if(probe.result.value){contextId=event.params.context.id;break;}}catch{}
 assert.ok(contextId);
 await cdp.call('Runtime.evaluate',{contextId,expression:'globalThis.__originalConnect=chrome.runtime.connect;globalThis.__connectAttempts=0;chrome.runtime.connect=()=>{__connectAttempts++;throw new Error("test transport unavailable")};'},reconnect.sessionId);
 state=await rpc({type:'SET_AUTOMATIC',value:true,expectedRevision:state.settings.revision});
 await cdp.wait(reconnect,`document.querySelector('#first')?.nextElementSibling?.dataset.phase==='failed'`);
 await new Promise(r=>setTimeout(r,1250));
 const attempts=await cdp.call('Runtime.evaluate',{contextId,expression:'globalThis.__connectAttempts',returnByValue:true},reconnect.sessionId);assert.ok(attempts.result.value<=3);
 await cdp.call('Runtime.evaluate',{contextId,expression:'chrome.runtime.connect=globalThis.__originalConnect;document.dispatchEvent(new Event("visibilitychange"));'},reconnect.sessionId);
 await cdp.wait(reconnect,ready('#first'));checks.push('Port failure backs off and translation resumes after transport recovery');

 await cdp.evaluate(reconnect,`(()=>{const main=document.querySelector('main');main.replaceChildren();const fragment=document.createDocumentFragment();for(let i=0;i<1000;i++){const a=document.createElement('article');a.dataset.testid='tweet';a.style.height='110px';const text=document.createElement('div');text.dataset.testid='tweetText';text.id='stress-'+i;text.textContent='Public virtual feed entry '+i+' should remain readable after a long scroll.';a.append(text);fragment.append(a);}main.append(fragment);scrollTo(0,0);})()`);
 await cdp.wait(reconnect,ready('#stress-0'));
 await cdp.evaluate(reconnect,'document.querySelector("#stress-999").scrollIntoView()');
 await cdp.wait(reconnect,ready('#stress-999'));
 await cdp.evaluate(reconnect,'window.scrollTo(0,0)');await cdp.wait(reconnect,ready('#stress-0'));
 const diagnostic=await cdp.evaluate(options,`(async()=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===${JSON.stringify(line.url+'/article?reconnect')}&&t.id);return chrome.tabs.sendMessage(tab.id,{type:'GET_DIAGNOSTICS'})})()`,true);
 // The source DOM belongs to the host; only extension records and queue are bounded.
 assert.ok(diagnostic.records<=600,JSON.stringify(diagnostic));
 checks.push('one-thousand-entry feed can jump to the end and back with bounded records');
 const report={browser:kind,version:await cdp.evaluate(options,'chrome.runtime.getManifest().version'),checks,syntheticOnly:true,time:new Date().toISOString()};await writeFile(`artifacts/presentation-${kind}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {
 if(options&&browser)await browser.cdp.evaluate(options,'(async()=>{const s=await chrome.runtime.sendMessage({type:"GET_STATE"});if(s.settings?.hasKey)await chrome.runtime.sendMessage({type:"CLEAR_CONNECTION",expectedRevision:s.settings.revision});await chrome.runtime.sendMessage({type:"CLEAR_CACHE"});const x=await chrome.runtime.sendMessage({type:"GET_STATE"});await chrome.runtime.sendMessage({type:"SET_DISPLAY_MODE",mode:"translated",expectedPresentationRevision:x.settings.presentationRevision})})()',true).catch(()=>{});
 if(browser){await browser.cdp.call('Browser.close').catch(()=>{});browser.cdp.close();}server.kill('SIGTERM');
}
