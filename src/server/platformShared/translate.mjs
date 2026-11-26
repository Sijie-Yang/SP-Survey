/**
 * Translate participant-facing wording with the project's Assistant model.
 * The model receives strings only. It cannot change option codes, logic, or numbers.
 * If the Assistant is not configured, this throws and does not invent a translation.
 */

import { usageMeter } from './usageLog.mjs';

const NUMBER_RE = /\d+(?:\.\d+)?/g;
const TOKEN_RE = /\{[^{}]+\}/g;
const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

function keepsSequence(source, translated, pattern) {
  const parts = String(source || '').match(pattern) || [];
  let rest = String(translated || '');
  return parts.every((part) => {
    const index = rest.indexOf(part);
    if (index < 0) return false;
    rest = rest.slice(index + part.length);
    return true;
  });
}

export function translationPreservesSource(source, translated) {
  if (typeof translated !== 'string' || !translated.trim()) return false;
  return keepsSequence(source, translated, NUMBER_RE)
    && keepsSequence(source, translated, TOKEN_RE)
    && keepsSequence(source, translated, TAG_RE);
}

export function acceptModelTranslations(items, payload) {
  const raw = payload?.translations && typeof payload.translations === 'object' ? payload.translations : {};
  const accepted = {};
  const rejected = [];
  (items || []).forEach((item) => {
    const text = raw[item.id];
    if (typeof text !== 'string' || !translationPreservesSource(item.text, text)) {
      rejected.push(item.id);
      return;
    }
    accepted[item.id] = text;
  });
  return { accepted, rejected };
}

export function normalizeTranslationItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 40).map((item) => {
    if (!item || typeof item.id !== 'string' || typeof item.text !== 'string') return null;
    const id = item.id.trim().slice(0, 240);
    const text = item.text.slice(0, 4000);
    if (!id || !text.trim()) return null;
    return { id, text };
  }).filter(Boolean);
}

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

const SYSTEM_PROMPT = `You translate survey wording. Return JSON {"translations":{"<id>":"<translated text>"}} and nothing else.
Translate only the words participants read.
Preserve every number, every {placeholder}, and every HTML tag exactly.
Do not change option codes, question names, branching, or numeric scales.
Do not add keys that were not requested. Do not explain.`;

export async function handleSurveyTranslate(env, userId, body, deps = {}) {
  if (body?.apiKey) {
    throw Object.assign(new Error('Do not send apiKey in body. Store it via AI & Integrations.'), { status: 400 });
  }
  const items = normalizeTranslationItems(body?.items);
  if (!items.length) {
    throw Object.assign(new Error('Nothing to translate'), { status: 400, code: 'NOTHING_TO_TRANSLATE' });
  }
  const sourceLanguage = String(body?.sourceLanguage || 'en').slice(0, 32);
  const targetLanguage = String(body?.targetLanguage || '').slice(0, 32);
  if (!targetLanguage || targetLanguage === sourceLanguage) {
    throw Object.assign(new Error('Choose a target language that is different from the source language.'), {
      status: 400,
      code: 'TARGET_LANGUAGE_REQUIRED',
    });
  }

  const credentials = deps.loadUserAiSettings ? null : await import('./credentials.mjs');
  const loadSettings = deps.loadUserAiSettings || credentials.loadUserAiSettings;
  const listProfiles = deps.listProviderProfiles || credentials.listProviderProfiles;
  const resolveBinding = deps.resolveAssistantBinding || credentials.resolveAssistantBinding;
  const settings = await loadSettings(env, userId);
  const profiles = await listProfiles(env, userId);
  const provider = body?.provider || settings.assistant_provider || settings.default_provider || 'deepseek';
  const profile = profiles.find((row) => row.provider === provider) || {};
  const requestedModel = body?.model || settings.assistant_model || '';
  const binding = await resolveBinding(env, userId, provider, requestedModel, { receiverProfiles: profiles });
  const credential = binding?.credential;
  if (!credential?.apiKey) {
    throw Object.assign(new Error('The Assistant model is not configured. Add a model and key in AI & Integrations. No translation was requested.'), {
      status: 400,
      code: 'CREDENTIALS_MISSING',
    });
  }
  const { availableModelId, resolveModel } = await import('./runtime/registry.mjs');
  const { assertRoute } = await import('./runtime/validators.mjs');
  const chat = deps.chatCompletions || (await import('./runtime/providers.mjs')).chatCompletions;
  const model = body?.model || availableModelId(provider, settings.assistant_model, { profile });
  const checked = assertRoute({
    provider,
    model,
    profile,
    requireConfigured: true,
    credential,
  });
  const modelRecord = resolveModel(provider, model, profile);
  const result = await chat({
    apiKey: credential.apiKey,
    provider,
    baseUrl: checked.route.baseUrl,
    model,
    modelRecord,
    protocol: checked.route.protocol,
    compat: modelRecord?.compat,
    extra: checked.route.headers,
    meter: usageMeter(env, { userId, binding, feature: 'translate', projectId: body?.projectId || null }),
    temperature: 0.2,
    maxTokens: Math.min(Number(modelRecord?.maxTokens) || 4096, 4096),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          sourceLanguage,
          targetLanguage,
          items,
        }),
      },
    ],
  });
  const parsed = extractJson(result?.content) || {};
  const { accepted, rejected } = acceptModelTranslations(items, parsed);
  return {
    success: true,
    configured: true,
    provider,
    model,
    translations: accepted,
    rejected,
  };
}
