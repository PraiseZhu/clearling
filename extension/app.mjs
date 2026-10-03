import { createIcons, Settings2, RefreshCw, Check, Plus, Save, PlugZap, Search, SlidersHorizontal } from 'lucide';
import { CATALOG_DATE, availableProfiles, defaultSelection, getProfile, selectionLabel } from './shared/profiles.mjs';
import { publicSettings, translationReady } from './shared/core.mjs';

// An unpacked installation can still have the previous manifest in memory after
// its files are updated. Use Chrome's normal reload API before running new UI code.
if (chrome.runtime.getManifest().version !== __CLEARLING_BUILD_VERSION__) {
  chrome.runtime.reload();
  await new Promise(() => {});
}

createIcons({ icons: { Settings2, RefreshCw, Check, Plus, Save, PlugZap, Search, SlidersHorizontal } });
const $ = id => document.getElementById(id);
let state;
let activeTab;
let modelDirty = false;
let connectionDirty = false;
const busyControls = new Set();
const names = { minimal: '最轻 · minimal', low: '低 · low', medium: '中 · medium', high: '高 · high', xhigh: '极高 · xhigh', max: '最大 · max' };
document.querySelector('footer span:last-child').textContent = `v${chrome.runtime.getManifest().version}`;
const call = async payload => {
  let timer;
  const request = chrome.runtime.sendMessage(payload);
  const result = payload.type === 'GET_STATE' ? await Promise.race([request, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('扩展后台暂不可用，请重新打开清译')), 8000); })]).finally(() => clearTimeout(timer)) : await request;
  if (!result?.ok) { const error = new Error(result?.message || '连接失败'); error.code = result?.code; throw error; }
  return result;
};
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); }
async function action(button, operation, { label = '处理中…', controls = [] } = {}) {
  if (button.disabled) return;
  const locked = [button, ...controls.map($).filter(Boolean)];
  const previous = locked.map(control => control.disabled);
  const text = button.querySelector('span');
  const oldText = text?.textContent;
  for (const control of locked) { control.disabled = true; busyControls.add(control.id); }
  button.setAttribute('aria-busy', 'true');
  if (text) text.textContent = label;
  notice(label);
  try { await operation(); }
  catch (error) { notice(error.message || '操作失败', true); if (error.code === 'CONFIG_CHANGED') await refresh(); }
  finally {
    locked.forEach((control, i) => { control.disabled = previous[i]; busyControls.delete(control.id); });
    button.removeAttribute('aria-busy');
    if (text) text.textContent = oldText;
    renderActionState();
  }
}

function renderActionState() {
  if (!state) return;
  const apply = $('apply-model');
  if (!busyControls.has('apply-model')) {
    apply.querySelector('span').textContent = modelDirty ? '验证并应用' : '已应用';
    apply.disabled = !modelDirty;
  }
  apply.dataset.dirty = String(modelDirty);
  $('model-draft').hidden = !modelDirty;
  if ($('connection-draft')) $('connection-draft').hidden = !connectionDirty;
  if ($('test-connection') && !busyControls.has('test-connection')) $('test-connection').disabled = connectionDirty || !state.settings.hasKey;
  if ($('thinking') && !busyControls.has('thinking')) $('thinking').disabled = getProfile($('model').value, state.settings.customProfiles)?.mode === 'required-effort';
  if ($('refresh-page') && !busyControls.has('refresh-page')) {
    const supported = /^https?:/.test(activeTab?.url || '');
    const available = supported && translationReady(state.settings) && state.settings.automatic && state.settings.displayMode !== 'original' && !state.settings.excludedSites.includes(new URL(activeTab.url).hostname);
    $('refresh-page').disabled = !available;
    $('refresh-page').title = available ? '重新翻译当前页' : '开启连接、本站翻译和译文阅读后可用';
  }
  for (const id of busyControls) if ($(id)) $(id).disabled = true;
}

function selected() {
  const p = getProfile($('model').value, state.settings.customProfiles);
  const thinking = p.mode === 'required-effort' ? 'enabled'
    : p.mode === 'effort' || p.mode === 'default' ? 'provider_default' : $('thinking').checked ? 'enabled' : 'disabled';
  const usesEffort = p.mode === 'effort' || p.mode === 'required-effort' || p.mode === 'toggle-effort' && thinking === 'enabled';
  return { modelId: p.id, thinking, effort: usesEffort ? $('effort').value : null };
}

function renderControls(selection) {
  const p = getProfile(selection.modelId, state.settings.customProfiles);
  $('thinking-row').hidden = p.mode === 'effort' || p.mode === 'default';
  $('thinking').checked = selection.thinking === 'enabled';
  $('thinking').disabled = p.mode === 'required-effort';
  $('thinking-row').querySelector('.switch > span').textContent=p.mode==='required-effort'?'深度思考 · 模型固定开启':'深度思考';
  $('effort-row').hidden = !p.efforts.length || p.mode === 'toggle-effort' && selection.thinking !== 'enabled';
  $('effort').replaceChildren(...p.efforts.map(value => new Option(names[value] || value, value)));
  $('effort').value = p.efforts.includes(selection.effort) ? selection.effort : p.defaultEffort;
  const verification = state.settings.verification[p.id];
  $('model-meta').textContent = verification?.state === 'translation_passed' ? '连接验证通过' : verification?.state === 'synthetic_passed' ? '测试连接通过 · 仿真接口' : '应用时验证连接，成功后切换';
  const price=p.price;
  $('model-price').textContent=price ? `输入 $${price.inputPerMillion} / 输出 $${price.outputPerMillion}（百万 Token）· ${CATALOG_DATE} 目录折后参考价，非账单` : '价格以当前网关计费为准';
  if(document.body.dataset.surface==='popup' && !$('effort-row').hidden) $('effort-row').scrollIntoView({block:'nearest'});
}

function renderModelOptions(selectedId = $('model').value || state.settings.selection.modelId) {
  const query=$('model-search').value.trim().toLowerCase();
  const matches=state.profiles.filter(p=>`${p.name} ${p.family} ${p.id}`.toLowerCase().includes(query));
  const groups=new Map();
  for(const profile of matches){const family=profile.family==='Custom'?'自定义':profile.family;if(!groups.has(family)){const group=document.createElement('optgroup');group.label=family;groups.set(family,group);}groups.get(family).append(new Option(profile.name,profile.id));}
  if(!matches.some(p=>p.id===selectedId)){const current=getProfile(selectedId,state.settings.customProfiles);if(current){const group=document.createElement('optgroup');group.label='当前选择';group.append(new Option(current.name,current.id));groups.set('selected',group);}}
  $('model').replaceChildren(...groups.values());$('model').value=selectedId;
  $('model-count').textContent=`${matches.length} 个模型`;$('model-empty').hidden=matches.length!==0;
}
$('model-search').addEventListener('input',()=>renderModelOptions());

function renderState() {
  const s = state.settings;
  const draft = modelDirty && getProfile($('model').value, s.customProfiles) ? selected() : null;
  const fast = s.readingEngine === 'bing';
  $('connection-status').textContent = fast ? '快速翻译已就绪' : s.hasKey ? 'AI 连接已配置' : '未配置 AI 连接';
  $('connection-status').classList.toggle('ready', translationReady(s));
  $('setup-prompt').hidden = translationReady(s);
  $('reading-engine').value = s.readingEngine;
  $('engine-hint').textContent = fast ? '页面文本交由微软翻译，无需配置连接。' : '使用已选模型和保存的网关连接。';
  for (const panel of document.querySelectorAll('[data-ai-settings]')) panel.hidden = fast;
  $('automatic').checked = s.automatic;
  if ($('display-mode')) $('display-mode').value = s.displayMode || 'translated';
  $('reading-hint').textContent = s.displayMode === 'original' ? '暂停新的翻译请求，随时切回译文。' : s.displayMode === 'bilingual' ? '原文与译文对照阅读，页面高度会随内容增加。' : '保留网页结构，复杂排版会保留原文对照。';
  if ($('site-enabled') && /^https?:/.test(activeTab?.url || '')) $('site-enabled').checked = !s.excludedSites.includes(new URL(activeTab.url).hostname);
  renderModelOptions(draft?.modelId || s.selection.modelId);
  renderControls(draft || s.selection);
  const label = fast ? '微软快速翻译' : `${getProfile(s.selection.modelId, s.customProfiles)?.name || s.selection.modelId} · ${selectionLabel(s.selection)}`;
  if ($('current-model')) $('current-model').textContent = label;
  $('footer-model').textContent = `当前 · ${label}`;
  if ($('endpoint')) {
    if (!connectionDirty) { $('endpoint').value = s.endpoint; $('connection-kind').value = s.connectionKind; }
    $('api-key').placeholder = s.hasKey ? '已保存，留空保持当前 Key' : '尚未配置';
  }
  if ($('stat-translated')) {
    $('stat-translated').textContent = state.stats.translated;
    $('stat-cache').textContent = state.stats.cacheHits;

  }
  renderActionState();
}

async function refresh() { state = await call({ type: 'GET_STATE' }); renderState(); }

for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => {
  for (const t of document.querySelectorAll('[data-tab]')) {t.classList.toggle('active', t === tab);t.setAttribute('aria-pressed',String(t===tab));}
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab.dataset.tab;
  notice('');
});

$('model').addEventListener('change', () => {
  modelDirty = true;
  const id = $('model').value;
  renderControls(state.settings.modelPreferences[id] || defaultSelection(getProfile(id, state.settings.customProfiles)));
  renderActionState();
});
$('thinking').addEventListener('change', () => {
  modelDirty = true;
  const p = getProfile($('model').value, state.settings.customProfiles);
  $('effort-row').hidden = !p.efforts.length || p.mode === 'toggle-effort' && !$('thinking').checked;
  if(document.body.dataset.surface==='popup' && !$('effort-row').hidden) $('effort-row').scrollIntoView({block:'nearest'});
  renderActionState();
});
$('effort').addEventListener('change', () => { modelDirty = true; renderActionState(); });
for (const id of ['endpoint', 'api-key', 'connection-kind']) $(id)?.addEventListener('input', () => { connectionDirty = true; renderActionState(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings || !state) return;
  const draft = modelDirty ? selected() : null;
  const connection = connectionDirty && $('endpoint') ? { endpoint: $('endpoint').value, kind: $('connection-kind').value } : null;
  state.settings = publicSettings(changes.settings.newValue);
  state.profiles = availableProfiles(state.settings.customProfiles);
  renderState();
  if (draft) { renderModelOptions(draft.modelId); renderControls(draft); }
  if (connection) { $('endpoint').value = connection.endpoint; $('connection-kind').value = connection.kind; }
  renderActionState();
});
$('apply-model').addEventListener('click', () => action($('apply-model'), async () => {
  const result = await call({ type: 'SELECT_MODEL', selection: selected(), expectedRevision: state.settings.revision });
  modelDirty = false; state.settings = result.settings; renderState(); notice(state.settings.hasKey ? '已切换，当前页正在更新译文' : '模型已保存，连接尚未配置');
}, { label: '验证并应用中…', controls: ['model-search', 'model', 'thinking', 'effort'] }));
$('automatic').addEventListener('change', async () => {
  try { const result = await call({ type: 'SET_AUTOMATIC', value: $('automatic').checked, expectedRevision: state.settings.revision }); state.settings = result.settings; renderState(); }
  catch (e) { notice(e.message, true); await refresh(); }
});
$('reading-engine').addEventListener('change', async () => {
  $('reading-engine').disabled = true;
  try { const result = await call({ type: 'SET_READING_ENGINE', engine: $('reading-engine').value, expectedRevision: state.settings.revision }); state.settings = result.settings; renderState(); notice('翻译方式已更新'); }
  catch (error) { notice(error.message, true); await refresh(); }
  finally { $('reading-engine').disabled = false; }
});
$('display-mode')?.addEventListener('change', async () => {
  try { const result = await call({ type: 'SET_DISPLAY_MODE', mode: $('display-mode').value, expectedPresentationRevision: state.settings.presentationRevision || 1 }); state.settings=result.settings; renderState(); notice('显示方式已更新'); }
  catch(e) { notice(e.message,true); await refresh(); }
});
$('open-settings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
$('configure-connection').addEventListener('click', () => {
  if (document.body.dataset.surface === 'popup') void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#connection') });
  else { document.querySelector('[data-tab="connection"]').click(); $('endpoint').focus(); }
});
$('refresh-page')?.addEventListener('click', () => action($('refresh-page'), async () => {
  if (!activeTab?.id) throw new Error('当前页不可翻译');
  try { await chrome.tabs.sendMessage(activeTab.id, { type: 'RETRANSLATE' }); notice('正在更新译文'); }
  catch { throw new Error('页面尚未连接清译，请刷新网页后重试'); }
}));
$('original')?.addEventListener('change', async () => {
  if (activeTab?.id) await chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_ORIGINAL', value: $('original').checked }).catch(() => notice('当前页不可翻译', true));
});
$('site-enabled')?.addEventListener('change', async () => {
  $('site-enabled').disabled = true;
  try { const result = await call({ type: 'TOGGLE_SITE', url: activeTab.url, expectedRevision: state.settings.revision }); state.settings = result.settings; renderState(); }
  catch (e) { notice(e.message, true); await refresh(); }
  finally { $('site-enabled').disabled = false; }
});
$('save-connection')?.addEventListener('click', () => action($('save-connection'), async () => {
  const result = await call({ type: 'SAVE_CONNECTION', endpoint: $('endpoint').value, apiKey: $('api-key').value,
    connectionKind: $('connection-kind').value, expectedRevision: state.settings.revision });
  connectionDirty = false; $('api-key').value = ''; state.settings = result.settings; renderState(); notice('连接已保存');
}, { label: '保存中…', controls: ['endpoint', 'api-key', 'connection-kind', 'test-connection'] }));
$('test-connection')?.addEventListener('click', () => action($('test-connection'), async () => {
  const result = await call({ type: 'TEST_MODEL', selection: state.settings.selection,
    text: 'Changes are saved only after validation succeeds.' });
  notice(`${result.synthetic ? '测试网关通过' : '翻译通过'} · ${result.elapsedMs} ms`);
}, { label: '测试连接中…', controls: ['endpoint', 'api-key', 'connection-kind', 'save-connection'] }));
$('add-model')?.addEventListener('click', () => action($('add-model'), async () => {
  const result = await call({ type: 'ADD_MODEL', profile: { id: $('custom-id').value, name: $('custom-name').value }, expectedRevision: state.settings.revision });
  state.settings = result.settings; state.profiles = availableProfiles(result.settings.customProfiles);
  $('custom-id').value = ''; $('custom-name').value = ''; renderState(); notice('模型已添加');
}));
$('clear-cache')?.addEventListener('click', () => action($('clear-cache'), async () => { await call({ type: 'CLEAR_CACHE' }); notice('译文缓存已删除'); }));
$('clear-connection')?.addEventListener('click', () => action($('clear-connection'), async () => {
  const result = await call({ type: 'CLEAR_CONNECTION', expectedRevision: state.settings.revision }); state.settings = result.settings; renderState(); notice('此插件的连接已移除');
}));


try {
  await refresh();
  if (location.hash === '#connection') { document.querySelector('[data-tab="connection"]')?.click(); $('endpoint')?.focus(); }
  // Optional one-shot, loopback-only receipt for a locally requested installation
  // check. Never transmit endpoint, key, page text, or browser-profile data.
  const params = new URLSearchParams(location.search);
  const checkToken = params.get('install-check'), checkPort = Number(params.get('port'));
  if (/^[a-f0-9]{48}$/.test(checkToken || '') && Number.isInteger(checkPort) && checkPort > 1023 && checkPort < 65536) {
    history.replaceState(null, '', location.pathname);
    const base = `http://127.0.0.1:${checkPort}`;
    const before = { hasKey: state.settings.hasKey, model: state.settings.selection.modelId };
    const handshake = await fetch(`${base}/clearling-install/${checkToken}`, { method: 'POST', credentials: 'omit', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'handshake' }) });
    if (!handshake.ok) throw new Error('安装验证请求已失效');
    const task = await handshake.json();
    if (task.id !== chrome.runtime.id || task.version !== chrome.runtime.getManifest().version) throw new Error('安装验证版本不匹配');
    if (task.activateFast === true) {
      const result = await call({ type: 'SET_READING_ENGINE', engine: 'bing', expectedRevision: state.settings.revision });
      state.settings = result.settings; renderState();
    }
    void fetch(`http://127.0.0.1:${checkPort}/clearling-install/${checkToken}`, {
      method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: chrome.runtime.id, version: chrome.runtime.getManifest().version, mode: state.settings.displayMode,
        readingEngine: state.settings.readingEngine, automatic: state.settings.automatic,
        aiConnectionPreserved: before.hasKey === state.settings.hasKey, aiModelPreserved: before.model === state.settings.selection.modelId })
    }).catch(() => {});
  }
  if (document.body.dataset.surface === 'popup') {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try { const url = new URL(activeTab?.url); if(!/^https?:$/.test(url.protocol))throw new Error('UNSUPPORTED_PAGE');$('page-host').textContent = url.hostname; $('site-enabled').checked = !state.settings.excludedSites.includes(url.hostname); }
    catch { $('page-host').textContent = '当前页不可翻译'; $('site-enabled').disabled = true; $('refresh-page').disabled = true; }
    renderActionState();
  }
} catch (e) { notice(e.message || '扩展连接失败', true); }
