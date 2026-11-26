/**
 * Ask the project's Assistant to translate wording.
 * If the Assistant is not configured, this does not call the translate endpoint.
 */

import { getCredentialStatus } from './agentApi';
import { credentialConfigured } from '../hooks/surveyAssistantUtils';
import { acceptModelTranslations } from './surveyTranslations';

async function postTranslation(body) {
  const { translateSurveyText } = await import('./agentApi');
  return translateSurveyText(body);
}

export async function requestSurveyTranslations(payload, deps = {}) {
  const getStatus = deps.getCredentialStatus || getCredentialStatus;
  const status = await getStatus();
  if (!credentialConfigured(status)) {
    return {
      configured: false,
      translations: {},
      rejected: [],
      message: 'The Assistant model is not configured. No translation was requested.',
    };
  }
  const post = deps.post || postTranslation;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const accepted = {};
  const rejected = [];
  for (let index = 0; index < items.length; index += 40) {
    const chunk = items.slice(index, index + 40);
    const data = await post({ ...payload, items: chunk });
    if (data?.code === 'CREDENTIALS_MISSING' || data?.configured === false) {
      return {
        configured: false,
        translations: accepted,
        rejected,
        message: data.error || 'The Assistant model is not configured. No translation was requested.',
      };
    }
    if (!data?.success) {
      return {
        configured: true,
        translations: accepted,
        rejected,
        error: data?.error || 'Translation failed',
      };
    }
    const checked = acceptModelTranslations(chunk, { translations: data.translations });
    Object.assign(accepted, checked.accepted);
    rejected.push(...checked.rejected);
  }
  return { configured: true, translations: accepted, rejected };
}
