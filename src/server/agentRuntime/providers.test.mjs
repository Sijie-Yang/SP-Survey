import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_PROVIDERS } from './catalog.mjs';
import { chatCompletion, resolveLocalRoute } from './localRoutes.mjs';
import { expectedRequestUrl, stubResponse } from './__fixtures__/providerStubs.mjs';

const KEY = 'sk-user-own-key-1234';
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TOOL = {
  type: 'function',
  function: {
    name: 'survey_get_draft',
    description: 'Read the draft.',
    parameters: { type: 'object', properties: { view: { type: 'string' } } },
  },
};
const ENDPOINT_OVERRIDES = {
  'cloudflare-ai-gateway': 'https://gateway.ai.cloudflare.com/v1/acct-1/gw-1',
  'cloudflare-workers-ai': 'https://api.cloudflare.com/client/v4/accounts/acct-1/ai/v1',
};

const apiKeyProviders = CATALOG_PROVIDERS.filter((provider) => provider.auth === 'api-key');

function storeFor(providerId) {
  return {
    providers: {
      [providerId]: {
        provider: providerId,
        apiKey: KEY,
        hint: 'sk-u…1234',
        baseUrl: ENDPOINT_OVERRIDES[providerId] || '',
      },
    },
    settings: {},
  };
}

/** One representative model per distinct (protocol, base URL) the provider uses. */
function representativeModels(provider) {
  const seen = new Map();
  for (const model of provider.models) {
    const key = `${model.api}|${model.baseUrl}`;
    if (!seen.has(key)) seen.set(key, model);
  }
  const defaults = Object.values(provider.defaultModels).filter(Boolean);
  for (const id of defaults) {
    const model = provider.models.find((item) => item.id === id);
    if (model) seen.set(`default|${id}`, model);
  }
  return [...seen.values()];
}

function assertAuth(providerId, protocol, headers) {
  if (providerId === 'cloudflare-ai-gateway') {
    assert.equal(headers.get('cf-aig-authorization'), `Bearer ${KEY}`);
    assert.equal(headers.get('authorization'), null);
    assert.equal(headers.get('x-api-key'), null);
    return;
  }
  if (protocol === 'anthropic-messages') {
    const sent = headers.get('x-api-key') || headers.get('authorization')?.replace(/^Bearer /, '');
    assert.equal(sent, KEY);
    assert.ok(headers.get('anthropic-version'));
    return;
  }
  if (protocol === 'google-generative-ai') {
    assert.equal(headers.get('x-goog-api-key'), KEY);
    return;
  }
  assert.equal(headers.get('authorization'), `Bearer ${KEY}`);
}

let originalFetch;
let calls;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(protocolOf, options = {}) {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
    const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ url, headers, body, method: init.method });
    return stubResponse(protocolOf(url), options);
  };
}

describe('every bring-your-own-key provider routes through its native adapter', () => {
  it('covers all 35 API-key providers from the shared catalog', () => {
    assert.equal(apiKeyProviders.length, 35);
  });

  for (const provider of apiKeyProviders) {
    describe(provider.id, () => {
      for (const model of representativeModels(provider)) {
        it(`${model.api} ${model.id} uses the catalog endpoint, auth, and body`, async () => {
          const route = resolveLocalRoute(storeFor(provider.id), { provider: provider.id, model: model.id });
          assert.equal(route.protocol, model.api);
          assert.equal(route.apiKey, KEY);
          stubFetch(() => route.protocol, { text: 'OK' });
          const completion = await chatCompletion(route, {
            messages: [
              { role: 'system', content: 'You design surveys.' },
              { role: 'user', content: 'Hello' },
            ],
            tools: [TOOL],
            maxTokens: 64,
            retryPolicy: { maxRetries: 0 },
          });
          assert.equal(completion.choices[0].message.content, 'OK');
          assert.equal(calls.length, 1);
          const [call] = calls;
          assert.equal(call.method, 'POST');
          const expected = expectedRequestUrl(route.protocol, route.baseUrl, model.id);
          assert.ok(call.url.startsWith(expected), `${call.url} should start with ${expected}`);
          assert.ok(!/[{}]/.test(call.url), 'no unresolved URL placeholders');
          assertAuth(provider.id, route.protocol, call.headers);
          if (provider.id === 'openrouter' || provider.id === 'vercel-ai-gateway') {
            assert.equal(call.headers.get('x-title'), 'SP-Survey');
          }
          for (const [name, value] of Object.entries(model.headers || {})) {
            assert.equal(call.headers.get(name), value, `catalog header ${name}`);
          }
          const body = JSON.parse(call.body);
          if (route.protocol !== 'google-generative-ai') assert.equal(body.model, model.id);
          assert.match(call.body, /survey_get_draft/, 'tool definitions are sent');
          assert.match(call.body, /You design surveys\./, 'system prompt is sent');
        });
      }
    });
  }
});

describe('tool calls come back in OpenAI shape for the Assistant harness', () => {
  for (const [providerId, modelId] of [
    ['openai', 'gpt-5.6-sol'],
    ['openrouter', 'openai/gpt-5.6-sol'],
    ['anthropic', 'claude-sonnet-5'],
    ['google', 'gemini-3.8-flash'],
    ['mistral', 'mistral-large-latest'],
    ['deepseek', 'deepseek-v4-pro'],
  ]) {
    it(`${providerId} returns tool_calls`, async () => {
      const route = resolveLocalRoute(storeFor(providerId), { provider: providerId, model: modelId });
      stubFetch(() => route.protocol, { text: '', toolCall: { name: 'survey_get_draft', args: { view: 'catalog' } } });
      const completion = await chatCompletion(route, {
        messages: [{ role: 'user', content: 'Read the draft' }],
        tools: [TOOL],
        retryPolicy: { maxRetries: 0 },
      });
      const [call] = completion.choices[0].message.tool_calls;
      assert.equal(call.function.name, 'survey_get_draft');
      assert.deepEqual(JSON.parse(call.function.arguments), { view: 'catalog' });
      assert.equal(completion.choices[0].finish_reason, 'tool_calls');
    });

    it(`${providerId} replays tool results in the next request`, async () => {
      const route = resolveLocalRoute(storeFor(providerId), { provider: providerId, model: modelId });
      stubFetch(() => route.protocol, { text: 'Done' });
      await chatCompletion(route, {
        messages: [
          { role: 'user', content: 'Read the draft' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'survey_get_draft', arguments: '{"view":"catalog"}' } }],
          },
          { role: 'tool', tool_call_id: 'call_1', name: 'survey_get_draft', content: '{"ok":true,"pages":2}' },
        ],
        tools: [TOOL],
        retryPolicy: { maxRetries: 0 },
      });
      assert.match(calls[0].body, /\\"pages\\":2|"pages":2/);
    });
  }
});

describe('Silicon vision routes', () => {
  for (const provider of apiKeyProviders) {
    const siliconId = provider.defaultModels.silicon;
    if (!siliconId) continue;
    it(`${provider.id} sends images to ${siliconId}`, async () => {
      const route = resolveLocalRoute(storeFor(provider.id), { provider: provider.id, vision: true });
      assert.equal(route.model, siliconId);
      assert.ok(route.modelRecord.vision);
      stubFetch(() => route.protocol, { text: '{"answer":3}' });
      const completion = await chatCompletion(route, {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Rate this street.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${PIXEL}` } },
          ],
        }],
        retryPolicy: { maxRetries: 0 },
      });
      assert.equal(completion.choices[0].message.content, '{"answer":3}');
      assert.ok(calls[0].body.includes(PIXEL), 'image bytes are in the request');
    });
  }

  it('rejects text-only models for Silicon', () => {
    assert.throws(
      () => resolveLocalRoute(storeFor('deepseek'), { provider: 'deepseek', model: 'deepseek-v4-pro', vision: true }),
      (error) => error.code === 'VISION_MODEL_REQUIRED',
    );
  });
});

describe('route resolution keeps keys with their provider', () => {
  it('prefers the saved provider key over a browser legacy key', () => {
    const route = resolveLocalRoute(storeFor('anthropic'), { provider: 'anthropic', apiKey: 'sk-openai-legacy' });
    assert.equal(route.apiKey, KEY);
  });

  it('uses a legacy key only for the provider it belongs to', () => {
    const route = resolveLocalRoute({ providers: {} }, { apiKey: 'sk-or-legacy-abc' });
    assert.equal(route.provider, 'openrouter');
    assert.equal(route.baseUrl, 'https://openrouter.ai/api/v1');
    assert.equal(route.model, 'openai/gpt-5.6-sol');
  });

  it('refuses native-auth providers instead of sending an API key', () => {
    for (const id of ['amazon-bedrock', 'google-vertex', 'azure-openai-responses', 'openai-codex', 'github-copilot']) {
      assert.throws(
        () => resolveLocalRoute(storeFor(id), { provider: id }),
        (error) => error.code === 'AUTH_UNSUPPORTED',
        id,
      );
    }
  });

  it('asks for a Cloudflare endpoint before routing gateway models', () => {
    const store = storeFor('cloudflare-workers-ai');
    store.providers['cloudflare-workers-ai'].baseUrl = '';
    assert.throws(
      () => resolveLocalRoute(store, { provider: 'cloudflare-workers-ai' }),
      (error) => error.code === 'PROVIDER_ENDPOINT_REQUIRED',
    );
  });

  it('routes custom OpenAI-compatible providers to their saved base URL', () => {
    const route = resolveLocalRoute({
      providers: {
        'my-vllm': {
          provider: 'my-vllm',
          apiKey: KEY,
          custom: true,
          baseUrl: 'http://127.0.0.1:8000/v1',
          protocol: 'openai-completions',
          models: [{ id: 'qwen3-vl', name: 'Qwen3 VL', input: ['text', 'image'] }],
        },
      },
    }, { provider: 'my-vllm', vision: true });
    assert.equal(route.baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(route.model, 'qwen3-vl');
    assert.equal(route.protocol, 'openai-completions');
  });
});
