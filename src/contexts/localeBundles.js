/**
 * Machine-translated admin strings and phrases for the extra UI languages.
 * Together they are ~1.5 MB of JSON, so each language is loaded on demand
 * instead of shipping all of them in the main bundle. Until a language has
 * loaded, lookups fall back to English (or Simplified Chinese for zh-TW).
 */

const LOADERS = {
  ja: () => Promise.all([import('./i18nGap/out/ja-admin.json'), import('./i18nGap/out/ja-phrases.json')]),
  ko: () => Promise.all([import('./i18nGap/out/ko-admin.json'), import('./i18nGap/out/ko-phrases.json')]),
  fi: () => Promise.all([import('./i18nGap/out/fi-admin.json'), import('./i18nGap/out/fi-phrases.json')]),
  es: () => Promise.all([import('./i18nGap/out/es-admin.json'), import('./i18nGap/out/es-phrases.json')]),
  fr: () => Promise.all([import('./i18nGap/out/fr-admin.json'), import('./i18nGap/out/fr-phrases.json')]),
  de: () => Promise.all([import('./i18nGap/out/de-admin.json'), import('./i18nGap/out/de-phrases.json')]),
  pt: () => Promise.all([import('./i18nGap/out/pt-admin.json'), import('./i18nGap/out/pt-phrases.json')]),
  'zh-TW': () => Promise.all([import('./i18nGap/out/zh-TW-admin.json'), import('./i18nGap/out/zh-TW-phrases.json')]),
};

export const localeAdmin = {};
export const localePhrases = {};

const pending = {};
const listeners = new Set();

export function hasLocaleBundle(code) {
  return !LOADERS[code] || Object.hasOwn(localeAdmin, code);
}

/** Resolves once `code`'s strings are available (no-op for en/zh). */
export function loadLocaleBundle(code) {
  if (hasLocaleBundle(code)) return Promise.resolve();
  if (!pending[code]) {
    pending[code] = LOADERS[code]().then(([admin, phrases]) => {
      localeAdmin[code] = admin.default || admin;
      localePhrases[code] = phrases.default || phrases;
      listeners.forEach((fn) => fn(code));
    }).catch((err) => {
      delete pending[code];
      throw err;
    });
  }
  return pending[code];
}

/** Called with the language code whenever a bundle finishes loading. */
export function onLocaleBundleLoaded(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
