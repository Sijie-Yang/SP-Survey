/**
 * Participant-facing survey language (independent of admin UI region).
 * Stored on survey JSON as `locale`. Default is English.
 */

import { adminI18n } from '../contexts/adminI18n';

export const SURVEY_UI_LANGUAGE_EN = 'en';
export const SURVEY_UI_LANGUAGE_ZH = 'zh';

export function resolveSurveyUiLanguage(source) {
  const raw = typeof source === 'string'
    ? source
    : (source?.locale
      ?? (typeof source?.getPropertyValue === 'function' ? source.getPropertyValue('locale') : '')
      ?? '');
  const n = String(raw || '').toLowerCase();
  if (n.startsWith('zh')) return SURVEY_UI_LANGUAGE_ZH;
  return SURVEY_UI_LANGUAGE_EN;
}

export function resolveSurveyJsLocale(source) {
  return resolveSurveyUiLanguage(source) === SURVEY_UI_LANGUAGE_ZH ? 'zh-cn' : 'en';
}

export function surveyUiStrings(source) {
  const lang = resolveSurveyUiLanguage(source);
  return adminI18n[lang] || adminI18n.en;
}

export function applySurveyLocale(model, source) {
  if (!model) return;
  const locale = resolveSurveyJsLocale(source || model);
  try {
    model.locale = locale;
  } catch { /* ignore */ }
}
