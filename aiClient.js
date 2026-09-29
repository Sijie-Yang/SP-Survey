/**
 * AI client — routes every call through the Platform-aligned provider catalog
 * and pi-ai adapters, using only the researcher's own provider keys.
 */

function detectLegacyProvider(apiKey) {
  const key = String(apiKey || '').trim();
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('sk-ant-')) return 'anthropic';
  return 'openai';
}

function loadRuntime() {
  return import('./src/server/agentRuntime/localRoutes.mjs');
}

/**
 * @param {string} userApiKey Browser-supplied legacy key (optional when a provider key is saved).
 * @param {{ provider?: string, model?: string, store?: object, vision?: boolean }} extras
 *   Pass `store: {}` to use only `userApiKey` (for example when validating a new key).
 */
function resolveAiRequest(userApiKey, extras = {}) {
  const apiKey = String(userApiKey || '').trim();
  if (!apiKey && !extras.provider && !extras.store) return null;
  return {
    apiKey,
    provider: extras.provider || (apiKey ? detectLegacyProvider(apiKey) : ''),
    model: extras.model || '',
    vision: Boolean(extras.vision),
    store: extras.store || null,
  };
}

function formatAiError(error) {
  const status = error?.status || error?.response?.status;
  const msg = error?.message || error?.error?.message || String(error);
  if (status === 429 || msg.toLowerCase().includes('rate limit') || msg.includes('429')) {
    return 'API rate limit reached. Wait a moment and retry, or check your provider quota.';
  }
  return msg;
}

async function resolveRoute(resolved, options = {}) {
  const runtime = await loadRuntime();
  const store = resolved.store || await require('./src/server/agentCredentialsApi').readStore();
  return runtime.resolveLocalRoute(store, {
    provider: resolved.provider,
    model: options.model || resolved.model,
    apiKey: resolved.apiKey,
    vision: resolved.vision,
  });
}

/** tier is kept for older callers; the catalog default model is used when no model is given. */
async function aiChat(resolved, _tier, options = {}) {
  if (!resolved) throw new Error('API key is required');
  const runtime = await loadRuntime();
  const route = await resolveRoute(resolved, options);
  return runtime.chatCompletion(route, {
    messages: options.messages || [],
    tools: options.tools || [],
    effort: options.reasoningEffort || options.effort,
    maxTokens: options.max_tokens || options.maxTokens,
    temperature: options.temperature,
    json: options.response_format?.type === 'json_object' || Boolean(options.json),
    signal: options.signal,
    retryPolicy: options.retryPolicy,
  });
}

module.exports = {
  resolveAiRequest,
  resolveRoute,
  aiChat,
  formatAiError,
  detectLegacyProvider,
};
