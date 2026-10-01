const EXISTING_PROFILES = [
  { id: 'xiaomi/mimo-v2.6-flash', name: 'MiMo V2.6 Flash', family: 'MiMo', mode: 'toggle', efforts: [], defaultThinking: 'disabled', defaultEffort: null },
  { id: 'xiaomi/mimo-v2.6-pro', name: 'MiMo V2.6 Pro', family: 'MiMo', mode: 'toggle', efforts: [], defaultThinking: 'disabled', defaultEffort: null },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', family: 'DeepSeek', mode: 'toggle-effort', efforts: ['low', 'high', 'max'], defaultThinking: 'disabled', defaultEffort: 'low' },
  { id: 'qwen/qwen3.8-flash', name: 'Qwen 3.8 Flash', family: 'Qwen', mode: 'toggle', efforts: [], defaultThinking: 'disabled', defaultEffort: null },
  { id: 'z-ai/glm-5.3-flash', name: 'GLM 5.3 Flash', family: 'GLM', mode: 'required-effort', efforts: ['low', 'high', 'max'], defaultThinking: 'enabled', defaultEffort: 'low' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', family: 'GPT', mode: 'effort', efforts: ['low', 'medium', 'high', 'xhigh'], defaultThinking: 'provider_default', defaultEffort: 'low' }
];

// Cindy public gateway price snapshot; not a tenant invoice or quality ranking.
export const CATALOG_DATE = "2026-10-02";
export const CATALOG_SOURCE = "https://model-access.cindy.app/api/model-access/models?schemaVersion=5";
const CATALOG_PRICES = {
  "z-ai/glm-5.3-flash": {
    "currency": "USD",
    "inputPerMillion": 0.03,
    "outputPerMillion": 0.1,
    "baseInputPerMillion": 0.15,
    "baseOutputPerMillion": 0.5,
    "discount": 0.2,
    "asOf": "2026-10-02"
  },
  "z-ai/glm-5.3-flashx": {
    "currency": "USD",
    "inputPerMillion": 0.0555,
    "outputPerMillion": 0.1875,
    "baseInputPerMillion": 0.37,
    "baseOutputPerMillion": 1.25,
    "discount": 0.15,
    "asOf": "2026-10-02"
  },
  "openai/gpt-6-luna": {
    "currency": "USD",
    "inputPerMillion": 0.1,
    "outputPerMillion": 0.5,
    "baseInputPerMillion": 0.1,
    "baseOutputPerMillion": 0.5,
    "discount": 1,
    "asOf": "2026-10-02"
  },
  "qwen/qwen3.8-omni-flash": {
    "currency": "USD",
    "inputPerMillion": 0.113,
    "outputPerMillion": 0.382,
    "baseInputPerMillion": 0.113,
    "baseOutputPerMillion": 0.382,
    "discount": 1,
    "asOf": "2026-10-02"
  },
  "qwen/qwen3.8-27b": {
    "currency": "USD",
    "inputPerMillion": 0.1275,
    "outputPerMillion": 0.765,
    "baseInputPerMillion": 0.425,
    "baseOutputPerMillion": 2.55,
    "discount": 0.3,
    "asOf": "2026-10-02"
  },
  "tencent/hy3": {
    "currency": "USD",
    "inputPerMillion": 0.132,
    "outputPerMillion": 0.528,
    "baseInputPerMillion": 0.132,
    "baseOutputPerMillion": 0.528,
    "discount": 1,
    "asOf": "2026-10-02"
  },
  "qwen/qwen3.8-flash": {
    "currency": "USD",
    "inputPerMillion": 0.16,
    "outputPerMillion": 0.47,
    "baseInputPerMillion": 0.16,
    "baseOutputPerMillion": 0.47,
    "discount": 1,
    "asOf": "2026-10-02"
  },
  "openai/gpt-5.6-luna": {
    "currency": "USD",
    "inputPerMillion": 0.2,
    "outputPerMillion": 1.2,
    "baseInputPerMillion": 0.2,
    "baseOutputPerMillion": 1.2,
    "discount": 1,
    "asOf": "2026-10-02"
  },
  "z-ai/glm-5.3": {
    "currency": "USD",
    "inputPerMillion": 0.28,
    "outputPerMillion": 0.88,
    "baseInputPerMillion": 1.4,
    "baseOutputPerMillion": 4.4,
    "discount": 0.2,
    "asOf": "2026-10-02"
  },
  "qwen/qwen3.8-max": {
    "currency": "USD",
    "inputPerMillion": 0.3,
    "outputPerMillion": 0.9,
    "baseInputPerMillion": 2,
    "baseOutputPerMillion": 6,
    "discount": 0.15,
    "asOf": "2026-10-02"
  },
  "deepseek/deepseek-flash": {
    "currency": "USD",
    "inputPerMillion": 0.3,
    "outputPerMillion": 1.2,
    "baseInputPerMillion": 0.3,
    "baseOutputPerMillion": 1.2,
    "discount": 1,
    "asOf": "2026-10-02"
  },
  "deepseek/deepseek-v4-flash": {
    "currency": "USD",
    "inputPerMillion": 0.3,
    "outputPerMillion": 1.2,
    "baseInputPerMillion": 0.3,
    "baseOutputPerMillion": 1.2,
    "discount": 1,
    "asOf": "2026-10-02"
  },
  "deepseek/deepseek-v4-flash-vision-exp": {
    "currency": "USD",
    "inputPerMillion": 0.3,
    "outputPerMillion": 1.2,
    "baseInputPerMillion": 0.3,
    "baseOutputPerMillion": 1.2,
    "discount": 1,
    "asOf": "2026-10-02"
  },
  "z-ai/glm-5.2": {
    "currency": "USD",
    "inputPerMillion": 0.42,
    "outputPerMillion": 1.32,
    "baseInputPerMillion": 1.4,
    "baseOutputPerMillion": 4.4,
    "discount": 0.3,
    "asOf": "2026-10-02"
  },
  "google/gemini-3.7-flash": {
    "currency": "USD",
    "inputPerMillion": 0.75,
    "outputPerMillion": 3.75,
    "baseInputPerMillion": 0.75,
    "baseOutputPerMillion": 3.75,
    "discount": 1,
    "asOf": "2026-10-02"
  },
  "google/gemini-3.8-flash": {
    "currency": "USD",
    "inputPerMillion": 0.75,
    "outputPerMillion": 3.75,
    "baseInputPerMillion": 0.75,
    "baseOutputPerMillion": 3.75,
    "discount": 1,
    "asOf": "2026-10-02"
  }
};
const CATALOG_PROFILES = [
  {
    "id": "z-ai/glm-5.3-flashx",
    "name": "GLM 5.3 FlashX",
    "family": "GLM",
    "mode": "effort",
    "efforts": [
      "low",
      "medium",
      "high",
      "max"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "low"
  },
  {
    "id": "openai/gpt-6-luna",
    "name": "GPT-6 Luna",
    "family": "GPT",
    "mode": "effort",
    "efforts": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "low"
  },
  {
    "id": "qwen/qwen3.8-omni-flash",
    "name": "Qwen3.8 Omni Flash",
    "family": "Qwen",
    "mode": "effort",
    "efforts": [
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "minimal"
  },
  {
    "id": "qwen/qwen3.8-27b",
    "name": "Qwen3.8 27B",
    "family": "Qwen",
    "mode": "effort",
    "efforts": [
      "low",
      "medium",
      "high",
      "xhigh"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "low"
  },
  {
    "id": "tencent/hy3",
    "name": "Hy3",
    "family": "Hunyuan",
    "mode": "effort",
    "efforts": [
      "low",
      "medium",
      "high"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "low"
  },
  {
    "id": "openai/gpt-5.6-luna",
    "name": "GPT-5.6 Luna",
    "family": "GPT",
    "mode": "effort",
    "efforts": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "low"
  },
  {
    "id": "z-ai/glm-5.3",
    "name": "GLM 5.3",
    "family": "GLM",
    "mode": "effort",
    "efforts": [
      "low",
      "medium",
      "high",
      "max"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "low"
  },
  {
    "id": "qwen/qwen3.8-max",
    "name": "Qwen3.8 Max",
    "family": "Qwen",
    "mode": "effort",
    "efforts": [
      "low",
      "medium",
      "high",
      "xhigh"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "low"
  },
  {
    "id": "deepseek/deepseek-flash",
    "name": "DeepSeek Flash",
    "family": "DeepSeek",
    "mode": "effort",
    "efforts": [
      "medium",
      "high",
      "max"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "medium"
  },
  {
    "id": "deepseek/deepseek-v4-flash-vision-exp",
    "name": "DeepSeek V4 Flash Vision Exp",
    "family": "DeepSeek",
    "mode": "effort",
    "efforts": [
      "medium",
      "high",
      "max"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "medium"
  },
  {
    "id": "z-ai/glm-5.2",
    "name": "GLM 5.2",
    "family": "GLM",
    "mode": "effort",
    "efforts": [
      "minimal",
      "medium",
      "high",
      "max"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "minimal"
  },
  {
    "id": "google/gemini-3.7-flash",
    "name": "Gemini 3.7 Flash",
    "family": "Gemini",
    "mode": "effort",
    "efforts": [
      "low",
      "medium",
      "high"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "low"
  },
  {
    "id": "google/gemini-3.8-flash",
    "name": "Gemini 3.8 Flash",
    "family": "Gemini",
    "mode": "effort",
    "efforts": [
      "low",
      "medium",
      "high"
    ],
    "defaultThinking": "provider_default",
    "defaultEffort": "low"
  }
];
export const PROFILES = Object.freeze([...EXISTING_PROFILES,...CATALOG_PROFILES].map(profile => Object.freeze({...profile,price:CATALOG_PRICES[profile.id] || null})));

export const DEFAULT_MODEL = PROFILES[0].id;
export const PROMPT_VERSION = 'clearling-3';
export const ADAPTER_VERSION = 'chat-1';

export function getProfile(modelId, customProfiles = []) {
  return customProfiles.find(p => p.id === modelId) ?? PROFILES.find(p => p.id === modelId) ?? null;
}

export function availableProfiles(customProfiles = []) {
  return PROFILES.map(profile => customProfiles.find(p => p.id === profile.id) || profile)
    .concat(customProfiles.filter(profile => !PROFILES.some(p => p.id === profile.id)));
}

export function defaultSelection(profile = PROFILES[0]) {
  return { modelId: profile.id, thinking: profile.defaultThinking, effort: profile.defaultEffort };
}

export function validateSelection(selection, customProfiles = []) {
  const profile = getProfile(selection?.modelId, customProfiles);
  if (!profile) throw new Error('MODEL_UNKNOWN');
  const allowedThinking = profile.mode === 'required-effort' ? ['enabled']
    : profile.mode === 'effort' || profile.mode === 'default' ? ['provider_default'] : ['enabled', 'disabled'];
  if (!allowedThinking.includes(selection.thinking)) throw new Error('THINKING_UNSUPPORTED');
  const usesEffort = profile.mode === 'effort' || profile.mode === 'required-effort'
    || (profile.mode === 'toggle-effort' && selection.thinking === 'enabled');
  if (usesEffort && !profile.efforts.includes(selection.effort)) throw new Error('EFFORT_UNSUPPORTED');
  if (!usesEffort && selection.effort != null && !profile.efforts.includes(selection.effort)) throw new Error('EFFORT_UNSUPPORTED');
  return { modelId: profile.id, thinking: selection.thinking, effort: usesEffort ? selection.effort : null };
}

export function modelParameters(selection, connectionKind = 'cindy', customProfiles = []) {
  const s = validateSelection(selection, customProfiles);
  const p = getProfile(s.modelId, customProfiles);
  if (p.mode === 'default') return {};
  if (p.family === 'Qwen' && p.mode === 'toggle' && connectionKind === 'native') return { enable_thinking: s.thinking === 'enabled' };
  const params = {};
  if (s.thinking !== 'provider_default') params.thinking = { type: s.thinking };
  if (s.effort != null) params.reasoning_effort = s.effort;
  return params;
}

export function wireModel(selection, connectionKind = 'cindy') {
  const native = {
    'xiaomi/mimo-v2.6-flash': 'mimo-v2.6-flash',
    'xiaomi/mimo-v2.6-pro': 'mimo-v2.6-pro',
    'deepseek/deepseek-v4-flash': 'deepseek-v4-flash',
    'qwen/qwen3.8-flash': 'qwen3.8-flash',
    'z-ai/glm-5.3-flash': 'glm-5.3-flash'
  };
  return connectionKind === 'native' ? native[selection.modelId] || selection.modelId : selection.modelId;
}

export function selectionLabel(selection) {
  if (selection.thinking === 'disabled') return '思考关闭';
  if (selection.effort) return selection.effort;
  return selection.thinking === 'enabled' ? '思考开启' : '供应商默认';
}

export function validateCustomProfile(raw) {
  const id = raw?.id?.trim();
  if (!id || id.length > 180 || /[\s\u0000-\u001f]/.test(id) || PROFILES.some(p => p.id === id)) throw new Error('MODEL_ID_INVALID');
  return { id, name: String(raw.name || id).slice(0, 100), family: 'Custom', mode: 'default', efforts: [], defaultThinking: 'provider_default', defaultEffort: null };
}
