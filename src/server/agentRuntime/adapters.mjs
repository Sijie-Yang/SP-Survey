import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';
import { mistralConversationsApi } from '@earendil-works/pi-ai/api/mistral-conversations.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { classifyHttpError, parseRetryAfter, withRetry } from './retry.mjs';
import { assertProviderResponseNotRedirect, assertSafeBaseUrl } from './ssrf.mjs';
import { createRawToolArgCollector, parseRawToolArguments } from './toolArgs.mjs';

const API_IMPLEMENTATIONS = {
  'anthropic-messages': anthropicMessagesApi(),
  'google-generative-ai': googleGenerativeAIApi(),
  'mistral-conversations': mistralConversationsApi(),
  'openai-completions': openAICompletionsApi(),
  'openai-responses': openAIResponsesApi(),
};

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function imageFromUrl(url, signal) {
  if (String(url).startsWith('data:')) {
    const match = String(url).match(/^data:([^;,]+);base64,(.+)$/);
    if (!match || !match[1].startsWith('image/')) {
      throw Object.assign(new Error('Unsupported image data URL.'), { code: 'IMAGE_INVALID' });
    }
    if (Math.ceil(match[2].length * 0.75) > MAX_IMAGE_BYTES) {
      throw Object.assign(new Error('Model input image exceeded 8 MiB.'), {
        status: 400,
        code: 'IMAGE_TOO_LARGE',
      });
    }
    return { type: 'image', mimeType: match[1], data: match[2] };
  }
  assertSafeBaseUrl(url);
  const response = await fetch(url, { signal, redirect: 'manual' });
  assertProviderResponseNotRedirect(response);
  if (!response.ok) {
    throw Object.assign(new Error(`Could not load model input image (${response.status}).`), {
      status: 400,
      code: 'IMAGE_FETCH_FAILED',
    });
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0] || '';
  if (!mimeType.startsWith('image/')) {
    throw Object.assign(new Error('Model input URL did not return an image.'), {
      status: 400,
      code: 'IMAGE_INVALID',
    });
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error('Model input image exceeded 8 MiB.'), {
      status: 400,
      code: 'IMAGE_TOO_LARGE',
    });
  }
  const chunks = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (!reader) {
    throw Object.assign(new Error('Model input image had no body.'), {
      status: 400,
      code: 'IMAGE_INVALID',
    });
  }
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error('Model input image exceeded 8 MiB.'), {
        status: 400,
        code: 'IMAGE_TOO_LARGE',
      });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    type: 'image',
    mimeType,
    data: bytesToBase64(bytes),
  };
}

async function userContent(content, signal) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  const converted = [];
  for (const part of content) {
    if (part?.type === 'text') {
      converted.push({ type: 'text', text: String(part.text || '') });
    } else if (part?.type === 'image' && part.data) {
      converted.push({
        type: 'image',
        data: part.data,
        mimeType: part.mimeType || 'image/jpeg',
      });
    } else if (part?.type === 'image_url' && part.image_url?.url) {
      converted.push(await imageFromUrl(part.image_url.url, signal));
    }
  }
  return converted.length ? converted : '';
}

function assistantContent(message) {
  const content = [];
  if (message.content) {
    content.push({
      type: 'text',
      text: typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
    });
  }
  for (const call of message.tool_calls || []) {
    let args = {};
    try {
      args = JSON.parse(call.function?.arguments || '{}');
    } catch {
      args = {};
    }
    content.push({
      type: 'toolCall',
      id: call.id,
      name: call.function?.name || call.name,
      arguments: args,
    });
  }
  return content;
}

async function toPiContext(messages, tools, signal) {
  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => String(message.content || ''))
    .join('\n\n');
  const converted = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (
      message.role === 'assistant'
      && Array.isArray(message.content)
      && message.api
      && message.model
      && message.usage
    ) {
      converted.push(message);
      continue;
    }
    if (message.role === 'toolResult') {
      converted.push(message);
      continue;
    }
    if (message.role === 'user') {
      converted.push({
        role: 'user',
        content: await userContent(message.content, signal),
        timestamp: Date.now(),
      });
    } else if (message.role === 'assistant') {
      const content = assistantContent(message);
      converted.push({
        role: 'assistant',
        content,
        api: message.api || 'openai-completions',
        provider: message.provider || 'history',
        model: message.model || 'history',
        usage: EMPTY_USAGE,
        stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
        timestamp: Date.now(),
      });
    } else if (message.role === 'tool') {
      converted.push({
        role: 'toolResult',
        toolCallId: message.tool_call_id,
        toolName: message.name || 'tool',
        content: [{ type: 'text', text: String(message.content || '') }],
        isError: false,
        timestamp: Date.now(),
      });
    }
  }
  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages: converted,
    tools: (tools || []).map((tool) => ({
      name: tool.function?.name || tool.name,
      description: tool.function?.description || tool.description || '',
      parameters: tool.function?.parameters || tool.parameters || { type: 'object', properties: {} },
    })),
  };
}

function makeSafeProviderFetch(responseMeta, options) {
  return async (input, init = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    assertSafeBaseUrl(url);
    let headers = init.headers;
    if (options.provider === 'cloudflare-ai-gateway') {
      headers = new Headers(init.headers);
      headers.delete('authorization');
      headers.delete('x-api-key');
      headers.set('cf-aig-authorization', `Bearer ${options.apiKey}`);
    }
    const response = await fetch(input, { ...init, headers, redirect: 'manual' });
    responseMeta.status = response.status;
    responseMeta.retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    assertProviderResponseNotRedirect(response);
    return response;
  };
}

function piModel(options) {
  const source = options.modelRecord || {};
  return {
    id: options.model,
    name: source.name || source.label || options.model,
    api: options.protocol || source.api || 'openai-completions',
    provider: options.provider,
    baseUrl: assertSafeBaseUrl(options.baseUrl || source.baseUrl),
    reasoning: Boolean(source.reasoning || source.reasoningEfforts),
    ...(source.thinkingLevelMap ? { thinkingLevelMap: source.thinkingLevelMap } : {}),
    input: source.input || ['text'],
    cost: source.cost || EMPTY_USAGE.cost,
    contextWindow: Number(source.contextWindow || 128000),
    maxTokens: Number(source.maxTokens || options.maxTokens || 8192),
    ...(source.samplingParams ? { samplingParams: source.samplingParams } : {}),
    ...(source.headers && Object.keys(source.headers).length ? { headers: source.headers } : {}),
    ...(options.compat && Object.keys(options.compat).length ? { compat: options.compat } : {}),
  };
}

export function normalizeStopReason(value) {
  const reason = String(value || '').trim();
  if (!reason) return null;
  if (/^(length|max_tokens|max_output_tokens|maxTokens)$/i.test(reason)) return 'length';
  if (/^(toolUse|tool_calls|tool_use)$/i.test(reason)) return 'toolUse';
  if (/^(stop|end_turn|eos)$/i.test(reason)) return 'stop';
  return reason;
}

export function resultFromMessage(message, collector) {
  const content = (message.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('');
  const toolParts = (message.content || []).filter((part) => part.type === 'toolCall');
  const toolCalls = toolParts.map((part, index) => {
    const collected = collector?.lookup(part, index);
    const raw = collected?.raw;
    const parsed = raw
      ? parseRawToolArguments(raw)
      : parseRawToolArguments(part.arguments);
    return {
      id: part.id,
      type: 'function',
      function: {
        name: part.name,
        arguments: parsed.rawArgsComplete
          ? JSON.stringify(parsed.args)
          : (raw || (typeof part.arguments === 'string' ? part.arguments : '')),
      },
      args: parsed.rawArgsComplete ? parsed.args : {},
      rawArguments: raw || null,
      rawArgsComplete: parsed.rawArgsComplete,
      parseError: parsed.parseError,
      argumentOrigin: raw ? 'raw_stream' : parsed.argumentOrigin,
      receivedShape: parsed.receivedShape,
      byteLength: parsed.byteLength,
    };
  });
  const rawStopReason = message.stopReason
    || message.finishReason
    || message.finish_reason
    || message.response?.stopReason
    || null;
  return {
    content,
    toolCalls,
    stopReason: normalizeStopReason(rawStopReason),
    rawStopReason,
    usage: {
      prompt_tokens: Number(message.usage?.input || 0)
        + Number(message.usage?.cacheRead || 0)
        + Number(message.usage?.cacheWrite || 0),
      completion_tokens: Number(message.usage?.output || 0),
      total_tokens: Number(message.usage?.totalTokens || 0),
      cache_read_tokens: Number(message.usage?.cacheRead || 0),
      cache_write_tokens: Number(message.usage?.cacheWrite || 0),
    },
    raw: message,
  };
}

function errorStatus(message) {
  try {
    const parsed = JSON.parse(message);
    const value = Number(parsed?.error?.code || parsed?.status || parsed?.statusCode);
    if (value >= 100 && value <= 599) return value;
  } catch {
    // Provider SDKs may return plain text instead of JSON.
  }
  const match = String(message).match(/\b([1-5]\d\d)\b/);
  return match ? Number(match[1]) : null;
}

function requestHeaders(options) {
  const headers = { ...(options.extra || {}) };
  if (options.provider !== 'cloudflare-ai-gateway') return headers;
  for (const key of Object.keys(headers)) {
    if (['authorization', 'x-api-key', 'cf-aig-authorization'].includes(key.toLowerCase())) {
      delete headers[key];
    }
  }
  headers['cf-aig-authorization'] = `Bearer ${options.apiKey}`;
  return headers;
}

function applyJsonMode(model, options, streamOptions) {
  if (!options.json) return streamOptions;
  if (model.api === 'openai-completions') {
    return {
      ...streamOptions,
      samplingParams: {
        ...(streamOptions.samplingParams || {}),
        response_format: { type: 'json_object' },
      },
    };
  }
  if (model.api === 'openai-responses') {
    return {
      ...streamOptions,
      samplingParams: {
        ...(streamOptions.samplingParams || {}),
        text: { format: { type: 'json_object' } },
      },
    };
  }
  if (model.api === 'google-generative-ai') {
    return {
      ...streamOptions,
      onPayload: (payload) => ({
        ...payload,
        config: {
          ...(payload?.config || {}),
          responseMimeType: 'application/json',
        },
      }),
    };
  }
  if (model.api === 'mistral-conversations') {
    return {
      ...streamOptions,
      onPayload: (payload) => ({
        ...payload,
        responseFormat: { type: 'json_object' },
      }),
    };
  }
  return streamOptions;
}

async function oneAttempt(options, model, implementation, context) {
  const responseMeta = {};
  const samplingParams = { ...(model.samplingParams || {}) };
  const headers = requestHeaders(options);
  const qwenThinking = model.api === 'openai-completions'
    && model.compat?.thinkingFormat === 'qwen'
    && options.effort
    && options.effort !== 'off';
  let streamOptions = {
    // Vendor SDKs refuse to build a request without a key. For Cloudflare AI
    // Gateway the safe fetch strips vendor auth and sends cf-aig-authorization.
    apiKey: options.provider === 'cloudflare-ai-gateway' ? 'cf-aig-gateway' : options.apiKey,
    signal: options.signal,
    headers,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    toolChoice: qwenThinking ? undefined : options.toolChoice,
    maxRetries: 0,
    reasoning: options.effort && options.effort !== 'off' ? options.effort : undefined,
    onResponse: (response) => {
      responseMeta.status = response.status;
      responseMeta.retryAfterMs = parseRetryAfter(
        response.headers?.['retry-after'] || response.headers?.['Retry-After'],
      );
    },
    ...(Object.keys(samplingParams).length ? { samplingParams } : {}),
  };
  if (model.api !== 'google-generative-ai') {
    streamOptions.fetch = makeSafeProviderFetch(responseMeta, options);
  }
  streamOptions = applyJsonMode(model, options, streamOptions);
  const collector = createRawToolArgCollector();
  const stream = implementation.streamSimple(model, context, streamOptions);
  let finalMessage = null;
  for await (const event of stream) {
    collector.onEvent(event);
    if (event.type === 'done') finalMessage = event.message;
    if (event.type === 'error') {
      const message = event.error?.errorMessage || 'Provider request failed.';
      const status = event.reason === 'aborted'
        ? 499
        : (responseMeta.status || errorStatus(message));
      throw Object.assign(new Error(message), {
        status: status || 502,
        code: event.reason === 'aborted' ? 'CANCELLED' : classifyHttpError(status, message),
        retryAfterMs: responseMeta.retryAfterMs,
        provider: options.provider,
        model: options.model,
      });
    }
  }
  if (!finalMessage) {
    throw Object.assign(new Error('Provider stream ended without a final message.'), {
      status: 502,
      code: 'EMPTY_RESPONSE',
    });
  }
  return resultFromMessage(finalMessage, collector);
}

export async function modelRequest(options) {
  const model = piModel(options);
  const implementation = API_IMPLEMENTATIONS[model.api];
  if (!implementation) {
    throw Object.assign(new Error(`Unsupported API protocol: ${model.api}`), {
      status: 400,
      code: 'PROTOCOL_UNSUPPORTED',
    });
  }
  const context = await toPiContext(options.messages || [], options.tools || [], options.signal);
  return withRetry(
    async () => {
      try {
        return await oneAttempt(options, model, implementation, context);
      } catch (error) {
        const unsupportedThinkingToolChoice = Boolean(options.toolChoice)
          && /tool_choice[\s\S]*(?:does not support|unsupported)[\s\S]*(?:thinking|reasoning)|(?:thinking|reasoning)[\s\S]*tool_choice/i
            .test(String(error?.message || ''));
        if (!unsupportedThinkingToolChoice) throw error;
        await options.onRetry?.({
          attempt: 1,
          code: 'TOOL_CHOICE_UNSUPPORTED_IN_THINKING',
          delayMs: 0,
        });
        return oneAttempt(
          { ...options, toolChoice: undefined },
          model,
          implementation,
          context,
        );
      }
    },
    {
      policy: options.retryPolicy,
      signal: options.signal,
      onRetry: options.onRetry,
    },
  );
}

export function toOpenAiTools(toolDefs = []) {
  return toolDefs.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || { type: 'object', properties: {} },
    },
  }));
}
