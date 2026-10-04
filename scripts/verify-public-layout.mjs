import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser,loadCurrentExtension } from './browser-runtime.mjs';
import { build } from 'esbuild';

// Public pages only. Original text stays in page memory; reports contain only
// structural/visibility metadata, never copied articles or browser credentials.
const cases=[
  {name:'documentation',url:'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction',selector:'main p'},
  {name:'encyclopedia',url:'https://en.wikipedia.org/wiki/Web_browser',selector:'.mw-parser-output p'},
  {name:'repository-readme',url:'https://github.com/microsoft/TypeScript',selector:'.markdown-body p'}
];
let browser;
const reports=[];
const only=process.argv.find(arg=>arg.startsWith('--site='))?.slice(7);
const planner=(await build({entryPoints:['extension/content/planner.mjs'],bundle:true,format:'iife',globalName:'ClearlingPublicQA',write:false,platform:'browser'})).outputFiles[0].text;
try {
  browser=await launchBrowser('chrome',{profileName:`chrome-qa-public-layout-${Date.now().toString(36)}`});
  const cdp=browser.cdp,id=await loadCurrentExtension(cdp,path.resolve(process.env.CLEARLING_BUILD_DIR||'dist'));
  const options=await cdp.page(`chrome-extension://${id}/options.html`,{hidden:false});await cdp.wait(options,'!!document.querySelector("#reading-engine")');
  const rpc=m=>cdp.evaluate(options,`chrome.runtime.sendMessage(${JSON.stringify(m)})`,true);
  let state=await rpc({type:'GET_STATE'});assert.equal(state.settings.hasKey,false);assert.equal(state.settings.readingEngine,'bing');
  for(const sample of cases.filter(sample=>!only||sample.name===only)){
    state=await rpc({type:'SET_AUTOMATIC',value:false,expectedRevision:state.settings.revision});
    const page=await cdp.page(sample.url,{hidden:false});
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false},page.sessionId);
    try{
      await cdp.wait(page,`[...document.querySelectorAll(${JSON.stringify(sample.selector)})].some(e=>e.textContent.trim().length>70&&/[a-z]{4}/i.test(e.textContent)&&e.getBoundingClientRect().height>0&&!e.closest('header,nav,aside,footer'))`,30000);
      await cdp.evaluate(page,planner);
      await cdp.evaluate(page,`(()=>{
        const target=[...document.querySelectorAll(${JSON.stringify(sample.selector)})].find(e=>e.textContent.trim().length>70&&/[a-z]{4}/i.test(e.textContent)&&e.getBoundingClientRect().height>0&&ClearlingPublicQA.planElement(e,'generic'));
        if(!target)throw new Error('NO_ELIGIBLE_PUBLIC_PARAGRAPH');
        target.scrollIntoView({block:'center'});const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT),texts=[];let text;while(text=walker.nextNode())texts.push([text,text.nodeValue]);
        window.__clearlingPublicProof={target,texts,nodes:[target,...target.querySelectorAll('*')].map(node=>({node,parent:node.parentNode,children:[...node.childNodes]})),width:target.getBoundingClientRect().width,font:getComputedStyle(target).font};
      })()`);
      state=await rpc({type:'SET_AUTOMATIC',value:true,expectedRevision:state.settings.revision});
      await cdp.wait(page,`['ready','failed'].includes(window.__clearlingPublicProof.target.dataset.clPhase)`,30000);
      assert.equal(await cdp.evaluate(page,'window.__clearlingPublicProof.target.dataset.clPhase'),'ready','provider must complete the public paragraph');
      const result={name:sample.name,url:sample.url,modes:[]};
      for(const mode of ['translated','bilingual','original','translated']){
        state=await rpc({type:'SET_DISPLAY_MODE',mode,expectedPresentationRevision:state.settings.presentationRevision});assert.equal(state.ok,true);
        await cdp.wait(page,`window.__clearlingPublicProof.target.dataset.clMode===${JSON.stringify(mode)}`);
        const proof=await cdp.evaluate(page,`(()=>{const p=window.__clearlingPublicProof;return{mode:p.target.dataset.clMode,phase:p.target.dataset.clPhase,model:p.target.dataset.clModel,hasChinese:/[\u3400-\u9fff]/.test(p.target.textContent),originalText:p.texts.every(([node,text])=>node.nodeValue===text),projectionCount:p.target.querySelectorAll(':scope>[data-clearling=translation]').length,structurePreserved:p.nodes.every(({node,parent,children})=>{const current=[...node.childNodes].filter(n=>n.nodeType!==1||!n.matches('[data-clearling]')),kept=current.filter(n=>children.includes(n)),extra=current.filter(n=>!children.includes(n));return node.isConnected&&node.parentNode===parent&&kept.length===children.length&&children.every((child,i)=>child===kept[i])&&extra.every(n=>p.target.dataset.clMode==='translated'&&node===p.target&&n.nodeType===3&&n.nodeValue.trim().length<=3&&/^[\\s\\p{P}]+$/u.test(n.nodeValue)&&(n===node.firstChild||n===node.lastChild))}),widthDelta:Math.abs(p.target.getBoundingClientRect().width-p.width),fontPreserved:getComputedStyle(p.target).font===p.font}})()`);
        assert.equal(proof.phase,'ready');assert.equal(proof.model,'microsoft-edge');assert.equal(proof.structurePreserved,true);assert.equal(proof.fontPreserved,true);assert.ok(proof.widthDelta<1);
        assert.equal(proof.originalText,mode!=='translated');assert.equal(proof.projectionCount,mode==='bilingual'?1:0);if(mode!=='original')assert.equal(proof.hasChinese,true);
        result.modes.push(proof);
      }
      reports.push({...result,ok:true});
    }catch(error){reports.push({name:sample.name,url:sample.url,ok:false,error:error.message,diagnostic:await cdp.evaluate(page,`(()=>{const target=window.__clearlingPublicProof?.target;return{url:location.href,title:document.title,readyState:document.readyState,candidateCount:document.querySelectorAll(${JSON.stringify(sample.selector)}).length,phase:target?.dataset.clPhase,targetConnected:target?.isConnected,targetClass:target?.className,targetHasChinese:target?/[\u3400-\u9fff]/.test(target.textContent):null,childNodesPreserved:target?window.__clearlingPublicProof.nodes.every(({node,parent,children})=>node.parentNode===parent&&children.every(child=>child.parentNode===node)):null,browserError:document.querySelector('.error-code')?.textContent||null}})()`).catch(()=>({unavailable:true})),extension:await cdp.evaluate(options,`(async()=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url?.startsWith(${JSON.stringify(sample.url)}));return tab?chrome.tabs.sendMessage(tab.id,{type:'GET_DIAGNOSTICS'}):null})()`,true).catch(()=>null)});}
    state=await rpc({type:'SET_AUTOMATIC',value:false,expectedRevision:state.settings.revision});
    await cdp.call('Target.closeTarget',{targetId:page.targetId});
  }
  const report={version:await cdp.evaluate(options,'chrome.runtime.getManifest().version'),browser:'chrome',realMV3:true,realProvider:true,publicPagesOnly:true,reports,time:new Date().toISOString()};
  await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/public-layout-chrome${only?'-'+only:''}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(reports.some(r=>!r.ok))process.exitCode=1;
}finally{if(browser){await browser.cdp.call('Browser.close').catch(()=>{});browser.cdp.close();}}
