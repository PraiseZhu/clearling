import { anchor, ownsView, disposeView, createView, renderRichText, present, isInteracting } from './content/presentation.mjs';
import { ViewportSchedule } from './content/scheduler.mjs';
import { translationReady } from './shared/core.mjs';
import { BODY_SELECTOR, CANDIDATE_SELECTOR, HEADING_SELECTOR, OWN, EXCLUDED, siteFor, planElement, articleTocLabel, sourceHash, splitSource, joinTranslations, sameTranslation, nativeFragmentPlan, joinNativeFragments } from './content/planner.mjs';
import { isProjectedMutation, isProjectedChildMutation, sameTextSlots, prepareNativeText, nativeTranslationText } from './content/source-text.mjs';

(() => {
  if (globalThis.__clearlingStarted) return;
  globalThis.__clearlingStarted = true;
  const records = new Map(), pending = new Set(), dirty = new Set(), jobs = [];
  const observed = new WeakSet();
  const shadowCandidates = new Set();
  const outputOwners = new WeakMap();
  let site = 'generic', settings = null, serial = 0, generation = 1, busy = 0;
  let scanScheduled = false, pumpTimer = null, reconnectTimer = null, reconnectAttempt = 0;
  let refreshToc = false;
  let lastUrl = location.href, originalOnly = false;
  let disconnected = false, syncing = null, port = null, requestSerial = 0;
  const requests = new Map(), viewport = new ViewportSchedule();
  const mode = () => !enabled() || originalOnly ? 'original' : settings?.displayMode || 'translated';
  function display(item,...args){
    try{present(item,...args);if(item.translation)outputOwners.set(item.translation,item);}
    catch(error){if(error.message!=='SOURCE_CHANGED')throw error;disposeView(item);item.renderedRevision=0;pending.add(item);enqueue(item.element);schedulePump();}
  }
  function view(item, phase, content) {
    const node = createView(item, () => { item.showOriginal = true; display(item, mode()); }, () => { item.failures=0;item.retryAt=0;item.results=[];item.renderedRevision=0;pending.add(item);display(item,mode(),'pending');schedulePump(); });
    outputOwners.set(node,item); display(item,mode(),phase,content);if(item.translation)outputOwners.set(item.translation,item);
  }
  function disconnect() {
    port = null;
    for (const request of requests.values()) request.resolve({ ok:false, code:'DISCONNECTED' });
    requests.clear();
  }
  function requestTranslation(payload, onTranslation, owners) {
    return new Promise(resolve => {
      try {
        if (!port) {
          port = chrome.runtime.connect({name:'clearling-reading'});
          port.onDisconnect.addListener(disconnect);
          port.onMessage.addListener(message => {
            const request=requests.get(message.requestId);if(!request)return;
            if(message.type==='RESULT')request.onTranslation(message.translation,message.revision);
            if(message.type==='DONE'){requests.delete(message.requestId);request.resolve(message);}
          });
        }
        const requestId=`r${++requestSerial}`;
        requests.set(requestId,{resolve,onTranslation,owners});
        port.postMessage({...payload,type:'SUBSCRIBE',requestId,priority:Math.min(...[...owners].map(priority))});
      } catch { disconnect();resolve({ok:false,code:'DISCONNECTED'}); }
    });
  }
  function reprioritize() {
    for(const [requestId,request] of requests) {
      const ranks=[...request.owners].filter(item=>records.get(item.element)===item && item.element.isConnected).map(priority);
      const rank=Math.min(...ranks);
      try {port?.postMessage({type:'UPDATE_PRIORITY',requestId,priority:Number.isFinite(rank)?rank:30000,distant:!Number.isFinite(rank)});}catch{}
    }
  }
  const diagnostics = { inspected: 0, scanMs: 0, rendered: 0, requests: 0, mutations: 0, nativeFragmentFallbacks: 0, lastError: null };
  const send = async payload => {
    try { return await chrome.runtime.sendMessage(payload); }
    catch { return { ok: false, code: 'DISCONNECTED' }; }
  };
  const enabled = () => settings?.automatic && translationReady(settings) && !settings.excludedSites.includes(location.hostname);
  const schedulePump = (delay = 25) => {
    if (pumpTimer) return;
    pumpTimer = setTimeout(() => { pumpTimer = null; void pump(); }, delay);
  };
  function remove(item) {
    disposeView(item); pending.delete(item); records.delete(item.element); intersection.unobserve(item.element);
    for(const [requestId,request] of requests)if(request.owners.delete(item) && !request.owners.size)try{port?.postMessage({type:'UNSUBSCRIBE',requestId});}catch{}
  }
  function mark(element) {
    if (!(element instanceof Element) || !element.isConnected) return;
    const plan = planElement(element, site), previous = records.get(element);
    diagnostics.inspected++;
    if (!plan) { if (previous) remove(previous); return; }
    if (previous?.identity === plan.identity) {
      const placementChanged = previous.placement !== plan.placement || previous.replaceable !== plan.replaceable || previous.sourceElement !== plan.sourceElement || previous.native !== plan.native
        || plan.native && (!sameTextSlots(previous.textSlots,plan.textSlots) || previous.rawIdentity !== plan.rawIdentity);
      if (previous.translation && (placementChanged || !ownsPlacement(previous))) { disposeView(previous); previous.renderedRevision = 0; pending.add(previous); }
      previous.placement = plan.placement;
      previous.replaceable = plan.replaceable;
      previous.sourceElement = plan.sourceElement;
      previous.native = plan.native; previous.textSlots = plan.textSlots; previous.sourceValues = plan.sourceValues; previous.rawIdentity = plan.rawIdentity; previous.protectedNodes = plan.protectedNodes;
      if (previous.translation) {
        const style=getComputedStyle(element);
        for(const key of ['fontSize','lineHeight','fontFamily','fontWeight','fontStyle','letterSpacing','color','textAlign','whiteSpace'])previous.translation.style[key]=style[key];
        display(previous,mode());
        if(previous.native && previous.phase==='ready' && mode()==='bilingual'){previous.renderedRevision=0;pending.add(previous);schedulePump();}
      }
      return;
    }
    const item = previous || { element, id: `b${++serial}`, translation: null, flight: null };
    if(previous) { for(const [requestId,request] of requests)if(request.owners.delete(item) && !request.owners.size)try{port?.postMessage({type:'UNSUBSCRIBE',requestId});}catch{} item.flight=null; }
    disposeView(item); item.phase=null;item.showOriginal=false;item.unchanged=false;item.nativeValues=null;item.nativeSuppressedEdges=null;item.nativeRetryPlan=null;item.nativeChunkPlan=null;
    Object.assign(item, plan, { hash: sourceHash(plan.identity), renderedRevision: 0, failures: 0, retryAt: 0, chunks: splitSource(plan.text), results: [] });
    records.set(element, item); pending.add(item); intersection.observe(element);
    if(enabled() && mode()==='translated' && Number.isFinite(priority(item)) && !isInteracting(item))view(item,'pending');
  }
  function enqueue(root) {
    if (!root || root.nodeType === 1 && root.closest(OWN)) return;
    for (const parent of dirty) if (parent === root || parent.contains?.(root)) return;
    for (const child of dirty) if (root.contains?.(child)) dirty.delete(child);
    dirty.add(root);
    if (!scanScheduled) { scanScheduled = true; setTimeout(scan, 0); }
  }
  function rescanToc() {
    refreshToc = false;
    for (const link of document.querySelectorAll('a[href*="#"]')) {
      enqueue(link);
      for (let node = link; node && node !== document.body; node = node.parentElement) {
        if (articleTocLabel(node.previousElementSibling)) enqueue(node.previousElementSibling);
      }
    }
  }
  function ownerFor(element) {
    const selector = site === 'x' ? BODY_SELECTOR : CANDIDATE_SELECTOR;
    const nearest = element.closest(selector);
    // A newly scanned anchor or title wrapper is not necessarily a record.
    // Website edits still belong to the paragraph/heading owning its text.
    for (let owner = nearest; owner; owner = owner.parentElement?.closest(selector)) {
      if (records.has(owner)) return owner;
    }
    return nearest;
  }
  function scan() {
    scanScheduled = false;
    if (site !== 'x') site = siteFor(document);
    const started = performance.now();
    for (const root of dirty) {
      if (root.nodeType === 1 && !root.isConnected) continue;
      if (site !== 'x' && (root.matches?.(HEADING_SELECTOR) || root.querySelector?.(HEADING_SELECTOR))) refreshToc = true;
      if(root.shadowRoot)observe(root.shadowRoot);
      else if(root.nodeType===1 && root.localName.includes('-') && shadowCandidates.size<200)shadowCandidates.add(root);
      const owner = root.nodeType === 1 ? ownerFor(root) : null;
      if (owner) mark(owner);
      if (site === 'x') {
        if(root.querySelectorAll)jobs.push(root.querySelectorAll(BODY_SELECTOR)[Symbol.iterator]());
      } else {
        jobs.push(document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode: element => element.matches(EXCLUDED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }));
        if (root.nodeType === 1 && root.matches(CANDIDATE_SELECTOR)) mark(root);
      }
    }
    dirty.clear();
    let count = 0;
    while (jobs.length && count < 160 && performance.now() - started < 7) {
      const element = jobs[0].nextNode ? jobs[0].nextNode() : jobs[0].next().value;
      if (!element) { jobs.shift(); continue; }
      count++;
      if (element.matches(site === 'x' ? BODY_SELECTOR : CANDIDATE_SELECTOR)) mark(element);
      if (element.shadowRoot) observe(element.shadowRoot);
      else if(element.localName.includes('-') && shadowCandidates.size<200)shadowCandidates.add(element);
    }
    diagnostics.scanMs += performance.now() - started;
    if (!jobs.length && refreshToc) {
      // Headings can arrive after their directory or change their anchor IDs.
      // Replan links without rescanning the rest of the article.
      rescanToc();
    }
    if ((jobs.length || dirty.size) && !scanScheduled) { scanScheduled = true; setTimeout(scan, 16); }
    schedulePump();
  }
  const observer = new MutationObserver(changes => {
    diagnostics.mutations += changes.length;
    let hadRemoval = false;
    for (const change of changes) {
      if (change.type === 'characterData' && isProjectedMutation(change.target,change.oldValue)) continue;
      const element = change.target.nodeType === 1 ? change.target : change.target.parentElement;
      if (!element || element.closest(OWN)) continue;
      if (change.type === 'attributes' || change.type === 'characterData') { if (change.attributeName === 'id') refreshToc = true; enqueue(element); continue; }
      const added=[...change.addedNodes].filter(node=>!isProjectedChildMutation(node,change.target,'add'));
      const removed=[...change.removedNodes].filter(node=>!isProjectedChildMutation(node,change.target,'remove'));
      const nodes = [...added,...removed];
      if(!nodes.length)continue;
      if (site !== 'x' && nodes.some(node => node.nodeType === 1 && (node.matches(HEADING_SELECTOR) || node.querySelector(HEADING_SELECTOR)))) refreshToc = true;
      if (nodes.length && nodes.every(node => node.nodeType === 1 && node.matches(OWN))) {
        for (const node of removed) {
          const item = outputOwners.get(node);
          if (item && records.get(item.element) === item && item.element.isConnected && item.translation === node) {
            if (item.native && !item.projectionAttached && !node.isConnected) continue;
            disposeView(item); item.renderedRevision = 0; pending.add(item); schedulePump();
          }
        }
        continue;
      }
      if (removed.length) hadRemoval = true;
      const owner = ownerFor(element);
      if (owner && (site === 'x' || records.has(owner))) enqueue(owner);
      for (const node of added) {
        if (node.nodeType === 1) enqueue(node);
        else if (node.nodeType === 3) enqueue(element);
      }
    }
    if (hadRemoval) for (const item of records.values()) if (!item.element.isConnected) remove(item);
    if (refreshToc && !scanScheduled && !jobs.length) rescanToc();
    if (location.href !== lastUrl) navigation();
  });
  function observe(root) {
    if (!root || observed.has(root)) return;
    observed.add(root);
    if(root instanceof ShadowRoot) {
      const style=document.createElement('style');style.dataset.clearling='style';
      style.textContent='[data-cl-source]{display:none!important}[data-clearling="translation"]{display:block;white-space:inherit;overflow-wrap:break-word;max-width:100%;box-sizing:border-box}[data-clearling="translation"][hidden]{display:none!important}td[data-clearling="translation"],th[data-clearling="translation"]{display:table-cell}li[data-clearling="translation"]{display:list-item}';
      root.append(style);
    }
    observer.observe(root, { childList: true, characterData: true, characterDataOldValue: true, subtree: true, attributes: true, attributeFilter: ['id', 'lang', 'translate', 'hidden', 'aria-hidden', 'data-testid', 'class', 'style', 'contenteditable', 'role', 'href', 'target', 'alt', 'data-block'] });
    enqueue(root);
  }
  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const item = records.get(entry.target);
      if (!item && entry.isIntersecting) mark(entry.target);
      if (item && entry.isIntersecting && item.renderedRevision !== settings?.revision) pending.add(item);
    }
    schedulePump();
  }, { rootMargin: '300% 0px' });
  function priority(item) {
    const element=anchor(item),rect=element.getBoundingClientRect();
    if(getComputedStyle(element).visibility==='hidden')return Infinity;
    return viewport.rank(rect,innerHeight);
  }
  function ownsPlacement(item) { return ownsView(item); }
  function render(item, revision, modelId) {
    if (records.get(item.element) !== item || !item.element.isConnected) return;
    const plan=planElement(item.element,site);
    if(!plan || plan.identity!==item.identity){enqueue(item.element);return;}
    if(item.placement!==plan.placement || item.replaceable!==plan.replaceable || item.sourceElement!==plan.sourceElement || item.native!==plan.native
      || plan.native && (!sameTextSlots(item.textSlots,plan.textSlots) || item.rawIdentity!==plan.rawIdentity))disposeView(item);
    item.placement=plan.placement;item.replaceable=plan.replaceable;item.sourceElement=plan.sourceElement;item.native=plan.native;
    item.textSlots=plan.textSlots;item.sourceValues=plan.sourceValues;item.rawIdentity=plan.rawIdentity;item.protectedNodes=plan.protectedNodes;
    if(isInteracting(item)){schedulePump(200);return;}
    const joined=item.nativeChunkPlan?joinNativeFragments(item.nativeChunkPlan,item.results):joinTranslations(item.chunks,item.results);
    const text=item.native?nativeTranslationText(joined):joined;
    const content=renderRichText(item,text);
    item.unchanged=sameTranslation(item.text,text,item.protectedValues);
    if (item.native && !item.unchanged) prepareNativeText(item,text);
    const readingAnchor=[...records.values()].find(record=>{const rect=anchor(record).getBoundingClientRect();return rect.top>=0 && rect.top<innerHeight;});
    const before=readingAnchor?anchor(readingAnchor).getBoundingClientRect().top:0;
    view(item,'ready',content);
    if(!item.translation)return;
    if(readingAnchor && performance.now()-viewport.lastScroll>160) {
      const shift=anchor(readingAnchor).getBoundingClientRect().top-before;
      if(Math.abs(shift)>1 && Math.abs(shift)<innerHeight)window.scrollBy(0,shift);
    }
    item.translation.dataset.model=modelId;item.translation.dataset.revision=String(revision);
    if(item.native){item.element.dataset.clModel=modelId;item.element.dataset.clRevision=String(revision);}
    item.renderedRevision=revision;item.failures=0;pending.delete(item);diagnostics.rendered++;
  }
  function retryNativeFragments(item,code){
    if(records.get(item.element)!==item||!item.element.isConnected)return false;
    if(!item.native||item.nativeRetryPlan||settings.readingEngine!=='bing'||!['RESPONSE_INCOMPLETE','PROTECTED_TEXT_MISSING'].includes(code))return false;
    const plan=nativeFragmentPlan(item);if(!plan)return false;
    item.nativeRetryPlan=plan;item.results=[];item.failures=0;item.retryAt=0;item.renderedRevision=0;
    pending.add(item);diagnostics.nativeFragmentFallbacks++;view(item,'pending');schedulePump();return true;
  }
  async function pump() {
    if (!enabled() || mode() === 'original' || disconnected || document.hidden) return;
    if(mode()==='translated')for(const item of pending)if(!item.translation && item.element.isConnected && Number.isFinite(priority(item)) && !isInteracting(item))view(item,'pending');
    if(busy>=8)return;
    const now = Date.now();
    if(records.size>600) {
      for(const item of records.values()){if(records.size<=450)break;if(!Number.isFinite(priority(item)) && !item.flight){remove(item);if(item.element.isConnected)intersection.observe(item.element);}}
    }
    const candidates = [...pending].filter(item => records.get(item.element) === item && !item.flight && item.element.isConnected && item.failures < 3 && item.retryAt <= now)
      .map(item => [item, priority(item)]).filter(([, rank]) => Number.isFinite(rank)).sort((a, b) => a[1] - b[1]).slice(0,100);
    if (!candidates.length) {
      const later = [...pending].filter(item => !item.flight && item.failures < 3 && item.retryAt > now && Number.isFinite(priority(item))).map(item => item.retryAt);
      if (later.length) schedulePump(Math.max(1, Math.min(...later) - now + 1));
      return;
    }
    const revision = settings.revision, runGeneration = generation;
    const modelId = settings.readingEngine === 'bing' ? 'microsoft-edge' : settings.selection.modelId;
    const batch = [], inFlight = [], owners = new Set(); let size = 0;
    const limit = 1800;
    const firstRank=candidates[0][1];
    // Keep one document subscription slot free so visible work can reach the
    // global gate even while three speculative requests are still pending.
    if(firstRank>=10000 && busy>=3)return;
    for (const [item, rank] of candidates) {
      if (batch.length >= 4 || size >= limit) break;
      if ((rank>=10000)!==(firstRank>=10000))break;
      const fragmentPlan=settings.readingEngine==='bing'?item.nativeRetryPlan:null;
      if(item.nativeChunkPlan!==fragmentPlan){item.nativeChunkPlan=fragmentPlan;item.chunks=fragmentPlan?fragmentPlan.chunks:splitSource(item.text);item.results=[];}
      if (item.chunks.every((_, i) => Boolean(item.results[i]))) { render(item, revision, modelId); continue; }
      for (let part = 0; part < item.chunks.length && batch.length < 4; part++) {
        if (item.results[part] != null) continue;
        if (batch.length && size + item.chunks[part].length > limit) break;
        const id = `${item.id}-p${part}`;
        batch.push({ id, text: item.chunks[part], sourceHash: item.hash, context: item.nativeChunkPlan ? `Native text slot ${item.hash}: ${document.title.slice(0,150)}` : site === 'x' ? 'Social media post or reply' : document.title.slice(0, 150) });
        inFlight.push({ id, item, part, hash: item.hash, identity: item.identity }); owners.add(item); size += item.chunks[part].length;
      }
    }
    if (!batch.length) return;
    const token = {};
    for (const item of owners) {item.flight=token;if(item.phase!=='ready' && mode()==='translated')view(item,'pending');}
    busy++; diagnostics.requests++; schedulePump();
    const started=performance.now();
    const response = await requestTranslation({ revision, generation, blocks: batch }, (value, responseRevision) => {
      if(responseRevision!==settings?.revision || generation!==runGeneration)return;
      const job=inFlight.find(j=>j.id===value.id);
      if(!job || records.get(job.item.element)!==job.item || job.item.hash!==job.hash || job.item.identity!==job.identity || !job.item.element.isConnected)return;
      job.item.results[job.part]=value.text;
      if(job.item.chunks.every((_,i)=>Boolean(job.item.results[i])))try {render(job.item,revision,modelId);}catch(error) {diagnostics.lastError=['SOURCE_CHANGED','RESPONSE_INCOMPLETE','PROTECTED_TEXT_MISSING'].includes(error.message)?error.message:'RENDER_FAILED';diagnostics.nativeMapping=error.nativeMapping||null;if(!retryNativeFragments(job.item,error.message)){job.item.failures++;job.item.results=[];job.item.retryAt=Date.now()+1500;view(job.item,'failed');}}
    }, owners);
    busy--;
    for(const item of owners)if(item.flight===token)item.flight=null;
    if(revision!==settings?.revision || runGeneration!==generation){for(const item of owners)if(records.get(item.element)===item && item.element.isConnected)pending.add(item);schedulePump();return;}
    if(response.ok && response.revision===revision) {
      viewport.completed(performance.now()-started);
    } else {
      diagnostics.lastError = response.code;
      if (response.code === 'DISCONNECTED') {
        disconnected = true;
        clearTimeout(pumpTimer); pumpTimer = null;
        for(const item of owners)if(item.element.isConnected && records.get(item.element)===item)view(item,'failed');
        scheduleReconnect(); return;
      }
      if (response.code === 'CONFIG_CHANGED') { void sync(); return; }
      if(response.code==='CANCELLED'){schedulePump();return;}
      const retry = response.retryAfterMs || 1500;
      for (const item of owners) { if(item.renderedRevision===revision)continue;if(retryNativeFragments(item,response.code))continue;item.failures++; if (['HTTP_401', 'HTTP_403', 'HTTP_400', 'HTTP_404'].includes(response.code)) item.failures = 3; item.retryAt = Date.now() + retry * Math.max(1, item.failures); if(item.element.isConnected && records.get(item.element)===item)view(item,'failed'); }
      schedulePump(retry);
    }
    schedulePump();
  }
  function apply(next) {
    const changed = settings && settings.revision !== next.revision;
    settings = next;
    if (changed) {
      generation++;
      for (const item of records.values()) { item.results = []; item.failures = 0; item.retryAt = 0; item.renderedRevision = 0; item.phase=null;item.showOriginal=false;item.unchanged=false;item.nativeValues=null;item.nativeSuppressedEdges=null;disposeView(item);pending.add(item); }
    }
    for (const item of records.values()) if (item.translation) display(item,mode());
    schedulePump();
  }
  function scheduleReconnect() {
    if (reconnectTimer || document.hidden) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; void sync(); }, Math.min(15000, 1000 * 2 ** Math.min(reconnectAttempt++, 4)));
  }
  function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      const response = await send({ type: 'GET_STATE' });
      if (response.ok) {
        disconnected = false; reconnectAttempt = 0;
        clearTimeout(reconnectTimer); reconnectTimer = null;
        for (const item of pending) { item.retryAt = 0; item.failures = 0; }
        apply(response.settings);
      } else { disconnected = true; scheduleReconnect(); }
    })().finally(() => { syncing = null; });
    return syncing;
  }
  function navigation() {
    lastUrl = location.href; generation++;
    for (const item of records.values()) { if (!item.element.isConnected) remove(item); else { item.failures = 0; item.retryAt = 0; enqueue(item.element); } }
    void sync();
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'CONFIG_CHANGED') { apply(message.settings); reply({ ok: true }); }
    if(message.type==='PRESENTATION_CHANGED'){if(settings){settings.displayMode=message.mode;settings.presentationRevision=message.presentationRevision;}for(const item of records.values()){item.showOriginal=false;if(item.translation)display(item,mode());}schedulePump();reply({ok:true});}
    if (message.type === 'SHOW_ORIGINAL') { originalOnly = Boolean(message.value); for (const item of records.values()) if (item.translation) display(item,mode()); schedulePump(); reply({ ok: true }); }
    if (message.type === 'RETRANSLATE') { for (const item of records.values()) { item.results = []; item.renderedRevision = 0; item.failures = 0; item.retryAt = 0; pending.add(item); enqueue(item.element); } schedulePump(); reply({ ok: true }); }
    if (message.type === 'GET_DIAGNOSTICS') reply({ ok: true, site, version: chrome.runtime.getManifest().version, records: records.size, pending: pending.size, busy, ...diagnostics });
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (location.href !== lastUrl) navigation(); void sync(); } });
  window.addEventListener('pageshow', () => { observe(document.body); void sync(); });
  window.addEventListener('pagehide', () => { port?.disconnect(); });
  setInterval(()=>{if(document.hidden)return;if(location.href!==lastUrl)navigation();for(const host of shadowCandidates){if(!host.isConnected)shadowCandidates.delete(host);else if(host.shadowRoot){observe(host.shadowRoot);shadowCandidates.delete(host);}}},1000);
  window.addEventListener('popstate', navigation); window.addEventListener('hashchange', navigation);
  window.addEventListener('scroll', () => { viewport.scroll(scrollY,performance.now());reprioritize();if (location.href !== lastUrl) navigation(); schedulePump(); }, { passive: true, capture: true });
  window.addEventListener('resize', () => { for (const item of records.values()) enqueue(item.element); schedulePump(); }, { passive: true });
  document.addEventListener('selectionchange',()=>schedulePump(200));
  document.addEventListener('focusout',()=>schedulePump(100));
  document.addEventListener('DOMContentLoaded', () => observe(document.body), { once: true });
  if (document.body) observe(document.body);
  void sync();
})();
