import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { launchBrowser, loadCurrentExtension } from './browser-runtime.mjs';

// Only metadata is written. Public source text and DOM identities stay in page
// memory; this never adopts a daily browser or reads a saved AI connection.
const kind = process.argv[2] || 'chrome';
const url = 'https://zenn.dev/uehaj/articles/claude-code-pstack-structure-memo';
const planner = (await build({ entryPoints:['extension/content/planner.mjs'], bundle:true, format:'iife', globalName:'ClearlingPublicHeadingQA', write:false, platform:'browser' })).outputFiles[0].text;
let browser;
try {
  browser = await launchBrowser(kind, { profileName: `${kind}-qa-public-headings-${Date.now().toString(36)}` });
  const cdp = browser.cdp, id = await loadCurrentExtension(cdp, path.resolve(process.env.CLEARLING_BUILD_DIR || 'dist'));
  const options = await cdp.page(`chrome-extension://${id}/options.html`, { hidden: false });
  await cdp.wait(options, '!!document.querySelector("#reading-engine")');
  const rpc = message => cdp.evaluate(options, `chrome.runtime.sendMessage(${JSON.stringify(message)})`, true);
  let state = await rpc({ type: 'GET_STATE' });
  assert.equal(state.settings.hasKey, false); assert.equal(state.settings.readingEngine, 'bing');
  state = await rpc({ type: 'SET_AUTOMATIC', value: false, expectedRevision: state.settings.revision });
  const page = await cdp.page(url, { hidden: false });
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sessionId);
  await cdp.wait(page, `!!document.querySelector('h1')&&!!document.querySelector('h2')&&!!document.querySelector('aside a[href*="#"]')`, 30000);
  await cdp.evaluate(page, planner);
  const targets = await cdp.evaluate(page, `(()=>{
    const link=document.querySelector('aside a[href*="#"]');let label;
    for(let node=link;node&&node!==document.body;node=node.parentElement){if(ClearlingPublicHeadingQA.articleTocLabel(node.previousElementSibling)){label=node.previousElementSibling;break;}}
    if(!label)throw new Error('PUBLIC_TOC_LABEL_NOT_FOUND');
    const targets=[['h1',document.querySelector('h1')],['h2',document.querySelector('h2')],['toc-label',label],['aside a[href*="#"]',link]];
    window.publicHeadingProof=targets.map(([selector,element])=>{
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),texts=[];let node;while(node=walker.nextNode())texts.push([node,node.nodeValue]);
      return{selector,element,texts,href:element.getAttribute('href'),nodes:[element,...element.querySelectorAll('*')].map(node=>({node,parent:node.parentNode,children:[...node.childNodes]})),font:getComputedStyle(element).font,display:getComputedStyle(element).display};
    });
    return window.publicHeadingProof.map(p=>({selector:p.selector,characters:p.element.textContent.trim().length,inHeader:!!p.element.closest('header'),inAside:!!p.element.closest('aside'),display:p.display}));
  })()`);
  state = await rpc({ type: 'SET_AUTOMATIC', value: true, expectedRevision: state.settings.revision });
  for (let i=0; i<targets.length; i++) {
    await cdp.evaluate(page, `window.publicHeadingProof[${i}].element.scrollIntoView({block:'center'})`);
    try { await cdp.wait(page, `['ready','failed'].includes(window.publicHeadingProof[${i}].element.dataset.clPhase)`, 30000); }
    catch(error) { console.log({selector:targets[i].selector,error:error.message}); throw error; }
    assert.equal(await cdp.evaluate(page, `window.publicHeadingProof[${i}].element.dataset.clPhase`), 'ready', targets[i].selector);
  }
  const modes=[];
  for (const mode of ['translated','bilingual','original','translated']) {
    state = await rpc({ type: 'SET_DISPLAY_MODE', mode, expectedPresentationRevision: state.settings.presentationRevision });
    assert.equal(state.ok, true);
    await cdp.wait(page, `[...window.publicHeadingProof].every(p=>p.element.dataset.clMode===${JSON.stringify(mode)})`);
    const proof = await cdp.evaluate(page, `(()=>window.publicHeadingProof.map(p=>({selector:p.selector,phase:p.element.dataset.clPhase,model:p.element.dataset.clModel,original:p.texts.every(([node,value])=>node.nodeValue===value),hasChinese:/[\\u3400-\\u9fff]/.test(p.element.textContent),sourceHasKana:p.texts.some(([,value])=>/[\\u3040-\\u30ff]/.test(value)),currentHasKana:/[\\u3040-\\u30ff]/.test([...p.element.childNodes].filter(n=>n.nodeType!==1||!n.matches('[data-clearling]')).map(n=>n.textContent).join('')),projections:p.element.querySelectorAll(':scope>[data-clearling=translation]').length,structure:p.nodes.every(({node,parent,children})=>{const kept=[...node.childNodes].filter(n=>n.nodeType!==1||!n.matches('[data-clearling]'));return node.parentNode===parent&&kept.length===children.length&&kept.every((child,i)=>child===children[i]);}),fontPreserved:getComputedStyle(p.element).font===p.font,displayPreserved:getComputedStyle(p.element).display===p.display,linkPreserved:p.element.getAttribute('href')===p.href})))()`);
    for (const p of proof) {
      assert.equal(p.phase,'ready'); assert.equal(p.model,'microsoft-edge');
      assert.equal(p.original,mode!=='translated',p.selector);
      assert.equal(p.projections,mode==='bilingual'?1:0,p.selector);
      for(const key of ['structure','fontPreserved','displayPreserved','linkPreserved'])assert.equal(p[key],true,`${p.selector}: ${key}`);
      if(mode!=='original')assert.equal(p.hasChinese,true,p.selector);
      if(mode==='translated'&&p.sourceHasKana)assert.equal(p.currentHasKana,false,p.selector);
    }
    modes.push({mode,proof});
  }
  state = await rpc({ type:'SET_AUTOMATIC', value:false, expectedRevision:state.settings.revision });
  const report={version:await cdp.evaluate(options,'chrome.runtime.getManifest().version'),browser:kind,extensionId:id,url,realMV3:true,realProvider:true,targets,modes,time:new Date().toISOString()};
  await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/public-headings-${kind}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  if(browser){await browser.cdp.call('Browser.close').catch(()=>{});browser.cdp.close();}
}
