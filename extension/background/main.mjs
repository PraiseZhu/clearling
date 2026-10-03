import { availableProfiles, defaultSelection, getProfile, validateCustomProfile, validateSelection } from '../shared/profiles.mjs';
import { effectiveConfig, fingerprint, initialSettings, publicSettings, readingEngine, readingModelId, translationReady, safeError, validateBlocks } from '../shared/core.mjs';
import { TranslationCache } from './cache.mjs';
import { requestTranslation, requestMachineTranslation } from './provider.mjs';
import { RequestGate } from './request-gate.mjs';
import { TranslationService } from './translation-service.mjs';

let settings;
let writeQueue = Promise.resolve();
let latestIntent = 0;
const controllers = new Set();
const cache = new TranslationCache();
const translations = new TranslationService(cache);
const requestGate = new RequestGate();
const stats = { translated: 0, cacheHits: 0, apiCalls: 0, lastError: null };

const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  settings = (await chrome.storage.local.get('settings')).settings;
  if (!settings) { settings = initialSettings(); await chrome.storage.local.set({ settings }); }
  await chrome.alarms.create('cache-prune', { periodInMinutes: 1440 });
})();

function trusted(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string'
    && sender.url.startsWith(chrome.runtime.getURL(''));
}

function controller() {
  const c = new AbortController(); controllers.add(c);
  return c;
}

async function broadcast() {
  for (const c of controllers) c.abort();
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(t => chrome.tabs.sendMessage(t.id, { type: 'CONFIG_CHANGED', settings: publicSettings(settings) })));
  await chrome.action.setBadgeText({ text: translationReady(settings) ? '' : '?' });
  await chrome.action.setBadgeBackgroundColor({ color: '#a94a40' });
}

async function persist(candidate, expectedRevision, intent = null) {
  const operation = writeQueue.then(async () => {
    if (intent != null && intent !== latestIntent) throw new Error('STALE_SELECTION');
    if (expectedRevision !== settings.revision) throw new Error('CONFIG_CHANGED');
    const next = { ...candidate, displayMode: settings.displayMode || 'translated', presentationRevision: settings.presentationRevision || 1, revision: settings.revision + 1, updatedAt: Date.now() };
    try { await chrome.storage.local.set({ settings: next }); } catch { throw new Error('PERSISTENCE_FAILED'); }
    settings = next;
    await broadcast();
    return publicSettings(settings);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

function requireConnection(s = settings) {
  if (!s.endpoint) throw new Error('CONNECTION_MISSING');
  if (!s.apiKey) throw new Error('KEY_REQUIRED');
}

async function execute(config, key, blocks, c, beforeDispatch = () => {}, priority = () => 0) {
  return requestGate.run(config, async () => {
    beforeDispatch();
    stats.apiCalls++;
    return config.engine === 'bing' ? requestMachineTranslation(config, blocks, { signal: c.signal }) : requestTranslation(config, key, blocks, { signal: c.signal });
  }, c.signal, priority);
}

async function translate(message, sender, progress = {}) {
  if (!sender.tab || !/^https?:/.test(sender.url || '')) throw new Error('FORBIDDEN');
  if (readingEngine(settings) === 'ai') requireConnection();
  if (!settings.automatic || message.revision !== settings.revision) throw new Error('CONFIG_CHANGED');
  const hostname = new URL(sender.url).hostname;
  if (settings.excludedSites.includes(hostname)) throw new Error('FORBIDDEN');
  const revision = settings.revision;
  const snapshot = structuredClone(settings);
  const config = effectiveConfig(snapshot);
  const blocks = validateBlocks(message.blocks);
  const result = await translations.translate(config, blocks, {
    hostname, revision, private: Boolean(sender.tab.incognito), cacheDays: snapshot.cacheDays,
    isCurrent: () => revision === settings.revision && settings.automatic && settings.connectionId === snapshot.connectionId && !settings.excludedSites.includes(hostname),
    onCacheHit: () => { stats.cacheHits++; },
    signal: progress.signal, priority: progress.priority,
    onTranslation: progress.onTranslation,
    onDispatch: progress.onDispatch,
    dispatch: async (fresh, check, signal, priority, onDispatch) => {
      check(); const c = controller();
      const combined = { signal: AbortSignal.any([c.signal, signal]) };
      try { return await execute(config, snapshot.apiKey, fresh, combined, () => { check(); onDispatch(); }, priority); }
      finally { controllers.delete(c); }
    }
  });
  if (revision !== settings.revision) throw new Error('CONFIG_CHANGED');
  stats.translated += result.length;
  return { translations: result, revision, modelId: readingModelId(config), fingerprint: fingerprint(config) };
}

async function route(message, sender) {
  await ready;
  if (!message || sender.id !== chrome.runtime.id) throw new Error('FORBIDDEN');
  if (message.type === 'GET_STATE') return { settings: publicSettings(settings), profiles: availableProfiles(settings.customProfiles), stats };
  if (message.type === 'TRANSLATE') return translate(message, sender);
  if (!trusted(sender)) throw new Error('FORBIDDEN');
  if (message.type === 'SET_READING_ENGINE') {
    if (!['bing', 'ai'].includes(message.engine)) throw new Error('FORBIDDEN');
    const candidate = { ...settings, readingEngine: message.engine };
    // Choosing a previously paused engine is an explicit retry, without copying
    // the other engine's credentials or changing its model selection.
    const saved = await persist(candidate, message.expectedRevision);
    if (message.engine === 'bing' || settings.endpoint && settings.apiKey) requestGate.resume(effectiveConfig(settings));
    return { settings: saved };
  }
  if (message.type === 'SET_DISPLAY_MODE') {
    if (!['translated', 'bilingual', 'original'].includes(message.mode)) throw new Error('FORBIDDEN');
    const operation = writeQueue.then(async () => {
      if (message.expectedPresentationRevision !== (settings.presentationRevision || 1)) throw new Error('CONFIG_CHANGED');
      const next = { ...settings, displayMode: message.mode, presentationRevision: (settings.presentationRevision || 1) + 1 };
      try { await chrome.storage.local.set({ settings: next }); } catch { throw new Error('PERSISTENCE_FAILED'); }
      settings = next;
      await Promise.allSettled((await chrome.tabs.query({})).map(t => chrome.tabs.sendMessage(t.id, { type: 'PRESENTATION_CHANGED', mode: next.displayMode, presentationRevision: next.presentationRevision })));
      return { settings: publicSettings(settings) };
    });
    writeQueue = operation.catch(() => {}); return operation;
  }
  if (message.type === 'SAVE_CONNECTION') {
    const candidate = structuredClone(settings);
    const endpoint = String(message.endpoint || '').trim();
    effectiveConfig({ ...candidate, endpoint }, candidate.selection);
    const key = String(message.apiKey || candidate.apiKey).trim();
    if (!key || key.length > 4096) throw new Error('KEY_REQUIRED');
    if (!['cindy', 'native'].includes(message.connectionKind)) throw new Error('FORBIDDEN');
    candidate.endpoint = endpoint; candidate.apiKey = key; candidate.connectionKind = message.connectionKind;
    if (key !== settings.apiKey || endpoint !== settings.endpoint || candidate.connectionKind !== settings.connectionKind) {
      candidate.connectionRevision++; candidate.connectionId = crypto.randomUUID(); candidate.verification = {};
    }
    return { settings: await persist(candidate, message.expectedRevision) };
  }
  if (message.type === 'SELECT_MODEL') {
    const intent = ++latestIntent;
    const selection = validateSelection(message.selection, settings.customProfiles);
    const candidate = structuredClone(settings);
    const before = candidate.revision;
    candidate.selection = selection; candidate.modelPreferences[selection.modelId] = selection;
    if (candidate.endpoint && candidate.apiKey) {
      const c = controller();
      try {
        const sample = [{ id: 'check', text: 'Changes are saved only after validation succeeds.', sourceHash: 'public-check', context: 'Software interface' }];
        const config = effectiveConfig(candidate, selection);
        const check = await execute(config, candidate.apiKey, sample, c);
        if (!/[\u4e00-\u9fff]/.test(check.translations[0].text) || check.translations[0].text === sample[0].text) throw new Error('TRANSLATION_UNVERIFIED');
        candidate.verification[selection.modelId] = { state: check.synthetic ? 'synthetic_passed' : 'translation_passed', elapsedMs: check.elapsedMs, time: Date.now(), parameters: config.parameters };
      } finally { controllers.delete(c); }
    }
    if (before !== message.expectedRevision) throw new Error('CONFIG_CHANGED');
    return { settings: await persist(candidate, message.expectedRevision, intent) };
  }
  if (message.type === 'SET_AUTOMATIC') {
    return { settings: await persist({ ...settings, automatic: Boolean(message.value) }, message.expectedRevision) };
  }
  if (message.type === 'TOGGLE_SITE') {
    const hostname = new URL(message.url).hostname;
    if (!hostname || !/^https?:/.test(message.url)) throw new Error('FORBIDDEN');
    const sites = new Set(settings.excludedSites);
    if (sites.has(hostname)) sites.delete(hostname); else sites.add(hostname);
    return { settings: await persist({ ...settings, excludedSites: [...sites] }, message.expectedRevision) };
  }
  if (message.type === 'ADD_MODEL') {
    const profile = validateCustomProfile(message.profile);
    const list = settings.customProfiles.filter(p => p.id !== profile.id);
    if (list.length >= 20) throw new Error('MODEL_ID_INVALID');
    list.push(profile);
    return { settings: await persist({ ...settings, customProfiles: list }, message.expectedRevision) };
  }
  if (message.type === 'TEST_MODEL') {
    requireConnection();
    const config = effectiveConfig(settings, message.selection || settings.selection);
    if (message.type === 'TEST_MODEL') requestGate.resume(config);
    const c = controller();
    const text = String(message.text || '');
    if (text.length > 7000) throw new Error('BLOCKS_TOO_LARGE');
    const blocks = validateBlocks([{ id: 'sample', text, context: 'Public connection validation sample' }]);
    try { return { ...(await execute(config, settings.apiKey, blocks, c)), modelId: config.selection.modelId, selection: config.selection }; }
    finally { controllers.delete(c); }
  }
  if (message.type === 'CLEAR_CACHE') { await cache.clear(); return { cleared: true }; }
  if (message.type === 'CLEAR_CONNECTION') {
    return { settings: await persist({ ...settings, apiKey: '', endpoint: '', verification: {}, connectionRevision: settings.connectionRevision + 1, connectionId: crypto.randomUUID() }, message.expectedRevision) };
  }
  throw new Error('FORBIDDEN');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  route(message, sender).then(data => respond({ ok: true, ...data }), error => {
    const safe = safeError(error);
    if (!['CONFIG_CHANGED', 'CANCELLED', 'STALE_SELECTION'].includes(safe.code)) stats.lastError = safe;
    respond({ ok: false, ...safe });
  });
  return true;
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'clearling-reading' || port.sender?.id !== chrome.runtime.id || !port.sender.tab || !/^https?:/.test(port.sender.url || '')) { port.disconnect(); return; }
  const subscriptions = new Map(); let closed = false;
  const post = value => { if (!closed) try { port.postMessage(value); } catch {} };
  port.onDisconnect.addListener(() => { closed = true; for (const sub of subscriptions.values()) sub.controller.abort(); subscriptions.clear(); });
  port.onMessage.addListener(message => {
    const id = message?.requestId;
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) return;
    const current = subscriptions.get(id);
    if (message.type === 'UNSUBSCRIBE') { current?.controller.abort(); return; }
    if (message.type === 'UPDATE_PRIORITY') { if (current) { current.priority = Number.isFinite(message.priority) ? message.priority : 30000; if(message.distant && !current.dispatched)current.controller.abort(); requestGate.pump(); } return; }
    if (message.type !== 'SUBSCRIBE' || current || subscriptions.size >= 16) { post({ requestId: id, type: 'DONE', ok: false, code: 'BLOCKS_INVALID' }); return; }
    const sub = { controller: new AbortController(), priority: Number.isFinite(message.priority) ? message.priority : 30000 };
    subscriptions.set(id,sub);
    void ready.then(() => translate(message, port.sender, {
      signal: sub.controller.signal, priority: () => sub.priority,
      onDispatch: () => { sub.dispatched=true; },
      onTranslation: value => post({ type: 'RESULT', requestId: id, revision: message.revision, translation: value })
    })).then(result => post({ type: 'DONE', requestId: id, ok: true, revision: result.revision, modelId: result.modelId }), error => post({ type: 'DONE', requestId: id, ok: false, ...safeError(error) })).finally(() => { if (subscriptions.get(id) === sub) subscriptions.delete(id); });
  });
});

chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'cache-prune') ready.then(() => cache.prune(settings.cacheDays)); });
chrome.runtime.onInstalled.addListener(() => ready.then(broadcast));
