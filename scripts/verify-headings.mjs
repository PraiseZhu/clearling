import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, loadCurrentExtension } from './browser-runtime.mjs';

const kind = process.argv[2] || 'chrome', baseline = process.argv.includes('--baseline');
const server = spawn(process.execPath, ['scripts/fixture-server.mjs'], { env: { ...process.env, CLEARLING_FIXTURE_PORT: '0', CLEARLING_FIXTURE_CHINESE: '1' }, stdio: ['ignore','pipe','inherit'] });
const fixture = await new Promise((resolve, reject) => {
  const reader = createInterface({ input: server.stdout });
  const timer = setTimeout(() => reject(new Error('FIXTURE_START_TIMEOUT')), 5000);
  reader.once('line', line => { clearTimeout(timer); reader.close(); resolve(JSON.parse(line)); });
});
const cases = [
  { route: 'headings', ids: ['main-title','short-title','概要','%E3%81%AF%E3%81%98%E3%82%81%E3%81%AB','flex-title','grid-title','role-title','nav-toc','encoded-toc','literal-encoded-toc','aside-toc','nested-toc','class-toc','toc-label'], excluded: ['site-link','non-heading-link','header-metadata','chinese-title','preserved-title','editable-title','hidden-title','aside-profile','external-toc','missing-toc','private-toc','preserved-toc','menu-toc','footer-heading','footer-toc'] },
  { route: 'title-cards', ids: ['plain-card-title','plain-card-summary','outer-title','mixed-card-summary','long-title'], excluded: ['mixed-card-title'] }
];
let browser, options;
const checks = [], observations = [];
try {
  browser = await launchBrowser(kind, { profileName: `${kind}-qa-headings-${Date.now().toString(36)}` });
  const cdp = browser.cdp, id = await loadCurrentExtension(cdp, path.resolve(process.env.CLEARLING_BUILD_DIR || 'dist'));
  options = await cdp.page(`chrome-extension://${id}/options.html`, { hidden: false });
  await cdp.wait(options, '!!document.querySelector("#reading-engine")');
  const rpc = message => cdp.evaluate(options, `chrome.runtime.sendMessage(${JSON.stringify(message)})`, true);
  let state = await rpc({ type: 'GET_STATE' });
  assert.equal(state.settings.hasKey, false, 'only a fresh isolated profile may be used');
  state = await rpc({ type: 'SET_READING_ENGINE', engine: 'ai', expectedRevision: state.settings.revision });
  state = await rpc({ type: 'SAVE_CONNECTION', endpoint: fixture.url, apiKey: 'fixture', connectionKind: 'cindy', expectedRevision: state.settings.revision });
  assert.equal(state.ok, true);
  const ready = id => `document.getElementById(${JSON.stringify(id)})?.dataset.clPhase==='ready'`;
  const metrics = () => fetch(`${fixture.url}/metrics`).then(r => r.json());
  await mkdir('artifacts', { recursive: true });
  for (const sample of cases) {
    state = await rpc({ type: 'SET_AUTOMATIC', value: false, expectedRevision: state.settings.revision });
    const page = await cdp.page(`${fixture.url}/${sample.route}`, { hidden: false });
    await cdp.wait(page, `!!document.getElementById(${JSON.stringify(sample.ids[0])})`);
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    await cdp.evaluate(page, `(() => {
      for (const id of ['slow-title','failed-title','slow-card-title','failed-card-title']) { const e=document.getElementById(id); if(e)e.hidden=true; }
      window.headingProof=new Map(${JSON.stringify(sample.ids)}.map(id=>{
        const element=document.getElementById(id),walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),texts=[];let node;while(node=walker.nextNode())texts.push([node,node.nodeValue]);
        return [id,{element,texts,nodes:[element,...element.querySelectorAll('*')].map(node=>({node,parent:node.parentNode,children:[...node.childNodes]})),style:Object.fromEntries(['display','font','padding','border','gridTemplateColumns','gap'].map(key=>[key,getComputedStyle(element)[key]]))}];
      }));
      window.excludedProof=new Map(${JSON.stringify(sample.excluded)}.map(id=>[id,{element:document.getElementById(id),text:document.getElementById(id).textContent}]));
    })()`);
    const before = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId);
    await writeFile(`artifacts/headings-${kind}-${sample.route}-before.png`, Buffer.from(before.data, 'base64'));
    state = await rpc({ type: 'SET_AUTOMATIC', value: true, expectedRevision: state.settings.revision });
    if (baseline) {
      await cdp.wait(page, sample.route === 'headings' ? ready('article-body') : `!!document.querySelector('#plain-card-title [data-phase=ready],#plain-card-title+[data-phase=ready]')`);
      observations.push(await cdp.evaluate(page, `({route:${JSON.stringify(sample.route)},mainTitlePlanned:!!document.getElementById('main-title')?.dataset.clPhase,shortTitlePlanned:!!document.getElementById('short-title')?.dataset.clPhase,tocPlanned:!!document.getElementById('nav-toc')?.dataset.clPhase,cardOriginalVisible:document.getElementById('plain-card-title')?getComputedStyle(document.getElementById('plain-card-title')).display!=='none':null,cardProjectionCount:document.querySelectorAll('#plain-card-title>[data-clearling=translation]').length})`));
      const shot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId);
      await writeFile(`artifacts/headings-${kind}-${sample.route}-baseline.png`, Buffer.from(shot.data, 'base64'));
      await cdp.call('Target.closeTarget', { targetId: page.targetId });
      continue;
    }
    for (const id of sample.ids) {
      await cdp.evaluate(page, `document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center'})`);
      try { await cdp.wait(page, ready(id), 20000); }
      catch (error) { console.log({ failedId: id, diagnostics: await cdp.evaluate(options, `(async()=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===${JSON.stringify(fixture.url+'/'+sample.route)});return chrome.tabs.sendMessage(tab.id,{type:'GET_DIAGNOSTICS'})})()`, true), phase: await cdp.evaluate(page, `document.getElementById(${JSON.stringify(id)}).dataset.clPhase`)}); throw error; }
    }
    await cdp.wait(page, `![...document.querySelectorAll('[data-clearling]')].some(e=>e.dataset.phase==='pending')`);
    const callsBefore = (await metrics()).calls;
    for (const mode of ['translated','bilingual','original','translated']) {
      state = await rpc({ type: 'SET_DISPLAY_MODE', mode, expectedPresentationRevision: state.settings.presentationRevision });
      assert.equal(state.ok, true);
      await cdp.wait(page, `[...window.headingProof.values()].every(p=>p.element.dataset.clMode===${JSON.stringify(mode)})`);
      const proof = await cdp.evaluate(page, `(() => {
        const mode=${JSON.stringify(mode)};
        return [...window.headingProof].map(([id,p])=>({id,phase:p.element.dataset.clPhase,original:p.texts.every(([node,value])=>node.nodeValue===value),projectionCount:p.element.querySelectorAll(':scope>[data-clearling=translation]').length,visibleProjectionCount:[...p.element.querySelectorAll(':scope>[data-clearling=translation]')].filter(n=>!n.hidden).length,shape:p.nodes.every(({node,parent,children})=>{const kept=[...node.childNodes].filter(n=>n.nodeType!==1||!n.matches('[data-clearling]'));return node.parentNode===parent&&kept.length===children.length&&kept.every((child,i)=>child===children[i]);}),style:Object.fromEntries(Object.keys(p.style).map(key=>[key,getComputedStyle(p.element)[key]])),originalStyle:p.style}));
      })()`);
      for (const p of proof) {
        assert.equal(p.phase, 'ready', p.id);
        assert.equal(p.original, mode !== 'translated', `${p.id}: ${mode} source values`);
        assert.equal(p.projectionCount, mode === 'bilingual' ? 1 : 0, `${p.id}: no duplicated title in ${mode}`);
        assert.equal(p.visibleProjectionCount, mode === 'bilingual' ? 1 : 0, p.id);
        assert.equal(p.shape, true, `${p.id}: retain native elements and listeners`);
        // Grid track sizes may naturally change with translated text; its CSS
        // display, fonts and box decoration must remain owned by the website.
        for (const key of ['display','font','padding','border','gap']) assert.equal(p.style[key], p.originalStyle[key], `${p.id}: ${key}`);
      }
      observations.push({ route: sample.route, mode, verified: proof.length });
    }
    assert.equal((await metrics()).calls, callsBefore, 'mode switches reuse completed results');
    checks.push(`${sample.route}: only translation/original/bilingual honor mode without duplicate titles, source replacement or extra requests`);
    const excluded = await cdp.evaluate(page, `(()=>{return [...window.excludedProof].map(([id,p])=>({id,marked:p.element.hasAttribute('data-cl-native'),unchanged:id==='mixed-card-title'||p.element.textContent===p.text}));})()`);
    for (const item of excluded) { assert.equal(item.marked, false, item.id); assert.equal(item.unchanged, true, item.id); }
    checks.push(`${sample.route}: unrelated navigation, protected/editable/hidden text and nested title owners are excluded`);
    if (sample.route === 'headings') {
      assert.equal(await cdp.evaluate(page, `(()=>{const button=document.querySelector('#title-button');button.click();return window.titleClicks===1&&button.getBoundingClientRect().height>0&&document.querySelector('#heading-anchor').hash==='#flex-title'&&document.querySelector('#nav-toc').hash==='#short-title'&&document.querySelector('#toc-shell').childElementCount===1})()`), true);
      await cdp.evaluate(page, `(()=>{const heading=document.createElement('h2');heading.id='later-title';heading.textContent='A directory target arrives later';document.querySelector('#late-heading').append(heading)})()`);
      await cdp.wait(page, `${ready('later-title')}&&${ready('pending-toc')}`);
      await cdp.evaluate(page, `document.getElementById('later-title').id='renamed-title'`);
      await cdp.wait(page, `!document.getElementById('pending-toc').hasAttribute('data-cl-native')&&document.getElementById('pending-toc').textContent==='A directory target arrives later'`);
      await cdp.evaluate(page, `document.getElementById('pending-toc').href='#renamed-title'`);
      await cdp.wait(page, ready('pending-toc'));
      checks.push('directory links replan when target headings arrive or anchor IDs and hrefs change; native links and title controls remain usable');
      await cdp.evaluate(page, `document.querySelector('#grid-title div span').textContent='A changed heading from the website';document.querySelector('#body-link').href='#grid-title';document.querySelector('#body-link').textContent='Read a changed article link'`);
      await cdp.wait(page, `${ready('grid-title')}&&${ready('article-body')}`);
      await cdp.wait(page, `!document.querySelector('#grid-title div span').textContent.includes('A changed heading')&&!document.querySelector('#body-link').textContent.includes('Read a changed')`);
      state = await rpc({ type: 'SET_DISPLAY_MODE', mode: 'original', expectedPresentationRevision: state.settings.presentationRevision });
      await cdp.wait(page, `document.getElementById('grid-title').dataset.clMode==='original'`);
      assert.equal(await cdp.evaluate(page, `document.querySelector('#grid-title div span').textContent==='A changed heading from the website'&&document.querySelector('#body-link').textContent==='Read a changed article link'&&document.querySelector('#body-link').hash==='#grid-title'`), true);
      state = await rpc({ type: 'SET_DISPLAY_MODE', mode: 'translated', expectedPresentationRevision: state.settings.presentationRevision });
      await cdp.wait(page, `${ready('grid-title')}&&document.getElementById('grid-title').dataset.clMode==='translated'`);
      checks.push('website edits inside heading wrappers and ordinary article links are translated and restore the latest source');
    } else {
      assert.equal(await cdp.evaluate(page, `(()=>{document.querySelector('#plain-card').click();document.querySelector('#card-control').click();return window.cardClicks===1&&window.controlClicks===1&&document.querySelector('#card-control').textContent==='Open'&&document.querySelector('#card-link').hash==='#long-title'&&document.querySelector('#mixed-card-summary code').textContent==='cacheKey'})()`), true);
      checks.push('X card links, native controls, protected code and long article title grids remain intact');
    }
    for (const [slow, failed] of [sample.route === 'headings' ? ['slow-title','failed-title'] : ['slow-card-title','failed-card-title']]) {
      await cdp.evaluate(page, `document.getElementById(${JSON.stringify(slow)}).hidden=false;document.getElementById(${JSON.stringify(slow)}).scrollIntoView({block:'center'})`);
      await cdp.wait(page, `document.getElementById(${JSON.stringify(slow)}).dataset.clPhase==='pending'`);
      assert.equal(await cdp.evaluate(page, `document.getElementById(${JSON.stringify(slow)}).textContent.startsWith('[SLOW]')`), true);
      await cdp.wait(page, ready(slow));
      await cdp.evaluate(page, `document.getElementById(${JSON.stringify(failed)}).hidden=false;document.getElementById(${JSON.stringify(failed)}).scrollIntoView({block:'center'})`);
      await cdp.wait(page, `document.getElementById(${JSON.stringify(failed)}).dataset.clPhase==='failed'`);
      assert.equal(await cdp.evaluate(page, `document.getElementById(${JSON.stringify(failed)}).textContent.startsWith('[FAIL]')&&!document.getElementById(${JSON.stringify(failed)}).querySelector('[data-clearling]')`), true);
    }
    checks.push(`${sample.route}: pending and failed titles keep the original readable`);
    for (const width of [1100,390]) {
      await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sessionId);
      await cdp.evaluate(page, 'scrollTo(0,0)');
      assert.equal(await cdp.evaluate(page, 'document.documentElement.scrollWidth<=innerWidth+1'), true);
      const image = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId);
      await writeFile(`artifacts/headings-${kind}-${sample.route}-${width}-after.png`, Buffer.from(image.data, 'base64'));
    }
    checks.push(`${sample.route}: desktop and narrow reading have no horizontal overflow`);
    await cdp.call('Target.closeTarget', { targetId: page.targetId });
  }
  if (!baseline) {
    const inputs = (await metrics()).inputs;
    for (const text of ['Private editable','Private hidden','Unrelated author profile','Header metadata','Site navigation','Settings remain private','Menu entries','cacheKey','Open control']) assert.ok(!inputs.some(input=>input.includes(text)), text);
    checks.push('provider inputs exclude controls, protected values, private headings and unrelated navigation');
  }
  const report = { version: await cdp.evaluate(options, 'chrome.runtime.getManifest().version'), browser: kind, extensionId: id, realMV3: true, syntheticOnly: true, baseline, checks, observations, time: new Date().toISOString() };
  await writeFile(`artifacts/headings-${kind}${baseline ? '-baseline' : ''}.json`, JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  if (options && browser) await browser.cdp.evaluate(options, `(async()=>{const state=await chrome.runtime.sendMessage({type:'GET_STATE'});if(state.settings.hasKey)await chrome.runtime.sendMessage({type:'CLEAR_CONNECTION',expectedRevision:state.settings.revision});await chrome.runtime.sendMessage({type:'CLEAR_CACHE'})})()`, true).catch(()=>{});
  if (browser) { await browser.cdp.call('Browser.close').catch(()=>{}); browser.cdp.close(); }
  server.kill('SIGTERM');
}
