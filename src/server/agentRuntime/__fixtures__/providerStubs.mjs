/**
 * Protocol-accurate streaming responses used by the provider adapter tests
 * and the local stub server. No network access is involved.
 */

function sse(events, { named = false } = {}) {
  const body = events.map((event) => (named
    ? `event: ${event.type}\ndata: ${JSON.stringify(event)}`
    : `data: ${typeof event === 'string' ? event : JSON.stringify(event)}`)).join('\n\n');
  return new Response(`${body}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function completionEvents(text, toolCall) {
  const events = [
    { id: 'chunk_1', model: 'stub', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
  ];
  if (toolCall) {
    events.push({
      id: 'chunk_1',
      model: 'stub',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args || {}) },
          }],
        },
        finish_reason: null,
      }],
    });
  }
  events.push({
    id: 'chunk_1',
    model: 'stub',
    choices: [{ index: 0, delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
  events.push('[DONE]');
  return events;
}

function responsesEvents(text, toolCall) {
  const output = [];
  const events = [
    { type: 'response.created', sequence_number: 0, response: { id: 'resp_1', status: 'in_progress', output: [] } },
    {
      type: 'response.output_item.added',
      sequence_number: 1,
      output_index: 0,
      item: { id: 'msg_1', type: 'message', role: 'assistant', status: 'in_progress', content: [] },
    },
    {
      type: 'response.content_part.added',
      sequence_number: 2,
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    },
    { type: 'response.output_text.delta', sequence_number: 3, item_id: 'msg_1', output_index: 0, content_index: 0, delta: text },
    {
      type: 'response.output_item.done',
      sequence_number: 4,
      output_index: 0,
      item: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    },
  ];
  output.push(events[4].item);
  if (toolCall) {
    const item = {
      id: 'fc_1',
      type: 'function_call',
      call_id: 'call_1',
      name: toolCall.name,
      arguments: '',
      status: 'in_progress',
    };
    const args = JSON.stringify(toolCall.args || {});
    events.push(
      { type: 'response.output_item.added', sequence_number: 5, output_index: 1, item },
      { type: 'response.function_call_arguments.delta', sequence_number: 6, item_id: 'fc_1', output_index: 1, delta: args },
      { type: 'response.function_call_arguments.done', sequence_number: 7, item_id: 'fc_1', output_index: 1, arguments: args },
      { type: 'response.output_item.done', sequence_number: 8, output_index: 1, item: { ...item, arguments: args, status: 'completed' } },
    );
    output.push({ ...item, arguments: args, status: 'completed' });
  }
  events.push({
    type: 'response.completed',
    sequence_number: 9,
    response: {
      id: 'resp_1',
      status: 'completed',
      output,
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5, input_tokens_details: { cached_tokens: 0 } },
    },
  });
  return events;
}

function anthropicEvents(text, toolCall) {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'stub',
        content: [],
        stop_reason: null,
        usage: { input_tokens: 3, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
  ];
  if (toolCall) {
    events.push(
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: toolCall.name, input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolCall.args || {}) } },
      { type: 'content_block_stop', index: 1 },
    );
  }
  events.push(
    { type: 'message_delta', delta: { stop_reason: toolCall ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  );
  return events;
}

function googleEvents(text, toolCall) {
  const parts = [{ text }];
  if (toolCall) parts.push({ functionCall: { name: toolCall.name, args: toolCall.args || {} } });
  return [{
    candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
  }];
}

/** Build the streaming response a provider would send for this protocol. */
export function stubResponse(protocol, { text = 'OK', toolCall = null } = {}) {
  if (protocol === 'openai-responses') return sse(responsesEvents(text, toolCall), { named: true });
  if (protocol === 'anthropic-messages') return sse(anthropicEvents(text, toolCall), { named: true });
  if (protocol === 'google-generative-ai') return sse(googleEvents(text, toolCall));
  return sse(completionEvents(text, toolCall));
}

/** The request path each protocol appends to the provider base URL. */
export function expectedRequestUrl(protocol, baseUrl, modelId) {
  const base = String(baseUrl).replace(/\/$/, '');
  if (protocol === 'openai-responses') return `${base}/responses`;
  if (protocol === 'anthropic-messages') return `${base}/v1/messages`;
  if (protocol === 'google-generative-ai') return `${base}/models/${modelId}:streamGenerateContent`;
  if (protocol === 'mistral-conversations') return `${base}/v1/chat/completions`;
  return `${base}/chat/completions`;
}

/** Guess the protocol from a request path, for the local stub server. */
export function protocolForPath(pathname) {
  if (pathname.endsWith('/responses')) return 'openai-responses';
  if (pathname.endsWith('/v1/messages')) return 'anthropic-messages';
  if (pathname.includes(':streamGenerateContent')) return 'google-generative-ai';
  return 'openai-completions';
}
