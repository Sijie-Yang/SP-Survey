/**
 * Minimal i18n stub for self-hosted SP-Survey (Platform has full EN/ZH packs).
 * Components may call tf(t.key, vars) or region.t — fall back to English literals / keys.
 */
export const adminI18n = {
  en: new Proxy({}, {
    get: (_t, prop) => (typeof prop === 'string' ? prop : undefined),
  }),
  zh: new Proxy({}, {
    get: (_t, prop) => (typeof prop === 'string' ? prop : undefined),
  }),
};

/** Tiny template: tf('Hello {name}', { name: 'A' }) → 'Hello A' */
export function tf(template, vars = {}) {
  const s = template == null ? '' : String(template);
  return s.replace(/\{(\w+)\}/g, (_, k) => (
    vars[k] == null ? `{${k}}` : String(vars[k])
  ));
}

export default adminI18n;
