import {
  authUnsupported,
  catalogModel,
  catalogProvider,
  extraHeaders,
  isApiKeyAuth,
  listCatalogProviders,
  normalizeModelRecord,
} from './catalog.mjs';
import { DEFAULT_COMPAT, mergeCompat } from './compat.mjs';
import { DEFAULT_RETRY_POLICY } from './retry.mjs';

const WEB_RUNTIME_APIS = new Set([
  'anthropic-messages',
  'google-generative-ai',
  'mistral-conversations',
  'openai-completions',
  'openai-responses',
]);

export function resolveProvider(providerId, profile = {}, credential = {}) {
  const catalog = catalogProvider(providerId);
  const custom = !catalog;
  const unsupported = authUnsupported(providerId);
  return {
    id: providerId,
    displayName: profile.display_name || profile.displayName || catalog?.displayName || providerId,
    catalog: !custom,
    custom,
    recommended: !!catalog?.recommended,
    auth: catalog?.auth || 'api-key',
    authUnsupported: unsupported,
    authHint: catalog?.authHint || unsupported?.message || null,
    protocol: custom
      ? (profile.protocol || 'openai-completions')
      : (catalog?.protocol || 'openai-completions'),
    baseUrl: custom
      ? (profile.base_url || profile.baseUrl || credential.base_url || catalog?.defaultBaseUrl || '')
      : (catalog?.defaultBaseUrl || ''),
    defaultBaseUrl: catalog?.defaultBaseUrl || '',
    keyDocs: catalog?.keyDocs || null,
    configured: Boolean(credential.key_hint || credential.configured),
    hint: credential.key_hint || credential.hint || '',
    defaultInput: profile.default_input || profile.defaultInput || ['text'],
    compat: mergeCompat(catalog?.compat, profile.compat),
    retryPolicy: { ...DEFAULT_RETRY_POLICY, ...(profile.retry_policy || profile.retryPolicy || {}) },
    defaultModels: catalog?.defaultModels || { assistant: '', silicon: '' },
    group: catalog?.group || (custom ? 'custom' : 'catalog'),
  };
}

export function resolveModels(providerId, profile = {}, catalogModels) {
  const catalog = catalogProvider(providerId);
  const inherited = catalogModels || catalog?.models || [];
  const overrides = Array.isArray(profile.models) ? profile.models : [];
  if (catalog) {
    return inherited.map((model) => normalizeModelRecord({
      provider: providerId,
      ...model,
    }));
  }
  return overrides.map((model) => normalizeModelRecord({
    provider: providerId,
    ...model,
  }));
}

export function resolveModel(providerId, modelId, profile = {}) {
  const models = resolveModels(providerId, profile);
  const hit = models.find((model) => model.id === modelId);
  if (hit) return hit;
  const catalog = catalogModel(providerId, modelId);
  if (catalog) return normalizeModelRecord({ provider: providerId, ...catalog });
  if (!modelId) return null;
  return normalizeModelRecord({
    id: modelId,
    name: modelId,
    input: profile.default_input || profile.defaultInput || ['text'],
  });
}

export function modelAcceptsImage(providerId, modelId, profile = {}) {
  const model = resolveModel(providerId, modelId, profile);
  return Boolean(model?.vision || model?.input?.includes('image'));
}

export function resolveModelRoute(providerId, modelId, profile = {}) {
  const provider = resolveProvider(providerId, profile);
  const model = resolveModel(providerId, modelId, profile);
  if (!model) return null;
  if (provider.catalog) {
    const configuredBase = profile.base_url || profile.baseUrl || '';
    let baseUrl = model.baseUrl;
    if (providerId === 'cloudflare-ai-gateway' && configuredBase) {
      const suffix = model.api === 'anthropic-messages'
        ? 'anthropic'
        : model.api === 'openai-responses' ? 'openai' : 'compat';
      baseUrl = `${String(configuredBase).replace(/\/$/, '')}/${suffix}`;
    } else if (providerId === 'cloudflare-workers-ai' && configuredBase) {
      baseUrl = configuredBase;
    }
    return {
      provider,
      model,
      protocol: model.api,
      baseUrl,
      headers: { ...extraHeaders(providerId), ...(model.headers || {}) },
      supported: Boolean(
        WEB_RUNTIME_APIS.has(model.api)
        && baseUrl
        && !/[{}]/.test(baseUrl)
      ),
    };
  }
  return {
    provider,
    model,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    headers: { ...extraHeaders(providerId), ...(model.headers || {}) },
    supported: Boolean(provider.protocol && provider.baseUrl),
  };
}

export function effortOptions(providerId, modelId, profile = {}) {
  const model = resolveModel(providerId, modelId, profile);
  if (!model?.reasoningEfforts) return model ? ['off'] : [];
  return Object.keys(model.reasoningEfforts);
}

export function availableModelId(providerId, requested, {
  profile = {},
  vision = false,
} = {}) {
  const provider = resolveProvider(providerId, profile);
  const models = resolveModels(providerId, profile).filter((model) => {
    if (vision && !model.vision) return false;
    return resolveModelRoute(providerId, model.id, profile)?.supported !== false;
  });
  if (requested && models.some((model) => model.id === requested)) return requested;
  const preferred = vision ? provider.defaultModels.silicon : provider.defaultModels.assistant;
  if (preferred && models.some((model) => model.id === preferred)) return preferred;
  return models[0]?.id || '';
}

export function buildDirectory({ profiles = [], credentials = [] } = {}) {
  const credById = Object.fromEntries(credentials.map((row) => [row.provider, row]));
  const profileById = Object.fromEntries(profiles.map((row) => [row.provider, row]));
  const ids = new Set([
    ...listCatalogProviders().map((p) => p.id),
    ...Object.keys(profileById),
    ...Object.keys(credById),
  ]);
  return [...ids].map((id) => {
    const provider = resolveProvider(id, profileById[id], credById[id]);
    const allModels = resolveModels(id, profileById[id]).map((model) => ({
      ...model,
      runtimeSupported: resolveModelRoute(id, model.id, profileById[id])?.supported !== false,
    }));
    const includeModels = provider.configured || provider.custom || provider.recommended;
    return {
      ...provider,
      models: includeModels ? allModels : [],
      modelCount: allModels.length,
    };
  });
}

export function publicCatalog({ providerId = null, summariesOnly = false } = {}) {
  return listCatalogProviders()
    .filter((provider) => !providerId || provider.id === providerId)
    .map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    label: provider.displayName,
    recommended: !!provider.recommended,
    auth: provider.auth,
    authHint: provider.authHint || null,
    protocol: provider.protocol,
    defaultBaseUrl: provider.defaultBaseUrl,
    keyDocs: provider.keyDocs || null,
    group: provider.group,
    configurable: isApiKeyAuth(provider.id),
    defaultModels: provider.defaultModels,
    modelCount: (provider.models || []).length,
    catalog: summariesOnly
      ? []
      : (provider.models || []).map((model) => normalizeModelRecord(model)),
  }));
}

export { extraHeaders, DEFAULT_COMPAT };
