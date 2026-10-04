import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, loadCurrentExtension } from './browser-runtime.mjs';

const kind=process.argv[2]||'chrome',checks=[];
const server=spawn(process.execPath,['scripts/fixture-server.mjs'],{env:{...process.env,CLEARLING_FIXTURE_PORT:'0',CLEARLING_FIXTURE_CHINESE:'1'},stdio:['ignore','pipe','inherit']});
const fixture=await new Promise(resolve=>{const lines=createInterface({input:server.stdout});lines.once('line',line=>{lines.close();resolve(JSON.parse(line));});});
let browser;
try {
  browser=await launchBrowser(kind,{profileName:`${kind}-qa-compatibility-${Date.now().toString(36)}`});
  const cdp=browser.cdp,id=await loadCurrentExtension(cdp,path.resolve(process.env.CLEARLING_BUILD_DIR||'dist'));
  const options=await cdp.page(`chrome-extension://${id}/options.html`,{hidden:false});
  await cdp.wait(options,'!!document.querySelector("#model")?.options.length');
  const rpc=message=>cdp.evaluate(options,`chrome.runtime.sendMessage(${JSON.stringify(message)})`,true);
  let state=await rpc({type:'GET_STATE'});assert.equal(state.settings.hasKey,false);
  state=await rpc({type:'SET_READING_ENGINE',engine:'ai',expectedRevision:state.settings.revision});
  const page=await cdp.page(fixture.url+'/compatibility',{hidden:false});
  await cdp.wait(page,'!!document.querySelector("#rich")');
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:1000,deviceScaleFactor:1,mobile:false},page.sessionId);
  const initial=await cdp.evaluate(page,`(()=>{
    const main=document.querySelector('main');
    window.originalElements=[main,...main.querySelectorAll('*')].map(node=>({node,parent:node.parentNode,children:[...node.childNodes]}));
    const walker=document.createTreeWalker(main,NodeFilter.SHOW_TEXT);window.originalTexts=[];let node;while(node=walker.nextNode())window.originalTexts.push([node,node.nodeValue]);
    const styles=selector=>{const node=document.querySelector(selector),s=getComputedStyle(node),r=node.getBoundingClientRect();return {width:r.width,height:r.height,padding:s.padding,border:s.border,background:s.backgroundColor,order:s.order,gridColumn:s.gridColumn,font:s.font,fontStyle:s.fontStyle,letterSpacing:s.letterSpacing}};
    return {metadata:document.querySelector('#metadata').innerHTML,mixed:document.querySelector('#mixed-title').innerHTML,styles:Object.fromEntries(['#metadata','#english-heading','#grid','#flex','#decorated','#table-cell','#native-button','#private-input','#rich .accent'].map(selector=>[selector,styles(selector)]))};
  })()`);
  state=await rpc({type:'SAVE_CONNECTION',endpoint:fixture.url,apiKey:'fixture',connectionKind:'cindy',expectedRevision:state.settings.revision});assert.equal(state.ok,true);
  const ids=['english-heading','whitespace','rich','unchanged','edge-punctuation','control','private','hidden-text','prewrap','breaks','ordered','nested','table-header','table-cell','grid','flex','decorated','dynamic','delayed'];
  const ready=id=>`document.getElementById(${JSON.stringify(id)})?.dataset.clPhase==='ready'`;
  for(const id of ids){
    await cdp.evaluate(page,`document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center'})`);
    try{await cdp.wait(page,ready(id));}catch(error){console.log({failedId:id,state:await cdp.evaluate(page,`(()=>{const e=document.getElementById(${JSON.stringify(id)});return {phase:e.dataset.clPhase,text:e.textContent,mode:e.dataset.clMode}})()`),exceptions:cdp.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails)});throw error;}
  }
  await cdp.evaluate(page,`document.querySelector('#failure').hidden=false;document.querySelector('#failure').scrollIntoView({block:'center'})`);
  await cdp.wait(page,`document.querySelector('#failure').dataset.clPhase==='failed'`);
  const translated=await cdp.evaluate(page,`(()=>{
    const shape=window.originalElements.every(({node,parent,children})=>{const current=[...node.childNodes],kept=current.filter(n=>children.includes(n)),extra=current.filter(n=>!children.includes(n));return node.parentNode===parent&&kept.length===children.length&&children.every((child,i)=>kept[i]===child)&&extra.every(n=>node.id==='edge-punctuation'&&n.nodeType===3&&n.nodeValue==='。'&&n===node.lastChild)});
    return {shape,metadata:document.querySelector('#metadata').innerHTML,mixed:document.querySelector('#mixed-title').innerHTML,metadataMarked:document.querySelectorAll('#metadata[data-cl-native],#metadata [data-cl-native],#layout-container[data-cl-native],#mixed-title[data-cl-native],nav [data-cl-native]').length,visibleOutput:document.querySelectorAll('[data-clearling=translation]').length,code:document.querySelector('#rich code').textContent,privateValue:document.querySelector('#private-input').value,failure:document.querySelector('#failure').textContent,lines:document.querySelector('#prewrap').textContent.split('\\n').length,breaks:document.querySelectorAll('#breaks br').length};
  })()`);
  assert.equal(translated.shape,true,'translated mode preserves every host node; only a text punctuation boundary may be added');
  assert.equal(translated.metadata,initial.metadata);assert.equal(translated.mixed,initial.mixed);assert.equal(translated.metadataMarked,0);
  assert.equal(translated.visibleOutput,0,'translated mode adds no translation element to the layout');
  assert.equal(translated.code,'cacheKey');assert.equal(translated.privateValue,'private form sample must not be transmitted');
  assert.match(translated.failure,/A failed paragraph/);assert.equal(translated.lines,2);assert.equal(translated.breaks,1);
  checks.push('timeline metadata and Chinese technical headings remain unchanged; translation-only creates no duplicate layout nodes');
  checks.push('inline formats, links, code, native child order, explicit line breaks and original element identities survive translation');
  for(const selector of Object.keys(initial.styles)){
    const after=await cdp.evaluate(page,`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(node),r=node.getBoundingClientRect();return {width:r.width,height:r.height,padding:s.padding,border:s.border,background:s.backgroundColor,order:s.order,gridColumn:s.gridColumn,font:s.font,fontStyle:s.fontStyle,letterSpacing:s.letterSpacing}})()`);
    for(const key of ['padding','border','background','order','gridColumn','font','fontStyle','letterSpacing'])assert.equal(after[key],initial.styles[selector][key],`${selector}: ${key}`);
    if(selector!=='#rich .accent')assert.equal(after.width,initial.styles[selector].width,`${selector}: width`);
    if(['#metadata','#english-heading','#native-button','#private-input'].includes(selector))assert.equal(after.height,initial.styles[selector].height,`${selector}: no artificial extra row`);
  }
  assert.equal(await cdp.evaluate(page,`(()=>{document.querySelector('#native-button').click();document.querySelector('#native-link').click();return window.nativeClicks===1&&window.linkClicks===1})()`),true);
  checks.push('native CSS, grid/flex placement, fixed table widths, metadata heights and original event listeners remain effective');
  const metrics=()=>fetch(fixture.url+'/metrics').then(r=>r.json());
  const beforeModes=(await metrics()).calls;
  for(const mode of ['original','bilingual','translated','original','bilingual','translated']){
    state=await rpc({type:'SET_DISPLAY_MODE',mode,expectedPresentationRevision:state.settings.presentationRevision});assert.equal(state.ok,true);
    await cdp.wait(page,`document.querySelector('#rich').dataset.clMode===${JSON.stringify(mode)}`);
    const result=await cdp.evaluate(page,`(()=>{const mode=${JSON.stringify(mode)};return {originalsRestored:window.originalTexts.every(([node,text])=>node.nodeValue===text),richIsChinese:/[\\u3400-\\u9fff]/.test(document.querySelector('#rich').textContent),unchangedCopies:document.querySelectorAll('#unchanged [data-clearling]').length,duplicates:document.querySelectorAll('#metadata [data-clearling],#mixed-title [data-clearling]').length,bilingual:document.querySelectorAll('#rich > [data-clearling=translation]').length,sourceChildIdentity:window.originalElements.every(({node,children})=>{const current=[...node.childNodes].filter(n=>n.nodeType!==1||!n.matches('[data-clearling]'));const kept=current.filter(n=>children.includes(n)),extra=current.filter(n=>!children.includes(n));return kept.length===children.length&&children.every((child,i)=>kept[i]===child)&&extra.every(n=>mode==='translated'&&node.id==='edge-punctuation'&&n.nodeType===3&&n.nodeValue==='。'&&n===node.lastChild)})}})()`);
    assert.equal(result.unchangedCopies,0);assert.equal(result.duplicates,0);assert.equal(result.sourceChildIdentity,true);
    assert.equal(result.bilingual,mode==='bilingual'?1:0);assert.equal(result.originalsRestored,mode!=='translated');
    if(mode==='translated')assert.equal(result.richIsChinese,true);
  }
  assert.equal((await metrics()).calls,beforeModes);
  checks.push('all three reading modes round-trip original nodes twice without new requests; unchanged translations never add a second copy');
  await cdp.evaluate(page,`window.removedEdge=document.querySelector('#edge-punctuation').lastChild;window.removedEdge.remove()`);
  await cdp.wait(page,`document.querySelector('#edge-punctuation').lastChild.nodeType===1`);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(await cdp.evaluate(page,`document.querySelector('#edge-punctuation').lastChild.nodeType`),1,'host removal of generated punctuation must not cause an insertion loop');
  checks.push('sentence punctuation outside the last inline tag uses a removable text boundary, preserves formatting and respects host removal');
  const sent=(await metrics()).inputs;assert.ok(sent.every(text=>!text.includes('private form sample')&&!text.includes('private hidden sample')&&!text.includes('JOB_PENDING')&&!text.includes('twenty minutes ago')));
  const whitespace=sent.find(text=>text.includes('generated page'));assert.ok(whitespace&&!whitespace.includes('\n'));
  checks.push('requests exclude private controls and metadata; normal-flow HTML indentation is collapsed before translation');
  await cdp.evaluate(page,`(()=>{const p=document.querySelector('#dynamic');p.firstChild.nodeValue='A newly supplied host paragraph must replace the previous translation source.'})()`);
  await cdp.wait(page,`document.querySelector('#dynamic').dataset.clPhase==='ready'&&/[\u3400-\u9fff]/.test(document.querySelector('#dynamic').textContent)`);
  state=await rpc({type:'SET_DISPLAY_MODE',mode:'original',expectedPresentationRevision:state.settings.presentationRevision});
  await cdp.wait(page,`document.querySelector('#dynamic').textContent==='A newly supplied host paragraph must replace the previous translation source.'`);
  state=await rpc({type:'SET_DISPLAY_MODE',mode:'translated',expectedPresentationRevision:state.settings.presentationRevision});
  await cdp.wait(page,ready('dynamic'));
  await cdp.evaluate(page,`(()=>{const p=document.querySelector('#dynamic');p.replaceChildren(document.createTextNode('A newly supplied host paragraph must replace the previous translation source.'))})()`);
  await cdp.wait(page,`document.querySelector('#dynamic').dataset.clPhase==='ready'&&/[\u3400-\u9fff]/.test(document.querySelector('#dynamic').textContent)`);
  await cdp.evaluate(page,`(()=>{const p=document.querySelector('#dynamic'),editor=document.createElement('div');editor.id='transferred-editor';editor.contentEditable='true';window.transferredText=p.firstChild;window.transferredValue=window.transferredText.nodeValue;editor.append(window.transferredText);document.querySelector('main').append(editor)})()`);
  await cdp.wait(page,`!document.querySelector('#dynamic').hasAttribute('data-cl-native')`);
  assert.equal(await cdp.evaluate(page,`window.transferredText.nodeValue===window.transferredValue&&window.transferredText.parentElement.id==='transferred-editor'`),true);
  await cdp.evaluate(page,`document.querySelector('#dynamic').append(document.createTextNode('A newly supplied host paragraph must replace the previous translation source.'))`);
  await cdp.wait(page,`document.querySelector('#dynamic').dataset.clPhase==='ready'&&/[\u3400-\u9fff]/.test(document.querySelector('#dynamic').textContent)`);
  checks.push('text transferred by the website into an editor is released without overwriting the editor content');
  state=await rpc({type:'SET_AUTOMATIC',value:false,expectedRevision:state.settings.revision});
  await cdp.wait(page,`document.querySelector('#dynamic').textContent==='A newly supplied host paragraph must replace the previous translation source.'`);
  checks.push('host text edits and same-text node replacement replan safely; disabling restores the latest host content');
  for(const width of [1100,390]){await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},page.sessionId);assert.equal(await cdp.evaluate(page,'document.documentElement.scrollWidth<=innerWidth+1'),true);}
  checks.push('desktop and narrow viewports do not overflow horizontally');
  const errors=cdp.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text);assert.deepEqual(errors,[]);
  const report={browser:kind,version:await cdp.evaluate(options,'chrome.runtime.getManifest().version'),realMV3:true,syntheticOnly:true,checks,time:new Date().toISOString()};
  await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/compatibility-${kind}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser){await browser.cdp.call('Browser.close').catch(()=>{});browser.cdp.close();}server.kill('SIGTERM');}
