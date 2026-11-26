/** Self-hosted credentials: the researcher's own keys from the local credential store. */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveAssistantRoute } = require('../agentCredentialsApi');

function profileOf(route) {
  return {
    provider: route.provider,
    baseUrl: route.baseUrl || '',
    protocol: route.protocol || 'openai-completions',
    headers: route.headers || {},
    defaultModel: route.model || '',
  };
}

export async function loadUserAiSettings() {
  const route = await resolveAssistantRoute();
  if (!route) return {};
  return { ...route.settings, assistant_provider: route.provider, assistant_model: route.model };
}

export async function listProviderProfiles() {
  const route = await resolveAssistantRoute();
  return route ? [profileOf(route)] : [];
}

export async function resolveAssistantBinding(_env, _userId, provider, model) {
  const route = await resolveAssistantRoute({ provider, model });
  if (!route) return null;
  return { credential: { apiKey: route.apiKey }, profile: profileOf(route), source: 'local' };
}
