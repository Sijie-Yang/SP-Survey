/** Self-hosted: the route is the provider's base URL and protocol from the local credential store. */
export function assertRoute({ provider, model, profile, credential, requireConfigured } = {}) {
  if (requireConfigured && !credential?.apiKey) {
    throw Object.assign(new Error('The Assistant model is not configured. Add a model and key in AI & Integrations.'), {
      status: 400,
      code: 'CREDENTIALS_MISSING',
    });
  }
  if (!model) {
    throw Object.assign(new Error(`Choose a model for ${provider || 'the Assistant'} in AI & Integrations.`), {
      status: 400,
      code: 'MODEL_MISSING',
    });
  }
  return {
    route: {
      baseUrl: profile?.baseUrl || '',
      protocol: profile?.protocol || 'openai-completions',
      headers: profile?.headers || {},
    },
  };
}
