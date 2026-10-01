import { createIcons, Settings2, RefreshCw, Check, Plus, Save, PlugZap, Search, SlidersHorizontal } from 'lucide';
import { CATALOG_DATE, availableProfiles, defaultSelection, getProfile, selectionLabel } from './shared/profiles.mjs';
import { publicSettings } from './shared/core.mjs';

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
async function action(button, operation) {
  if (button.disabled) return;
  button.disabled = true; notice('');
  try { await operation(); }
  catch (error) { notice(error.message || '操作失败', true); if (error.code === 'CONFIG_CHANGED') await refresh(); }
  finally { button.disabled = false; }
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
  $('connection-status').textContent = s.hasKey ? '连接已配置' : '未配置连接';
  $('connection-status').classList.toggle('ready', s.hasKey);
  $('automatic').checked = s.automatic;
  if ($('display-mode')) $('display-mode').value = s.displayMode || 'translated';
  renderModelOptions(draft?.modelId || s.selection.modelId);
  renderControls(draft || s.selection);
  const label = `${getProfile(s.selection.modelId, s.customProfiles)?.name || s.selection.modelId} · ${selectionLabel(s.selection)}`;
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

}

async function refresh() { state = await call({ type: 'GET_STATE' }); renderState(); }

for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => {
  for (const t of document.querySelectorAll('[data-tab]')) {t.classList.toggle('active', t === tab);t.setAttribute('aria-pressed',String(t===tab));}
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab.dataset.tab;
  notice('');
});

$('model').addEventListener('change', () => {
  modelDirty = true; $('apply-model').querySelector('span').textContent='应用模型';
  const id = $('model').value;
  renderControls(state.settings.modelPreferences[id] || defaultSelection(getProfile(id, state.settings.customProfiles)));
});
$('thinking').addEventListener('change', () => {
  modelDirty = true; $('apply-model').querySelector('span').textContent='应用模型';
  const p = getProfile($('model').value, state.settings.customProfiles);
  $('effort-row').hidden = !p.efforts.length || p.mode === 'toggle-effort' && !$('thinking').checked;
  if(document.body.dataset.surface==='popup' && !$('effort-row').hidden) $('effort-row').scrollIntoView({block:'nearest'});
});
$('effort').addEventListener('change', () => { modelDirty = true; $('apply-model').querySelector('span').textContent='应用模型'; });
for (const id of ['endpoint', 'api-key', 'connection-kind']) $(id)?.addEventListener('input', () => { connectionDirty = true; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings || !state) return;
  const draft = modelDirty ? selected() : null;
  const connection = connectionDirty && $('endpoint') ? { endpoint: $('endpoint').value, kind: $('connection-kind').value } : null;
  state.settings = publicSettings(changes.settings.newValue);
  state.profiles = availableProfiles(state.settings.customProfiles);
  renderState();
  if (draft) { renderModelOptions(draft.modelId); renderControls(draft); }
  if (connection) { $('endpoint').value = connection.endpoint; $('connection-kind').value = connection.kind; }
});
$('apply-model').addEventListener('click', () => action($('apply-model'), async () => {
  const result = await call({ type: 'SELECT_MODEL', selection: selected(), expectedRevision: state.settings.revision });
  modelDirty = false; state.settings = result.settings; renderState(); notice(state.settings.hasKey ? '已切换，当前页正在更新译文' : '模型已保存，连接尚未配置');
}));
$('automatic').addEventListener('change', async () => {
  try { const result = await call({ type: 'SET_AUTOMATIC', value: $('automatic').checked, expectedRevision: state.settings.revision }); state.settings = result.settings; renderState(); }
  catch (e) { notice(e.message, true); await refresh(); }
});
$('display-mode')?.addEventListener('change', async () => {
  try { const result = await call({ type: 'SET_DISPLAY_MODE', mode: $('display-mode').value, expectedPresentationRevision: state.settings.presentationRevision || 1 }); state.settings=result.settings; notice('显示方式已更新'); }
  catch(e) { notice(e.message,true); await refresh(); }
});
$('open-settings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
$('refresh-page')?.addEventListener('click', () => action($('refresh-page'), async () => {
  if (!activeTab?.id) throw new Error('当前页不可翻译');
  await chrome.tabs.sendMessage(activeTab.id, { type: 'RETRANSLATE' }); notice('正在更新译文');
}));
$('original')?.addEventListener('change', async () => {
  if (activeTab?.id) await chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_ORIGINAL', value: $('original').checked }).catch(() => notice('当前页不可翻译', true));
});
$('site-enabled')?.addEventListener('change', async () => {
  try { const result = await call({ type: 'TOGGLE_SITE', url: activeTab.url, expectedRevision: state.settings.revision }); state.settings = result.settings; renderState(); }
  catch (e) { notice(e.message, true); }
});
$('save-connection')?.addEventListener('click', () => action($('save-connection'), async () => {
  const result = await call({ type: 'SAVE_CONNECTION', endpoint: $('endpoint').value, apiKey: $('api-key').value,
    connectionKind: $('connection-kind').value, expectedRevision: state.settings.revision });
  connectionDirty = false; $('api-key').value = ''; state.settings = result.settings; renderState(); notice('连接已保存');
}));
$('test-connection')?.addEventListener('click', () => action($('test-connection'), async () => {
  const result = await call({ type: 'TEST_MODEL', selection: state.settings.selection,
    text: 'Changes are saved only after validation succeeds.' });
  notice(`${result.synthetic ? '测试网关通过' : '翻译通过'} · ${result.elapsedMs} ms`);
}));
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
  // Optional one-shot, loopback-only receipt for a locally requested installation
  // check. Never transmit endpoint, key, page text, or browser-profile data.
  const params = new URLSearchParams(location.search);
  const checkToken = params.get('install-check'), checkPort = Number(params.get('port'));
  if (/^[a-f0-9]{48}$/.test(checkToken || '') && Number.isInteger(checkPort) && checkPort > 1023 && checkPort < 65536) {
    history.replaceState(null, '', location.pathname);
    void fetch(`http://127.0.0.1:${checkPort}/clearling-install/${checkToken}`, {
      method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: chrome.runtime.id, version: chrome.runtime.getManifest().version, mode: state.settings.displayMode, model: state.settings.selection.modelId })
    }).catch(() => {});
  }
  if (document.body.dataset.surface === 'popup') {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try { const url = new URL(activeTab?.url); if(!/^https?:$/.test(url.protocol))throw new Error('UNSUPPORTED_PAGE');$('page-host').textContent = url.hostname; $('site-enabled').checked = !state.settings.excludedSites.includes(url.hostname); }
    catch { $('page-host').textContent = '当前页不可翻译'; $('site-enabled').disabled = true; $('refresh-page').disabled = true; }
  }
} catch (e) { notice(e.message || '扩展连接失败', true); }
