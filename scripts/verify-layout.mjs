import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, loadCurrentExtension } from './browser-runtime.mjs';

const kind = process.argv[2] || 'chrome';
const server = spawn(process.execPath, ['scripts/fixture-server.mjs'], { env: { ...process.env, CLEARLING_FIXTURE_PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
const fixture = await new Promise((resolve, reject) => {
  const reader = createInterface({ input: server.stdout });
  const timer = setTimeout(() => reject(new Error('FIXTURE_START_TIMEOUT')), 5000);
  reader.once('line', line => { clearTimeout(timer); reader.close(); resolve(JSON.parse(line)); });
});
let browser, options;
const checks = [];
try {
  browser = await launchBrowser(kind, { profileName: `${kind}-qa-layout-refinement` });
  const cdp = browser.cdp;
  const id = await loadCurrentExtension(cdp, path.resolve(process.env.CLEARLING_BUILD_DIR || 'dist'));
  options = await cdp.page(`chrome-extension://${id}/options.html`, { hidden: false });
  await cdp.wait(options, '!!document.querySelector("#model")?.options.length');
  const rpc = payload => cdp.evaluate(options, `chrome.runtime.sendMessage(${JSON.stringify(payload)})`, true);
  let state = await rpc({ type: 'GET_STATE' });
  assert.equal(state.settings.hasKey, false, 'only an unconfigured isolated profile may be used');
  state = await rpc({ type: 'SET_DISPLAY_MODE', mode: 'translated', expectedPresentationRevision: state.settings.presentationRevision });
  const page = await cdp.page(`${fixture.url}/article?layout`, { hidden: false });
  await cdp.wait(page, '!!document.querySelector("#first")');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sessionId);
  // All content below is synthetic and created by this test, never captured from
  // a user's page. Native event listeners verify that source ownership survives.
  await cdp.evaluate(page, String.raw`(() => {
    document.querySelector('main').innerHTML = '<style>\n.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.grid p{grid-column:2;margin:0}.flex{display:flex;gap:12px}.flex p{order:2;flex:0 0 65%;margin:0}.side{width:20%;height:24px}.box{padding:12px;border:2px solid #999;background:#eee}.hidden-source{display:none!important}\n</style><section class="grid"><p id="grid">A grid paragraph must stay in its assigned second column.</p></section><section class="flex"><p id="flex">A flex paragraph must preserve its width and ordering.</p><span class="side">42</span></section><p id="box" class="box">A decorated paragraph must retain its border and padding.</p><p id="media">The diagram is part of this explanation. <img id="diagram" width="42" height="42" alt="diagram" src="/icons/48.png"></p><p id="control-host">This paragraph will receive an interactive control after translation.</p><p id="visibility">This paragraph will be hidden by the host after translation.</p><ol><li id="numbered" value="10">A numbered step must retain its explicit list value.</li></ol><table><tr><td id="cell">Cell padding and borders belong to the host table.</td><td>123</td></tr></table><p id="protected">Keep this source annotation: <span translate="no">DO NOT CHANGE</span></p><div id="dynamic" hidden></div>';
    window.originalNodes = new Map([...document.querySelectorAll('main p, #numbered, #cell')].map(e => [e.id, [...e.childNodes]]));
    window.clickCount = 0;
    window.scrollTo(0,0);
  })()`);
  const geometry = selector => cdp.evaluate(page, `(() => { const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),s=getComputedStyle(e); return {x:r.x,width:r.width,padding:s.padding,border:s.border,background:s.backgroundColor,order:s.order,gridColumn:s.gridColumn,display:s.display}; })()`);
  const before = Object.fromEntries(await Promise.all(['#grid', '#flex', '#box', '#diagram', '#cell'].map(async selector => [selector, await geometry(selector)])));
  state = await rpc({ type: 'SET_READING_ENGINE', engine: 'ai', expectedRevision: state.settings.revision });
  state = await rpc({ type: 'SAVE_CONNECTION', endpoint: fixture.url, apiKey: 'fixture', connectionKind: 'cindy', expectedRevision: state.settings.revision });
  assert.equal(state.ok, true);
  const projection = selector => `(() => {const e=document.querySelector(${JSON.stringify(selector)});return e?.querySelector(':scope > [data-clearling=translation]') || (e?.nextElementSibling?.matches('[data-clearling=translation]') ? e.nextElementSibling : null)})()`;
  const ready = selector => `(${projection(selector)})?.dataset.phase==='ready'`;
  for (const selector of ['#grid', '#flex', '#box', '#media', '#control-host', '#visibility', '#numbered', '#cell', '#protected']) {
    await cdp.evaluate(page, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    await cdp.wait(page, ready(selector));
  }
  for (const selector of ['#grid', '#flex', '#box', '#diagram', '#cell']) {
    const after = await geometry(selector);
    assert.ok(Math.abs(after.x - before[selector].x) < 1, `${selector}: x changed`);
    assert.ok(Math.abs(after.width - before[selector].width) < 1, `${selector}: width changed`);
    for (const key of ['padding','border','background','order','gridColumn']) assert.equal(after[key], before[selector][key], `${selector}: ${key}`);
    assert.notEqual(after.display, 'none');
  }
  assert.equal(await cdp.evaluate(page, 'document.querySelector("#protected [translate=no]").textContent'), 'DO NOT CHANGE');
  assert.equal(await cdp.evaluate(page, `(${projection('#numbered')}).getAttribute('value')`), '10');
  checks.push('grid placement, flex width/order, box decoration, table cells, media and numbered lists retain native structure');

  const calls = async () => (await fetch(`${fixture.url}/metrics`).then(r => r.json())).calls;
  await cdp.wait(page, `![...document.querySelectorAll('[data-clearling=translation]')].some(e=>e.dataset.phase==='pending')`);
  const beforeControl = await calls();
  await cdp.evaluate(page, `(() => {const button=document.createElement('button');button.id='late-button';button.textContent='Click';button.onclick=()=>window.clickCount++;document.querySelector('#control-host').append(button)})()`);
  await cdp.wait(page, `document.querySelector('#control-host > [data-clearling=translation]')?.dataset.phase==='ready' && !document.querySelector('#control-host').hasAttribute('data-cl-source')`);
  assert.equal(await cdp.evaluate(page, `(()=>{const b=document.querySelector('#late-button');b.click();return b.getBoundingClientRect().width>0 && window.clickCount===1})()`), true);
  await cdp.evaluate(page, `document.querySelector('#late-button').remove()`);
  await cdp.wait(page, `document.querySelector('#control-host').hasAttribute('data-cl-source') && ${ready('#control-host')}`);
  assert.equal(await calls(), beforeControl);
  checks.push('adding and removing native controls replans placement without hiding the control or requesting another translation');

  await cdp.evaluate(page, `document.querySelector('#visibility').classList.add('hidden-source')`);
  await cdp.wait(page, `!(${projection('#visibility')}) && getComputedStyle(document.querySelector('#visibility')).display==='none'`);
  await cdp.evaluate(page, `document.querySelector('#visibility').classList.remove('hidden-source');document.querySelector('#visibility').scrollIntoView({block:'center'})`);
  await cdp.wait(page, ready('#visibility'));
  checks.push('host visibility changes remove stale projections and restore translation on reappearance');

  for (const width of [1100, 390]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    await cdp.evaluate(page, 'scrollTo(0,0)');
    assert.equal(await cdp.evaluate(page, 'document.documentElement.scrollWidth<=innerWidth+1'), true);
  }
  state = await rpc({ type: 'SET_DISPLAY_MODE', mode: 'original', expectedPresentationRevision: state.settings.presentationRevision });
  await cdp.wait(page, `![...document.querySelectorAll('[data-clearling=translation]')].some(e=>!e.hidden)`);
  assert.equal(await cdp.evaluate(page, `(()=>{for(const [id,nodes] of window.originalNodes){const current=[...document.getElementById(id).childNodes].filter(n=>n.nodeType!==1 || !n.matches('[data-clearling]'));if(nodes.length!==current.length || nodes.some((n,i)=>n!==current[i]))return false;}return true})()`), true);
  checks.push('narrow viewport has no horizontal overflow; original mode restores the same source nodes');

  const diagnostics = async () => cdp.evaluate(options, `(async()=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===${JSON.stringify(fixture.url+'/article?layout')});return chrome.tabs.sendMessage(tab.id,{type:'GET_DIAGNOSTICS'})})()`, true);
  const beforeOriginal = await calls(), initial = await diagnostics();
  await cdp.evaluate(page, `(()=>{const p=document.createElement('p');p.id='paused-source';p.textContent='This new paragraph should wait until translated reading resumes.';document.querySelector('main').prepend(p);scrollTo(0,0)})()`);
  const deadline = Date.now() + 3000;
  let scanned;
  do { scanned = await diagnostics(); if(scanned.records > initial.records) break; await new Promise(resolve => setTimeout(resolve, 50)); } while(Date.now() < deadline);
  assert.ok(scanned.records > initial.records, 'original mode must actually discover the paragraph');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await calls(), beforeOriginal);
  state = await rpc({ type: 'SET_DISPLAY_MODE', mode: 'translated', expectedPresentationRevision: state.settings.presentationRevision });
  await cdp.wait(page, ready('#paused-source'));
  assert.ok(await calls() > beforeOriginal);
  checks.push('original-only reading issues no new requests and switching back resumes queued paragraphs');

  const errors = cdp.events.filter(event => event.method === 'Runtime.exceptionThrown').map(event => event.params.exceptionDetails.text);
  assert.deepEqual(errors, []);
  await mkdir('artifacts', { recursive: true });
  const report = { browser: kind, checks, syntheticOnly: true, time: new Date().toISOString() };
  await writeFile(`artifacts/layout-${kind}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (options && browser) await browser.cdp.evaluate(options, `(async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});if(s.settings?.hasKey)await chrome.runtime.sendMessage({type:'CLEAR_CONNECTION',expectedRevision:s.settings.revision});await chrome.runtime.sendMessage({type:'CLEAR_CACHE'})})()`, true).catch(() => {});
  if (browser) { await browser.cdp.call('Browser.close').catch(() => {}); browser.cdp.close(); }
  server.kill('SIGTERM');
}
