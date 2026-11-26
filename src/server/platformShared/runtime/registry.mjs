/** Self-hosted: the model is the one saved in AI & Integrations (or the provider's default). */
export function availableModelId(_provider, requested, { profile } = {}) {
  return requested || profile?.defaultModel || '';
}

export function resolveModel(_provider, model) {
  return { id: model, maxTokens: 8192 };
}
