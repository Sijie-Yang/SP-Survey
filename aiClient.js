/**
 * AI client — uses the API key provided by the user (OpenAI or OpenRouter BYOK).
 */
const OpenAI = require('openai');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

const OPENROUTER_MODELS = {
  fast: 'openai/gpt-4o-mini',
  default: 'openai/gpt-4o',
  strong: 'openai/gpt-4o',
};

const OPENAI_MODELS = {
  fast: 'gpt-4o-mini',
  default: 'gpt-4o',
  strong: 'gpt-4o',
};

/** @returns {{ client, models, provider: 'openrouter'|'openai' } | null} */
function resolveAiRequest(userApiKey) {
  const trimmed = userApiKey?.trim();
  if (!trimmed) return null;

  const isOpenRouter = trimmed.startsWith('sk-or-');
  return {
    client: new OpenAI({
      apiKey: trimmed,
      baseURL: isOpenRouter ? OPENROUTER_BASE : undefined,
      defaultHeaders: isOpenRouter ? openRouterHeaders() : undefined,
    }),
    models: isOpenRouter ? OPENROUTER_MODELS : OPENAI_MODELS,
    provider: isOpenRouter ? 'openrouter' : 'openai',
  };
}

function openRouterHeaders() {
  return {
    'HTTP-Referer': process.env.APP_URL || 'http://localhost:3002',
    'X-Title': process.env.APP_NAME || 'SP-Survey-Platform',
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

/** tier: 'fast' | 'default' | 'strong' */
async function aiChat(resolved, tier, options) {
  if (!resolved) throw new Error('API key is required');
  const model = options.model || resolved.models[tier] || resolved.models.default;
  const { model: _drop, ...rest } = options;
  return resolved.client.chat.completions.create({ ...rest, model });
}

module.exports = {
  resolveAiRequest,
  aiChat,
  formatAiError,
};
