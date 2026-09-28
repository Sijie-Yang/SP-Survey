import {
  CATALOG_PAYLOAD_SHA256,
  CATALOG_PROVIDERS,
  CATALOG_SOURCE,
  CATALOG_VERSION,
} from './catalog.generated.mjs';

export const PROVIDER_ID_RE = /^[a-z][a-z0-9_-]{0,47}$/;
export const PROTOCOLS = [
  { id: 'openai-completions', label: 'openai-completions' },
  { id: 'openai-responses', label: 'openai-responses' },
  { id: 'anthropic-messages', label: 'anthropic-messages' },
];
export const NATIVE_AUTH = new Set(['aws', 'adc', 'azure', 'oauth']);
const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function isProviderId(id) {
  return PROVIDER_ID_RE.test(String(id || ''));
}

export function listCatalogProviders() {
  return CATALOG_PROVIDERS.map((p) => ({ ...p, models: [...(p.models || [])] }));
}

export function catalogProvider(id) {
  return CATALOG_PROVIDERS.find((p) => p.id === id) || null;
}

export function catalogModel(providerId, modelId) {
  const provider = catalogProvider(providerId);
  if (!provider) return null;
  return (provider.models || []).find((m) => m.id === modelId) || null;
}

export function isApiKeyAuth(providerId) {
  const provider = catalogProvider(providerId);
  if (!provider) return true;
  return provider.auth === 'api-key';
}

export function authUnsupported(providerId) {
  const provider = catalogProvider(providerId);
  if (!provider || provider.auth === 'api-key') return null;
  return {
    code: 'AUTH_UNSUPPORTED',
    auth: provider.auth,
    message: provider.authHint || `${provider.displayName} requires native authentication.`,
  };
}

export function normalizeModelRecord(model, fallback = {}) {
  const input = Array.isArray(model.input) && model.input.length
    ? model.input
    : (fallback.input || ['text']);
  const thinkingLevelMap = model.thinkingLevelMap
    || fallback.thinkingLevelMap
    || false;
  const reasoning = Boolean(model.reasoning || thinkingLevelMap);
  const supportedThinkingLevels = reasoning
    ? PI_THINKING_LEVELS.filter((level) => {
      const mapped = thinkingLevelMap?.[level];
      if (mapped === null) return false;
      if ((level === 'xhigh' || level === 'max') && typeof mapped !== 'string') return false;
      return true;
    })
    : [];
  const reasoningEfforts = reasoning
    ? Object.fromEntries(supportedThinkingLevels.map((level) => [
      level,
      thinkingLevelMap?.[level] ?? level,
    ]))
    : false;
  const configuredEfforts = model.reasoningEfforts
    || model.thinkingLevelMap
    || fallback.reasoningEfforts
    || fallback.thinkingLevelMap
    || false;
  const defaultEffort = model.defaultEffort
    || fallback.defaultEffort
    || (configuredEfforts && Object.hasOwn(configuredEfforts, 'high') ? 'high' : null);
  return {
    id: model.id,
    provider: model.provider || fallback.provider || null,
    name: model.name || model.label || model.id,
    label: model.label || model.name || model.id,
    contextWindow: Number(model.contextWindow || fallback.contextWindow || 128000),
    maxTokens: Number(model.maxTokens || fallback.maxTokens || 8192),
    input,
    vision: input.includes('image'),
    tools: model.tools !== false,
    reasoning,
    reasoningEfforts,
    thinkingLevelMap,
    defaultEffort,
    api: model.api || fallback.api || null,
    baseUrl: model.baseUrl || fallback.baseUrl || '',
    runtimeApi: model.runtimeApi || fallback.runtimeApi || null,
    runtimeBaseUrl: model.runtimeBaseUrl || fallback.runtimeBaseUrl || '',
    cost: model.cost || fallback.cost || null,
    samplingParams: {
      ...((fallback.samplingParams && typeof fallback.samplingParams === 'object')
        ? fallback.samplingParams
        : {}),
      ...((model.samplingParams && typeof model.samplingParams === 'object')
        ? model.samplingParams
        : {}),
    },
    compat: {
      ...((fallback.compat && typeof fallback.compat === 'object') ? fallback.compat : {}),
      ...((model.compat && typeof model.compat === 'object') ? model.compat : {}),
    },
    headers: {
      ...((fallback.headers && typeof fallback.headers === 'object') ? fallback.headers : {}),
      ...((model.headers && typeof model.headers === 'object') ? model.headers : {}),
    },
  };
}

export function extraHeaders(providerId) {
  if (providerId === 'openrouter' || providerId === 'vercel-ai-gateway') {
    return {
      'HTTP-Referer': 'https://sp-survey.org',
      'X-Title': 'SP-Survey-Platform',
    };
  }
  return {};
}

export {
  CATALOG_PAYLOAD_SHA256,
  CATALOG_PROVIDERS,
  CATALOG_SOURCE,
  CATALOG_VERSION,
};
