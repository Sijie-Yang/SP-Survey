/**
 * Bridges the local credential store (data/ai-credentials.json) to the
 * Platform-aligned catalog, registry, and pi-ai adapters.
 */
import { catalogProvider, isApiKeyAuth } from './catalog.mjs';
import {
  availableModelId,
  buildDirectory,
  modelAcceptsImage,
  resolveModelRoute,
  resolveModels,
  resolveProvider,
} from './registry.mjs';

function routeError(message, code, status = 400) {
  return Object.assign(new Error(message), { status, code });
}

export function profileFromSaved(saved = {}) {
  const catalog = catalogProvider(saved.provider);
  return {
    provider: saved.provider,
    display_name: catalog ? '' : (saved.displayName || ''),
    base_url: saved.baseUrl || '',
    protocol: catalog ? undefined : (saved.protocol || 'openai-completions'),
    models: catalog ? [] : (Array.isArray(saved.models) ? saved.models : []),
    compat: saved.compat || {},
    retry_policy: saved.retryPolicy || undefined,
    default_input: saved.defaultInput || undefined,
  };
}

function storeRows(store = {}) {
  const saved = Object.values(store.providers || {}).filter((row) => row?.provider);
  return {
    profiles: saved.map(profileFromSaved),
    credentials: saved
      .filter((row) => row.apiKey)
      .map((row) => ({ provider: row.provider, key_hint: row.hint || '••••' })),
  };
}

/** Provider directory for the settings UI. Never includes key material. */
export function localDirectory(store = {}) {
  const { profiles, credentials } = storeRows(store);
  return buildDirectory({ profiles, credentials }).map((provider) => {
    const saved = store.providers?.[provider.id];
    return {
      ...provider,
      configurable: isApiKeyAuth(provider.id),
      userConfigured: Boolean(provider.configured),
      custom: provider.custom || Boolean(saved?.custom),
      baseUrl: saved?.baseUrl || (provider.catalog ? '' : provider.baseUrl),
      retryPolicy: provider.retryPolicy,
    };
  });
}

export function detectLegacyProvider(apiKey) {
  const key = String(apiKey || '').trim();
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('sk-ant-')) return 'anthropic';
  return 'openai';
}

/**
 * Resolve provider, model, endpoint, headers, and the user's key for one request.
 * A key saved for the provider always wins over a browser-supplied legacy key,
 * so a key for one vendor is never sent to another vendor's endpoint.
 */
export function resolveLocalRoute(store = {}, {
  provider: requestedProvider = '',
  model: requestedModel = '',
  apiKey: legacyKey = '',
  vision = false,
} = {}) {
  const settings = store.settings || {};
  const fallbackProvider = vision
    ? (settings.silicon_provider || settings.assistant_provider)
    : settings.assistant_provider;
  let provider = String(requestedProvider || '').trim();
  if (!provider) {
    provider = fallbackProvider && store.providers?.[fallbackProvider]?.apiKey
      ? fallbackProvider
      : (legacyKey ? detectLegacyProvider(legacyKey) : fallbackProvider || '');
  }
  if (!provider) throw routeError('API key is required. Add a provider key in Assistant settings.', 'CREDENTIALS_MISSING');
  const saved = store.providers?.[provider] || null;
  const apiKey = String(saved?.apiKey || legacyKey || '').trim();
  if (!apiKey) {
    throw routeError('API key is required. Add a provider key in Assistant settings.', 'CREDENTIALS_MISSING');
  }
  const profile = saved ? profileFromSaved(saved) : {};
  const resolvedProvider = resolveProvider(provider, profile, { configured: true });
  if (resolvedProvider.authUnsupported) {
    throw routeError(resolvedProvider.authUnsupported.message, 'AUTH_UNSUPPORTED');
  }
  if (vision && requestedModel && !modelAcceptsImage(provider, requestedModel, profile)) {
    throw routeError(`${requestedModel} does not accept images. Select a vision-language model.`, 'VISION_MODEL_REQUIRED');
  }
  const model = availableModelId(provider, requestedModel, { profile, vision });
  if (!model && resolveModels(provider, profile).length) {
    throw routeError(
      `${resolvedProvider.displayName} needs a base URL before its models can be used.`,
      'PROVIDER_ENDPOINT_REQUIRED',
    );
  }
  if (!model) {
    throw routeError(
      vision ? 'Select a vision-language model for this provider.' : 'Select a model for this provider.',
      vision ? 'VISION_MODEL_REQUIRED' : 'MODEL_REQUIRED',
    );
  }
  if (vision && !modelAcceptsImage(provider, model, profile)) {
    throw routeError('Silicon samples require a vision-language model.', 'VISION_MODEL_REQUIRED');
  }
  const route = resolveModelRoute(provider, model, profile);
  if (!route?.supported) {
    throw routeError(
      `${resolvedProvider.displayName} needs a base URL before ${model} can be used.`,
      'PROVIDER_ENDPOINT_REQUIRED',
    );
  }
  return {
    apiKey,
    provider,
    model,
    baseUrl: route.baseUrl,
    protocol: route.protocol,
    modelRecord: route.model,
    compat: resolvedProvider.catalog
      ? (route.model.compat || {})
      : { ...resolvedProvider.compat, ...(route.model.compat || {}) },
    extra: route.headers,
    retryPolicy: resolvedProvider.retryPolicy,
    efforts: route.model.reasoningEfforts || false,
  };
}

function effortFor(route, requested) {
  const efforts = route.efforts;
  if (!efforts || !requested || requested === 'off') return requested === 'off' ? 'off' : undefined;
  return Object.hasOwn(efforts, requested) ? requested : undefined;
}

/**
 * One model call through the pi-ai adapter for the route's protocol.
 * Returns an OpenAI chat-completion shaped object for existing callers.
 */
export async function chatCompletion(route, {
  messages = [],
  tools = [],
  effort,
  maxTokens,
  temperature,
  json = false,
  signal,
  retryPolicy,
  onRetry,
} = {}) {
  const { modelRequest } = await import('./adapters.mjs');
  const result = await modelRequest({
    apiKey: route.apiKey,
    provider: route.provider,
    baseUrl: route.baseUrl,
    model: route.model,
    modelRecord: route.modelRecord,
    protocol: route.protocol,
    compat: route.compat,
    extra: route.extra,
    retryPolicy: retryPolicy || route.retryPolicy,
    effort: effortFor(route, effort),
    efforts: route.efforts,
    messages,
    tools,
    maxTokens,
    temperature,
    json,
    signal,
    onRetry,
  });
  const toolCalls = (result.toolCalls || []).map((call) => ({
    id: call.id,
    type: 'function',
    function: { name: call.function.name, arguments: call.function.arguments },
  }));
  return {
    model: route.model,
    provider: route.provider,
    choices: [{
      message: {
        role: 'assistant',
        content: result.content || '',
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: result.stopReason === 'toolUse' ? 'tool_calls' : (result.stopReason || 'stop'),
    }],
    usage: result.usage,
  };
}
