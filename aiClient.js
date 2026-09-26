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

const PROVIDER_BASES = {
  openai: undefined,
  openrouter: OPENROUTER_BASE,
  deepseek: 'https://api.deepseek.com/v1',
  'qwen-dashscope': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  minimax: 'https://api.minimax.chat/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  together: 'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
};

function providerHeaders(provider) {
  if (provider === 'openrouter' || provider === 'vercel-ai-gateway') return openRouterHeaders();
  if (provider === 'anthropic') return { 'anthropic-version': '2023-06-01' };
  return undefined;
}

/** @returns {{ client, models, provider, protocol } | null} */
function resolveAiRequest(userApiKey, extras = {}) {
  const trimmed = userApiKey?.trim();
  if (!trimmed) return null;

  const provider = extras.provider
    || (trimmed.startsWith('sk-or-') ? 'openrouter' : trimmed.startsWith('sk-ant-') ? 'anthropic' : 'openai');
  const protocol = extras.protocol || (provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions');
  const baseURL = extras.baseUrl || PROVIDER_BASES[provider];
  return {
    client: new OpenAI({
      apiKey: trimmed,
      baseURL,
      defaultHeaders: providerHeaders(provider),
    }),
    models: provider === 'openrouter' ? OPENROUTER_MODELS : OPENAI_MODELS,
    provider,
    protocol,
    apiKey: trimmed,
    baseURL,
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

async function anthropicChat(resolved, options) {
  const model = options.model || 'claude-sonnet-4-5';
  const url = `${String(resolved.baseURL || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': resolved.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: options.max_tokens || 4096,
      system: (options.messages || []).filter((row) => row.role === 'system').map((row) => row.content).join('\n'),
      messages: (options.messages || []).filter((row) => row.role !== 'system').map((row) => ({
        role: row.role === 'tool' ? 'user' : row.role,
        content: typeof row.content === 'string' ? row.content : JSON.stringify(row.content || ''),
      })),
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `Anthropic ${response.status}`);
  return {
    choices: [{
      message: {
        role: 'assistant',
        content: (body.content || []).map((part) => part.text || '').join('\n'),
      },
    }],
    usage: body.usage,
  };
}

/** tier: 'fast' | 'default' | 'strong' */
async function aiChat(resolved, tier, options) {
  if (!resolved) throw new Error('API key is required');
  const model = options.model || resolved.models[tier] || resolved.models.default;
  const { model: _drop, ...rest } = options;
  if (resolved.protocol === 'anthropic-messages') {
    return anthropicChat(resolved, { ...rest, model });
  }
  return resolved.client.chat.completions.create({ ...rest, model });
}

module.exports = {
  resolveAiRequest,
  aiChat,
  formatAiError,
};
