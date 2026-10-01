import assert from 'node:assert/strict';
import {cp,mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {launchBrowser,loadCurrentExtension} from './browser-runtime.mjs';
const kind=process.argv[2]||'chrome';
const baseline=process.argv[3]||'/tmp/clearling-v030-baseline/dist';
const directory=await mkdtemp(path.join(os.tmpdir(),'clearling-upgrade-'));
let browser,options;
try {
 await cp(baseline,directory,{recursive:true});browser=await launchBrowser(kind,{profileName:`${kind}-qa-upgrade-v030`});const cdp=browser.cdp;
 const id=await loadCurrentExtension(cdp,directory);options=await cdp.page(`chrome-extension://${id}/options.html`,{hidden:false});await cdp.wait(options,'document.querySelector("#model")?.options.length===6');
 const before=await cdp.evaluate(options,'chrome.runtime.getManifest().version');assert.equal(before,'0.2.1');
 await cdp.evaluate(options,'(async()=>{const s=await chrome.runtime.sendMessage({type:"GET_STATE"});if(s.settings.hasKey)throw new Error("QA_PROFILE_HAS_EXISTING_CONNECTION");return chrome.runtime.sendMessage({type:"SAVE_CONNECTION",endpoint:"https://example.invalid",apiKey:"synthetic-upgrade-fixture",connectionKind:"cindy",expectedRevision:s.settings.revision})})()',true);
 const manager=await cdp.page('chrome://extensions/',{hidden:false});await cdp.wait(manager,'!!chrome.developerPrivate');await cdp.evaluate(manager,'chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})',true);
 await cp(path.resolve('dist'),directory,{recursive:true,force:true});
 const updated=await cdp.page(`chrome-extension://${id}/options.html?update=030`,{hidden:false}).catch(()=>null);
 const info=`new Promise(resolve=>chrome.developerPrivate.getExtensionInfo(${JSON.stringify(id)},e=>resolve(e?.version)))`;
 const end=Date.now()+15000;let version;
 while(Date.now()<end){version=await cdp.evaluate(manager,info,true);if(version==='0.3.0')break;await new Promise(r=>setTimeout(r,100));}
 if(version!=='0.3.0'){console.log({version,disk:JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8')).version,info:await cdp.evaluate(manager,`new Promise(resolve=>chrome.developerPrivate.getExtensionInfo(${JSON.stringify(id)},e=>resolve({version:e?.version,state:e?.state,disableReasons:e?.disableReasons})))`,true),ui:updated?await cdp.evaluate(updated,'({scripts:[...document.scripts].map(s=>s.src),notice:document.querySelector("#notice")?.textContent,display:document.querySelector("#display-mode")?.value})').catch(()=>null):null,errors:cdp.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text)});}
 // Inspect loaded runtime separately from potentially stale developer metadata.
 options=await cdp.page(`chrome-extension://${id}/options.html?verify=030`,{hidden:false});
 await cdp.wait(options,'!!document.querySelector("#display-mode")');
 console.log({loadedVersion:await cdp.evaluate(options,'chrome.runtime.getManifest().version')});
 assert.equal(version,'0.3.0');
 options=await cdp.page(`chrome-extension://${id}/options.html`,{hidden:false});await cdp.wait(options,'document.querySelector("#display-mode")?.value==="translated"');
 const state=await cdp.evaluate(options,'(async()=>{const r=await chrome.runtime.sendMessage({type:"GET_STATE"});return {hasKey:r.settings.hasKey,model:r.settings.selection.modelId,mode:r.settings.displayMode}})()',true);
 assert.equal(state.hasKey,true);assert.equal(state.model,'xiaomi/mimo-v2.6-flash');
 const report={browser:kind,before,after:version,configuredKeyPreserved:state.hasKey,modelPreserved:state.model,mode:state.mode,syntheticOnly:true,method:'options build-version check invokes normal runtime.reload',time:new Date().toISOString()};
 await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/upgrade-${kind}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 if(browser&&options)await browser.cdp.evaluate(options,'(async()=>{const s=await chrome.runtime.sendMessage({type:"GET_STATE"});if(s.settings?.hasKey)await chrome.runtime.sendMessage({type:"CLEAR_CONNECTION",expectedRevision:s.settings.revision})})()',true).catch(()=>{});
 if(browser){await browser.cdp.call('Browser.close').catch(()=>{});browser.cdp.close();}await rm(directory,{recursive:true,force:true});
}
