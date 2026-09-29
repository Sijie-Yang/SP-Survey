export const DEFAULT_COMPAT = {
  supportsDeveloperRole: false,
  maxTokensField: 'max_tokens',
  thinkingFormat: null,
  strictTools: false,
};

export function mergeCompat(routeCompat = {}, modelCompat = {}) {
  return { ...DEFAULT_COMPAT, ...routeCompat, ...modelCompat };
}

export function applyReasoning({ body, protocol, effort, efforts, compat }) {
  if (!effort || effort === 'off' || !efforts) return body;
  const wire = efforts[effort];
  if (wire === undefined) {
    throw Object.assign(new Error(`Unsupported reasoning effort: ${effort}`), {
      status: 400,
      code: 'UNSUPPORTED_REASONING_EFFORT',
    });
  }
  if (wire == null) return body;
  const next = { ...body };
  if (compat.thinkingFormat === 'deepseek' || protocol === 'openai-completions') {
    next.reasoning_effort = wire;
  }
  if (protocol === 'anthropic-messages') {
    next.thinking = { type: 'enabled', budget_tokens: effort === 'high' ? 10000 : 4000 };
  }
  return next;
}

export function systemRole(compat) {
  return compat.supportsDeveloperRole ? 'developer' : 'system';
}

export function setMaxTokens(body, maxTokens, compat) {
  const field = compat.maxTokensField || 'max_tokens';
  return { ...body, [field]: maxTokens };
}
