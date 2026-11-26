/**
 * Participant-facing survey language (independent of admin UI region).
 * Stored on survey JSON as `locale`. Default is English.
 */

import { attachSurveyMarkdown } from './surveyMarkdown';
import { interfaceDictionary, normalizeUiLanguage, surveyJsLocale } from './uiLanguages';

export const SURVEY_UI_LANGUAGE_EN = 'en';
export const SURVEY_UI_LANGUAGE_ZH = 'zh';

export function resolveSurveyUiLanguage(source) {
  if (source && typeof source.getPropertyValue === 'function') {
    const chrome = source.getPropertyValue('spChromeLanguage');
    if (chrome) return normalizeUiLanguage(chrome);
  }
  const raw = typeof source === 'string'
    ? source
    : (source?.locale
      ?? (typeof source?.getPropertyValue === 'function' ? source.getPropertyValue('locale') : '')
      ?? '');
  return normalizeUiLanguage(raw);
}

export function resolveUrlSurveyLocale(search) {
  try {
    const raw = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    const locale = new URLSearchParams(raw || '').get('locale');
    return locale ? resolveSurveyUiLanguage(locale) : null;
  } catch {
    return null;
  }
}

export function resolveSurveyJsLocale(source) {
  return surveyJsLocale(resolveSurveyUiLanguage(source));
}

export function surveyUiStrings(source) {
  return interfaceDictionary(resolveSurveyUiLanguage(source));
}

/** Researcher completionMessage is free text; drop it when it does not match the UI locale. */
export function completionMessageForLocale(message, source) {
  const text = String(message || '').trim();
  if (!text) return '';
  const lang = resolveSurveyUiLanguage(source);
  const hasCjk = /[\u3400-\u9fff]/.test(text);
  if (lang === SURVEY_UI_LANGUAGE_ZH && !hasCjk) return '';
  if (lang === SURVEY_UI_LANGUAGE_EN && hasCjk && !/[A-Za-z]/.test(text)) return '';
  return text;
}

export function applySurveyLocale(model, source) {
  if (!model) return;
  const override = resolveUrlSurveyLocale();
  const locale = resolveSurveyJsLocale(override || source || model);
  try {
    model.locale = locale;
  } catch { /* ignore */ }
  attachSurveyMarkdown(model);
}
