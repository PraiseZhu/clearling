import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, loadCurrentExtension } from './browser-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const kind = process.argv[2] || 'chrome';
const server = spawn(process.execPath, ['scripts/fixture-server.mjs'], { cwd: root, env: { ...process.env, CLEARLING_FIXTURE_PORT: '0' }, stdio: ['ignore', 'pipe', 'ignore'] });
const line = await new Promise((resolve, reject) => { const reader = createInterface({ input: server.stdout }); const timer = setTimeout(() => reject(new Error('FIXTURE_START_TIMEOUT')), 5000); reader.once('line', value => { clearTimeout(timer); reader.close(); resolve(JSON.parse(value)); }); });
let browser, options;
const checks = [];
try {
  browser = await launchBrowser(kind, { profileName: `${kind}-qa-reading-v030` });
  const cdp = browser.cdp;
  const id = await loadCurrentExtension(cdp, path.resolve(root,process.env.CLEARLING_BUILD_DIR || 'dist'));
  options = await cdp.page(`chrome-extension://${id}/options.html`, { hidden: false });
  await cdp.wait(options, 'document.querySelector("#model")?.options.length>=6');
  const rpc = message => cdp.evaluate(options, `chrome.runtime.sendMessage(${JSON.stringify(message)})`, true);
  let state = await rpc({ type: 'GET_STATE' });
  if (state.settings.hasKey) throw new Error('QA_PROFILE_HAS_EXISTING_CONNECTION');
  state=await rpc({type:'SET_DISPLAY_MODE',mode:'bilingual',expectedPresentationRevision:state.settings.presentationRevision});
  const page = await cdp.page(`${line.url}/x-thread`, { hidden: false });
  await cdp.wait(page, '!!document.querySelector("#main-text")');
  const measure = `(()=>{const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,width:r.width,height:r.height}};return{feed:box(document.querySelector('.feed')),names:[...document.querySelectorAll('.username')].map(box),avatars:[...document.querySelectorAll('.avatar')].map(box),actions:[...document.querySelectorAll('.actions')].map(box),source:document.querySelector('#main-text').innerHTML,clamp:getComputedStyle(document.querySelector('#quote-text')).webkitLineClamp,sourceLink:document.querySelector('#source-link').getAttribute('href')}})()`;
  const before = await cdp.evaluate(page, measure);
  state = await rpc({ type: 'SAVE_CONNECTION', endpoint: line.url, apiKey: 'fixture', connectionKind: 'cindy', expectedRevision: state.settings.revision }); assert.equal(state.ok, true);
  const translated = selector => `!!document.querySelector(${JSON.stringify(selector)})?.nextElementSibling?.matches('[data-clearling][data-phase=ready]')`;
  try{await cdp.wait(page, translated('#main-text'));}catch(error){const current=await rpc({type:'GET_STATE'});console.log({visible:await cdp.evaluate(page,'({hidden:document.hidden,outputs:document.querySelectorAll("[data-clearling]").length,source:!!document.querySelector("#main-text")})'),configured:current.settings?.hasKey,revision:current.settings?.revision,metrics:await fetch(line.url+'/metrics').then(r=>r.json()),exceptions:cdp.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text)});throw error;}
  await cdp.wait(page, translated('#reply-text'));
  await cdp.evaluate(page, 'document.querySelector("#short").scrollIntoView()');
  await cdp.wait(page, translated('#short'));
  await cdp.wait(page, translated('#quote-text'));
  const after = await cdp.evaluate(page, measure);
  assert.equal(after.source, before.source); assert.equal(after.sourceLink, before.sourceLink); assert.equal(after.clamp, before.clamp);
  assert.equal(after.feed.width, before.feed.width);
  for (const key of ['names', 'avatars', 'actions']) for (let i = 0; i < before[key].length; i++) {
    assert.ok(Math.abs(after[key][i].width - before[key][i].width) <= 1, `${key} width changed`);
    assert.ok(Math.abs(after[key][i].height - before[key][i].height) <= 1, `${key} height changed`);
    assert.ok(Math.abs(after[key][i].x - before[key][i].x) <= 1, `${key} horizontal position changed`);
  }
  assert.equal(await cdp.evaluate(page, 'document.querySelectorAll(".username [data-clearling],.actions [data-clearling],nav [data-clearling],#editor [data-clearling],#chinese [data-clearling]").length'), 0);
  checks.push('X body/replies/short replies translate; names, avatars, columns and controls preserve geometry');
  await cdp.evaluate(page, 'document.querySelector("#inline").scrollIntoView()');
  await cdp.wait(page, translated('#inline'));
  assert.match(await cdp.evaluate(page, 'document.querySelector("#inline").nextElementSibling.textContent'), /cacheKey/);
  const inputs = (await (await fetch(`${line.url}/metrics`)).json()).inputs;
  assert.ok(inputs.some(text => text.includes('interactive link'))); assert.ok(!inputs.some(text => text.includes('cacheKey')));
  assert.ok(!inputs.some(text => text.includes('Private editable')));
  checks.push('inline sentence grouping, protected code and editor exclusion');
  const countBeforeRemoval = (await (await fetch(`${line.url}/metrics`)).json()).inputs.filter(s=>s.startsWith('An interactive link')).length;
  await cdp.evaluate(page, 'document.querySelector("#inline").nextElementSibling.remove()');
  await cdp.wait(page, translated('#inline'));
  assert.equal((await (await fetch(`${line.url}/metrics`)).json()).inputs.filter(s=>s.startsWith('An interactive link')).length, countBeforeRemoval);
  checks.push('host removal of translation restores from memory without another model call');
  await cdp.evaluate(page, 'document.querySelector("#recycled-text").scrollIntoView();window.addReply()');
  await cdp.wait(page, translated('#recycled-text'));
  await cdp.wait(page, translated('#added-reply'));
  checks.push('new replies past 2600 metadata nodes translate automatically');
  await cdp.evaluate(page, 'document.querySelector("#recycled-text").textContent="[SLOW] Old delayed source must never overwrite a new row."');
  for (let n = 0; n < 40; n++) { if ((await (await fetch(`${line.url}/metrics`)).json()).inputs.some(s => s.includes('[SLOW]'))) break; await new Promise(r => setTimeout(r, 50)); }
  await cdp.evaluate(page, 'document.querySelector("#recycled-text").textContent="The replacement reply is the only valid translation for this row."');
  await cdp.wait(page, 'document.querySelector("#recycled-text").nextElementSibling?.textContent.includes("replacement reply")');
  assert.equal(await cdp.evaluate(page, 'document.querySelector("#recycled").querySelectorAll("[data-clearling]").length'), 1);
  checks.push('virtualized node reuse rejects stale asynchronous output');
  await cdp.evaluate(page, '(()=>{const source=document.querySelector("#recycled-text");const holder=document.createElement("div");holder.id="moved-holder";holder.className="content";source.parentElement.parentElement.append(holder);holder.append(source)})()');
  await cdp.wait(page, 'document.querySelector("#moved-holder > [data-testid=tweetText]")?.nextElementSibling?.matches("[data-clearling]")');
  assert.equal(await cdp.evaluate(page, 'document.querySelectorAll("#recycled [data-clearling]").length'), 1);
  checks.push('moving an unchanged source reparents the translation without duplicate output');
  await cdp.evaluate(page, '(()=>{const source=document.querySelector("#recycled-text");source.textContent="[SLOW] Public text before it becomes an editable draft."})()');
  for (let n = 0; n < 40; n++) { if ((await (await fetch(`${line.url}/metrics`)).json()).inputs.some(s => s.includes('before it becomes'))) break; await new Promise(r => setTimeout(r, 50)); }
  await cdp.evaluate(page, 'document.querySelector("#recycled-text").setAttribute("contenteditable","true")');
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(await cdp.evaluate(page, 'document.querySelectorAll("#moved-holder [data-clearling]").length'), 0);
  checks.push('in-flight output never enters content that became editable');
  const metricsBefore = (await (await fetch(`${line.url}/metrics`)).json()).inputs.filter(s=>s.startsWith('A reliable translator')).length;
  const load = cdp.event('Page.loadEventFired', page.sessionId); await cdp.call('Page.reload', {}, page.sessionId); await load;
  await cdp.evaluate(page, 'history.scrollRestoration="manual";window.scrollTo(0,0)');
  await cdp.wait(page, translated('#main-text'));
  assert.equal((await (await fetch(`${line.url}/metrics`)).json()).inputs.filter(s=>s.startsWith('A reliable translator')).length, metricsBefore);
  checks.push('warm first screen makes no new API call');
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  for (const width of [1280, 390]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 }, page.sessionId);
    await cdp.evaluate(page, 'window.scrollTo(0,0)');
    const geometry = await cdp.evaluate(page, '({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})'); assert.ok(geometry.scrollWidth <= geometry.width + 1);
    const image = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId);
    await writeFile(path.join(root, 'artifacts', `reading-${kind}-${width}.png`), Buffer.from(image.data, 'base64'));
  }
  checks.push('desktop and narrow layout have no horizontal overflow');
  await cdp.call('Page.navigate', { url: `${line.url}/article` }, page.sessionId);
  await cdp.wait(page, 'document.querySelector("#first")?.nextElementSibling?.dataset.phase==="ready"');
  await cdp.evaluate(page, 'document.querySelector("#table-cell").scrollIntoView()');
  await cdp.wait(page, '!!document.querySelector("#table-cell [data-clearling]")');
  assert.equal(await cdp.evaluate(page, 'document.querySelector("#table-row").children.length'), 2);
  checks.push('generic article and table behavior remains correct');
  const contexts = cdp.events.filter(e => e.method === 'Runtime.executionContextCreated' && e.sessionId === page.sessionId && e.params.context.auxData?.type === 'isolated').reverse();
  let contentContext;
  for (const event of contexts) {
    try { const probe = await cdp.call('Runtime.evaluate', { contextId: event.params.context.id, expression: 'globalThis.__clearlingStarted===true', returnByValue: true }, page.sessionId); if (probe.result.value) { contentContext = event.params.context.id; break; } } catch {}
  }
  assert.ok(contentContext, 'real isolated content-script context must exist');
  await cdp.call('Runtime.evaluate', { contextId: contentContext, expression: 'globalThis.__testTransport=chrome.runtime.sendMessage;globalThis.__testCalls={translate:0,state:0};chrome.runtime.sendMessage=async m=>{if(m.type==="TRANSLATE")__testCalls.translate++;if(m.type==="GET_STATE")__testCalls.state++;throw new Error("Disconnected test transport")};', returnByValue: true }, page.sessionId);
  await cdp.evaluate(page, 'document.querySelector("#first").scrollIntoView();document.querySelector("#first").firstChild.nodeValue+=" A public reconnection test."');
  await new Promise(resolve => setTimeout(resolve, 1250));
  const disconnected = await cdp.call('Runtime.evaluate', { contextId: contentContext, expression: 'globalThis.__testCalls', returnByValue: true }, page.sessionId);
  assert.ok(disconnected.result.value.translate <= 2 && disconnected.result.value.state <= 2, JSON.stringify(disconnected.result.value));
  await cdp.call('Runtime.evaluate', { contextId: contentContext, expression: 'chrome.runtime.sendMessage=globalThis.__testTransport;document.dispatchEvent(new Event("visibilitychange"))', returnByValue: true }, page.sessionId);
  await cdp.wait(page, 'document.querySelector("#first")?.nextElementSibling?.textContent.includes("reconnection test")');
  checks.push('transport disconnection backs off and resumes without request storms');
  const report = { version: await cdp.evaluate(options, 'chrome.runtime.getManifest().version'), browser: kind, extensionId: id, checks, syntheticOnly: true, time: new Date().toISOString() };
  await writeFile(path.join(root, 'artifacts', `reading-${kind}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  if (options && browser) await browser.cdp.evaluate(options, '(async()=>{const s=await chrome.runtime.sendMessage({type:"GET_STATE"});if(s.settings?.hasKey)await chrome.runtime.sendMessage({type:"CLEAR_CONNECTION",expectedRevision:s.settings.revision});await chrome.runtime.sendMessage({type:"CLEAR_CACHE"})})()', true).catch(() => {});
  if (browser) { await browser.cdp.call('Browser.close').catch(() => {}); browser.cdp.close(); }
  server.kill('SIGTERM');
}
