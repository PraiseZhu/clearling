import assert from 'node:assert/strict';
import http from 'node:http';
import {cp,mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {launchBrowser,loadCurrentExtension} from './browser-runtime.mjs';
const kind=process.argv[2]||'chrome';
const baseline=process.argv[3]||'/Users/praise/AI-Agent/Claude/projects/Project Clearling/artifacts/clearling-0.4.0';
const build=path.resolve(process.env.CLEARLING_BUILD_DIR||'dist');
const expected=JSON.parse(await readFile(path.join(build,'manifest.json'))).version;
const directory=await mkdtemp(path.join(os.tmpdir(),'clearling-upgrade-'));
let credentialMatched=false,browser,options;
const server=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.writeHead(204);res.end();return;}
 credentialMatched=req.headers.authorization==='Bearer synthetic-upgrade-fixture';
 if(!credentialMatched){res.writeHead(401);res.end('{}');return;}
 const chunks=[];for await(const c of req)chunks.push(c);
 const input=JSON.parse(Buffer.concat(chunks)),data=JSON.parse(input.messages[1].content);
 const content=JSON.stringify({translations:data.blocks.map(b=>({id:b.id,text:'验证成功后才保存更改。'}))});
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({clearling_test_provider:true,choices:[{message:{content}}]}));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const endpoint=`http://127.0.0.1:${server.address().port}`;
try{
 await cp(baseline,directory,{recursive:true});browser=await launchBrowser(kind,{profileName:`${kind}-qa-upgrade-v050-${Date.now().toString(36)}`});const cdp=browser.cdp;
 const setup=await cdp.page('chrome://extensions/',{hidden:false});await cdp.wait(setup,'!!chrome.developerPrivate');await cdp.evaluate(setup,'chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})',true);
 const id=await loadCurrentExtension(cdp,directory);options=await cdp.page(`chrome-extension://${id}/options.html`,{hidden:false});await cdp.wait(options,'document.querySelector("#model")?.options.length>0');
 const rpc=(page,m)=>cdp.evaluate(page,`chrome.runtime.sendMessage(${JSON.stringify(m)})`,true);
 const before=await cdp.evaluate(options,'chrome.runtime.getManifest().version');assert.equal(before,'0.4.0');
 let state=await rpc(options,{type:'GET_STATE'});assert.equal(state.settings.hasKey,false);assert.ok(!('readingEngine' in state.settings));
 state=await rpc(options,{type:'SAVE_CONNECTION',endpoint,apiKey:'synthetic-upgrade-fixture',connectionKind:'cindy',expectedRevision:state.settings.revision});
 state=await rpc(options,{type:'SET_AUTOMATIC',value:false,expectedRevision:state.settings.revision});
 state=await rpc(options,{type:'SET_DISPLAY_MODE',mode:'bilingual',expectedPresentationRevision:state.settings.presentationRevision});
 const model=state.settings.selection.modelId;
 const manager=await cdp.page('chrome://extensions/',{hidden:false});await cdp.wait(manager,'!!chrome.developerPrivate');
 await cp(build,directory,{recursive:true,force:true});
 await cdp.page(`chrome-extension://${id}/options.html?upgrade=050`,{hidden:false});
 await cdp.wait(manager,`(async()=>{const r=await new Promise(resolve=>chrome.developerPrivate.getExtensionInfo(${JSON.stringify(id)},resolve));return r?.version===${JSON.stringify(expected)} && r.state==='ENABLED';})()`,20000);
 options=await cdp.page(`chrome-extension://${id}/options.html`,{hidden:false});try{await cdp.wait(options,'document.querySelector("#model")?.options.length>0 && document.querySelector("#connection-status")?.textContent.includes("AI")',20000);}catch(e){console.log(await cdp.evaluate(options,'({version:chrome.runtime?.getManifest?.().version,modelCount:document.querySelector("#model")?.options.length,status:document.querySelector("#connection-status")?.textContent,notice:document.querySelector("#notice")?.textContent,engine:document.querySelector("#reading-engine")?.value})'));throw e;}
 state=await rpc(options,{type:'GET_STATE'});assert.equal(state.settings.readingEngine,'ai');assert.equal(state.settings.selection.modelId,model);assert.equal(state.settings.hasKey,true);assert.equal(state.settings.displayMode,'bilingual');assert.equal(state.settings.automatic,false);
 const result=await rpc(options,{type:'TEST_MODEL',selection:state.settings.selection,text:'Changes are saved only after validation succeeds.'});assert.equal(result.ok,true);assert.equal(result.synthetic,true);assert.equal(credentialMatched,true);
 state=await rpc(options,{type:'SET_READING_ENGINE',engine:'bing',expectedRevision:state.settings.revision});assert.equal(state.settings.hasKey,true);assert.equal(state.settings.selection.modelId,model);assert.equal(state.settings.displayMode,'bilingual');assert.equal(state.settings.automatic,false);
 const report={browser:kind,before,after:expected,configuredCredentialPreserved:credentialMatched,modelPreserved:true,displayModePreserved:true,automaticPreserved:true,legacyEngine:'ai',fastEngineSwitch:'bing',syntheticOnly:true,method:'normal options build-version reload and authenticated synthetic connection check',time:new Date().toISOString()};
 await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/upgrade-${kind}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser){await browser.cdp.call('Browser.close').catch(()=>{});browser.cdp.close();}server.closeAllConnections();server.close();await rm(directory,{recursive:true,force:true});}
