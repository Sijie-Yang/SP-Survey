/**
 * Interface languages. SP-Wiki article text is not translated here.
 * SurveyJS participant chrome (Next, Complete, validation) uses surveyJs.
 * Admin and public copy falls back to English. Traditional Chinese falls back
 * to the existing Simplified dictionary, then applies a Traditional overlay.
 */

import { adminI18n } from '../contexts/adminI18n';
import { localeChrome } from '../contexts/localeChrome';
import { localePublic } from '../contexts/localePublic';
import { localeAdmin, localePhrases, loadLocaleBundle } from '../contexts/localeBundles';

export { loadLocaleBundle };

export const UI_LANGUAGES = [
  { id: 'en', nativeName: 'English', short: 'EN', surveyJs: 'en', intl: 'en-US', priority: 0 },
  { id: 'zh', nativeName: '简体中文', short: '简', surveyJs: 'zh-cn', intl: 'zh-CN', priority: 0 },
  { id: 'zh-TW', nativeName: '繁體中文', short: '繁', surveyJs: 'zh-tw', intl: 'zh-TW', priority: 0 },
  { id: 'ja', nativeName: '日本語', short: '日', surveyJs: 'ja', intl: 'ja-JP', priority: 0 },
  { id: 'ko', nativeName: '한국어', short: '한', surveyJs: 'ko', intl: 'ko-KR', priority: 0 },
  { id: 'fi', nativeName: 'Suomi', short: 'FI', surveyJs: 'fi', intl: 'fi-FI', priority: 0 },
  { id: 'es', nativeName: 'Español', short: 'ES', surveyJs: 'es', intl: 'es-ES', priority: 1 },
  { id: 'fr', nativeName: 'Français', short: 'FR', surveyJs: 'fr', intl: 'fr-FR', priority: 1 },
  { id: 'de', nativeName: 'Deutsch', short: 'DE', surveyJs: 'de', intl: 'de-DE', priority: 1 },
  { id: 'pt', nativeName: 'Português', short: 'PT', surveyJs: 'pt', intl: 'pt-PT', priority: 1 },
];

export function isChineseLanguage(language) {
  const code = String(language || '').toLowerCase();
  return code === 'zh' || code.startsWith('zh-');
}

export function normalizeUiLanguage(raw) {
  const lower = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
  if (!lower) return 'en';
  if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-hant') return 'zh-TW';
  if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh-hans') return 'zh';
  const found = UI_LANGUAGES.find((item) => item.id.toLowerCase() === lower || item.surveyJs === lower);
  return found ? found.id : 'en';
}

export function uiLanguageById(id) {
  const code = normalizeUiLanguage(id);
  return UI_LANGUAGES.find((item) => item.id === code) || UI_LANGUAGES[0];
}

export function surveyJsLocale(id) {
  return uiLanguageById(id).surveyJs;
}

export function intlLocale(id) {
  return uiLanguageById(id).intl;
}

// Merging the dictionaries copies thousands of keys, so build each one once
// (per language, and again only after its lazy bundle arrives).
const dictionaryCache = new Map();

export function interfaceDictionary(language) {
  const code = normalizeUiLanguage(language);
  const bundle = localeAdmin[code];
  const cached = dictionaryCache.get(code);
  if (cached && cached.bundle === bundle) return cached.dict;
  if (bundle === undefined && code !== 'en' && code !== 'zh') {
    loadLocaleBundle(code).catch(() => {});
  }
  const overlay = { ...(bundle || {}), ...(localeChrome[code] || {}), ...(localePublic[code] || {}) };
  let dict;
  if (code === 'zh') dict = { ...adminI18n.en, ...adminI18n.zh, ...overlay };
  else if (code === 'zh-TW') dict = { ...adminI18n.en, ...adminI18n.zh, ...overlay };
  else dict = { ...adminI18n.en, ...overlay };
  dictionaryCache.set(code, { bundle, dict });
  return dict;
}

/** Inline Chinese/English label. Other languages use the phrase bundle. */
export function uiPair(language, en, zh) {
  return lookupPhrase(language, en) ?? (isChineseLanguage(language) ? zh : en);
}

/** English-keyed interface phrases (editor, media library, inline labels). */
export function lookupPhrase(language, text) {
  if (typeof text !== 'string' || !text) return undefined;
  const code = normalizeUiLanguage(language);
  if (code === 'en' || code === 'zh') return undefined;
  const table = localePhrases[code];
  if (!table) {
    loadLocaleBundle(code).catch(() => {});
    return undefined;
  }
  if (Object.hasOwn(table, text)) return table[text];
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed !== text && Object.hasOwn(table, trimmed)) return table[trimmed];
  return undefined;
}
