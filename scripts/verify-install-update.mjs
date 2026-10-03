import assert from 'node:assert/strict';
import {cp,mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {launchBrowser,loadCurrentExtension} from './browser-runtime.mjs';
import {updateInstalled} from './update-installed.mjs';
const browserKind=process.argv[2]||'chrome';
const directory=await mkdtemp(path.join(os.tmpdir(),'clearling-install-qa-'));
let browser;
try{
 const baseline='/Users/praise/AI-Agent/Claude/projects/Project Clearling/artifacts/clearling-0.4.0';
 await cp(baseline,directory,{recursive:true});
 browser=await launchBrowser(browserKind,{profileName:`${browserKind}-qa-install-v050-${Date.now().toString(36)}`});const cdp=browser.cdp;
 const setup=await cdp.page('chrome://extensions/',{hidden:false});await cdp.wait(setup,'!!chrome.developerPrivate');await cdp.evaluate(setup,'chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})',true);
 const id=await loadCurrentExtension(cdp,directory),options=await cdp.page(`chrome-extension://${id}/options.html`,{hidden:false});await cdp.wait(options,'document.querySelector("#model")?.options.length>0');
 await cdp.evaluate(options,`(async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});if(s.settings.hasKey)throw new Error('QA_PROFILE_CONFIGURED');return chrome.runtime.sendMessage({type:'SAVE_CONNECTION',endpoint:'https://example.invalid',apiKey:'synthetic-install-fixture',connectionKind:'cindy',expectedRevision:s.settings.revision});})()`,true);
 await cp(path.resolve(process.env.CLEARLING_BUILD_DIR||'dist'),directory,{recursive:true,force:true});
 const result=await updateInstalled({browser:browserKind,id,activateFast:true,opener:async url=>{await cdp.page(url,{hidden:false});}});
 assert.equal(result.version,'0.5.0');assert.equal(result.readingEngine,'bing');assert.equal(result.aiConnectionPreserved,true);assert.equal(result.aiModelPreserved,true);assert.equal(result.translation.readyCount,3);
 const report={browser:browserKind,version:result.version,normalReload:true,nonceOriginHandshake:true,readingEngine:result.readingEngine,aiConnectionPreserved:result.aiConnectionPreserved,aiModelPreserved:result.aiModelPreserved,realProvider:true,publicInputsOnly:true,translation:result.translation,time:new Date().toISOString()};
 await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/install-update-qa-${browserKind}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser){await browser.cdp.call('Browser.close').catch(()=>{});browser.cdp.close();}await rm(directory,{recursive:true,force:true});}
