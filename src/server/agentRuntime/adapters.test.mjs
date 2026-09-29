import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRequest, normalizeStopReason } from './adapters.mjs';
import { resolveModelRoute } from './registry.mjs';

function completionSse(content = 'OK') {
  return new Response([
    `data: {"id":"response_1","choices":[{"delta":{"role":"assistant","content":${JSON.stringify(content)}},"finish_reason":null}]}`,
    'data: {"id":"response_1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}',
    'data: [DONE]',
    '',
  ].join('\n\n'), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function openAiOptions(overrides = {}) {
  return {
    apiKey: 'test-key',
    provider: 'test-provider',
    baseUrl: 'https://api.example.com/v1',
    model: 'test-model',
    modelRecord: {
      id: 'test-model',
      name: 'Test Model',
      api: 'openai-completions',
      provider: 'test-provider',
      baseUrl: 'https://api.example.com/v1',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    },
    protocol: 'openai-completions',
    messages: [{ role: 'user', content: 'Hello' }],
    retryPolicy: { maxRetries: 0, initialMs: 0, maxMs: 0, jitter: 0 },
    ...overrides,
  };
}

describe('pi-ai runtime adapter', () => {
  it('keeps pi retries disabled and reports SP outer retries', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    const retries = [];
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: 'temporary' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return completionSse();
    };
    try {
      const result = await modelRequest(openAiOptions({
        retryPolicy: { maxRetries: 1, initialMs: 0, maxMs: 0, jitter: 0 },
        onRetry: async (info) => retries.push(info),
      }));
      assert.equal(result.content, 'OK');
      assert.equal(calls, 2);
      assert.equal(retries.length, 1);
      assert.equal(retries[0].code, 'SERVER');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses Cloudflare gateway authorization without leaking vendor auth headers', async () => {
    const originalFetch = globalThis.fetch;
    let headers;
    globalThis.fetch = async (_url, init) => {
      headers = new Headers(init.headers);
      return completionSse();
    };
    try {
      await modelRequest(openAiOptions({
        provider: 'cloudflare-ai-gateway',
        apiKey: 'gateway-token',
        baseUrl: 'https://gateway.ai.cloudflare.com/v1/account/gateway/compat',
      }));
      assert.equal(headers.get('cf-aig-authorization'), 'Bearer gateway-token');
      assert.equal(headers.has('authorization'), false);
      assert.equal(headers.has('x-api-key'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maps an explicit off effort to pi-ai disabled reasoning', async () => {
    const originalFetch = globalThis.fetch;
    let body;
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(init.body);
      return completionSse();
    };
    try {
      const route = resolveModelRoute('qwen-token-plan-cn', 'deepseek-v3.2');
      await modelRequest({
        ...openAiOptions(),
        provider: 'qwen-token-plan-cn',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        compat: route.model.compat,
        effort: 'off',
      });
      assert.equal(body.enable_thinking, false);
      assert.equal(body.reasoning_effort, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('omits forced tool_choice for DashScope models in thinking mode', async () => {
    const originalFetch = globalThis.fetch;
    let body;
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(init.body);
      return completionSse();
    };
    try {
      const route = resolveModelRoute('qwen-dashscope', 'deepseek-v4-flash');
      await modelRequest({
        ...openAiOptions(),
        provider: 'qwen-dashscope',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        compat: route.model.compat,
        effort: 'high',
        tools: [{
          type: 'function',
          function: {
            name: 'survey_get_draft',
            description: 'Read draft',
            parameters: { type: 'object', properties: {} },
          },
        }],
        toolChoice: {
          type: 'function',
          function: { name: 'survey_get_draft' },
        },
      });
      assert.equal(body.enable_thinking, true);
      assert.equal(body.tool_choice, undefined);
      assert.equal(body.tools[0].function.name, 'survey_get_draft');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('retries once without tool_choice when a compatible endpoint rejects it in thinking mode', async () => {
    const originalFetch = globalThis.fetch;
    const bodies = [];
    const retries = [];
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) {
        return new Response(JSON.stringify({
          error: {
            message: 'The tool_choice parameter does not support being set to required or object in thinking mode',
          },
        }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return completionSse();
    };
    try {
      const result = await modelRequest(openAiOptions({
        toolChoice: {
          type: 'function',
          function: { name: 'survey_get_draft' },
        },
        onRetry: async (info) => retries.push(info),
      }));
      assert.equal(result.content, 'OK');
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0].tool_choice.function.name, 'survey_get_draft');
      assert.equal(bodies[1].tool_choice, undefined);
      assert.equal(retries[0].code, 'TOOL_CHOICE_UNSUPPORTED_IN_THINKING');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lets pi-ai clamp DeepSeek V4 Flash medium effort to high', async () => {
    const originalFetch = globalThis.fetch;
    let body;
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(init.body);
      return completionSse();
    };
    try {
      const route = resolveModelRoute('deepseek', 'deepseek-v4-flash');
      await modelRequest({
        ...openAiOptions(),
        provider: 'deepseek',
        baseUrl: route.baseUrl,
        model: route.model.id,
        modelRecord: route.model,
        compat: route.model.compat,
        effort: 'medium',
      });
      assert.equal(body.thinking.type, 'enabled');
      assert.equal(body.reasoning_effort, 'high');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses native Google transport and does not retry authentication failures', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({
        error: {
          code: 401,
          message: 'API key not valid.',
          status: 'UNAUTHENTICATED',
        },
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    };
    try {
      const route = resolveModelRoute('google', 'gemini-3.8-flash');
      await assert.rejects(
        modelRequest({
          ...openAiOptions(),
          provider: 'google',
          baseUrl: route.baseUrl,
          model: route.model.id,
          modelRecord: route.model,
          protocol: route.protocol,
          retryPolicy: { maxRetries: 1, initialMs: 0, maxMs: 0, jitter: 0 },
        }),
        (error) => error.status === 401 && error.code === 'CLIENT',
      );
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('blocks cloud metadata image URLs before fetching them', async () => {
    const originalFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      return completionSse();
    };
    try {
      await assert.rejects(
        modelRequest(openAiOptions({
          messages: [{
            role: 'user',
            content: [{
              type: 'image_url',
              image_url: { url: 'http://169.254.169.254/latest/meta-data.png' },
            }],
          }],
        })),
        /not allowed/,
      );
      assert.equal(fetched, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('loads images served by the local SP-Survey server', async () => {
    const originalFetch = globalThis.fetch;
    const urls = [];
    let requestBody = '';
    globalThis.fetch = async (url, init = {}) => {
      urls.push(String(url));
      if (String(url).startsWith('http://localhost:3001/')) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '4' },
        });
      }
      requestBody = String(init.body || '');
      return completionSse();
    };
    try {
      await modelRequest(openAiOptions({
        modelRecord: { ...openAiOptions().modelRecord, input: ['text', 'image'] },
        messages: [{
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'http://localhost:3001/projects/p/media/a.png' } }],
        }],
      }));
      assert.equal(urls[0], 'http://localhost:3001/projects/p/media/a.png');
      assert.match(requestBody, /data:image\/png;base64,iVBORw==/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('normalizes provider length stop reasons', () => {
    assert.equal(normalizeStopReason('length'), 'length');
    assert.equal(normalizeStopReason('max_tokens'), 'length');
    assert.equal(normalizeStopReason('tool_calls'), 'toolUse');
    assert.equal(normalizeStopReason('stop'), 'stop');
  });
});
