/**
 * The pure core of SP-Site: what an SP-Scheme upload needs to be read,
 * checked and imported (answer families, host lists, the preview shim, the
 * static page checks). No DOM, no network and no other platform modules, so
 * the browser, Studio and the Worker (MCP) import a page with the same code.
 * spSite.js re-exports the public names, so app code keeps importing spSite.
 */

export const SP_SITE_VERSION = '1.0';
export const SP_SITE_MAX_BYTES = 3 * 1024 * 1024;

const DISPLAY_TYPES = new Set(['html', 'expression', 'image', 'mediadisplay']);
const STRUCTURAL_TYPES = new Set(['panel', 'paneldynamic']);
const RATING_TYPES = new Set(['rating', 'imagerating', 'mediarating']);
const BOOLEAN_TYPES = new Set(['boolean', 'imageboolean', 'mediaboolean', 'consent']);
const SINGLE_CHOICE_TYPES = new Set(['radiogroup', 'dropdown', 'imagepicker', 'mediapicker']);
const MULTI_CHOICE_TYPES = new Set(['checkbox', 'imagecheckbox', 'mediacheckbox', 'tagbox']);
const RANKING_TYPES = new Set(['ranking', 'imageranking', 'mediaranking']);
const SLIDER_TYPES = new Set(['slidergroup', 'imageslidergroup', 'mediaslidergroup']);
const MATRIX_TYPES = new Set(['matrix', 'imagematrix', 'mediamatrix']);
const ALLOCATION_TYPES = new Set(['pointallocation', 'imagepointallocation', 'mediapointallocation']);

/** Answer family the site must record for a question type. */
export function answerKindOf(element = {}) {
  const type = element.type;
  if (DISPLAY_TYPES.has(type)) return 'display';
  if (type === 'number' || (type === 'text' && element.inputType === 'number')) return 'number';
  if (type === 'text' || type === 'comment') return 'text';
  if (RATING_TYPES.has(type)) return 'rating';
  if (BOOLEAN_TYPES.has(type)) return 'boolean';
  if (SINGLE_CHOICE_TYPES.has(type)) return element.multiSelect ? 'multiChoice' : 'choice';
  if (MULTI_CHOICE_TYPES.has(type)) return 'multiChoice';
  if (RANKING_TYPES.has(type)) return 'ranking';
  if (SLIDER_TYPES.has(type)) return 'sliders';
  if (MATRIX_TYPES.has(type)) return 'matrix';
  if (ALLOCATION_TYPES.has(type)) return 'allocation';
  if (type === 'imageannotation') return 'annotation';
  if (type === 'custom') return 'custom';
  return 'unsupported';
}

export const ANSWER_SHAPES = {
  text: 'a string',
  number: 'a number within min/max',
  rating: 'a number from rateMin to rateMax (or one of rateValues)',
  boolean: 'true or false',
  choice: 'one choices[].value (string)',
  multiChoice: 'an array of choices[].value',
  ranking: 'an array of every choices[].value, best first',
  sliders: 'an object { <dimension id>: number }',
  matrix: 'an object { <row value>: <column value> } for every row',
  allocation: 'an object { <choice value>: points } summing to budget',
  annotation: 'an object { shapes: [{ tool, label, points: [{ x, y }] }] } with x/y normalised 0–1',
  custom: 'any JSON (≤ 32 KB); the platform stores it as is and does not analyse it',
};

/** Every element of the pages, with panels opened up (shared with spSite.js). */
export function flatElements(pages) {
  const out = [];
  const walk = (elements, pageName) => (elements || []).forEach((element) => {
    if (!element || typeof element !== 'object') return;
    if (STRUCTURAL_TYPES.has(element.type)) {
      walk(element.elements || element.templateElements, pageName);
      return;
    }
    out.push({ element, pageName });
  });
  (pages || []).forEach((page) => walk(page?.elements, page?.name));
  return out;
}

/** UTF-8 byte length (TextEncoder is not available everywhere this runs). */
export function utf8Bytes(text) {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1; } else n += 3;
  }
  return n;
}

/**
 * How far an SP-Scheme site matches the platform: every question a native
 * type (full), some recorded as is (partial), or nothing declared (none: the
 * page's requests are kept raw).
 */
export function siteMatchLevel(config = {}) {
  const elements = flatElements(config.pages).map(({ element }) => element).filter((el) => el.name && !DISPLAY_TYPES.has(el.type) && !(el.type === 'html' && /_placeholder$/.test(el.name)));
  const custom = elements.filter((el) => el.type === 'custom').length;
  const native = elements.length - custom;
  const level = !elements.length ? 'none' : (custom ? (native ? 'partial' : 'custom') : 'full');
  return { level, native, custom, total: elements.length };
}

const CDN_HOSTS = [
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://unpkg.com',
  'https://cdn.tailwindcss.com',
  'https://esm.sh',
];

export const SP_SITE_SCRIPT_HOSTS = CDN_HOSTS;

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i;

/** Hostnames a researcher may allow (no schemes, paths or wildcards). */
export function normalizeAllowedHosts(hosts) {
  return [...new Set((Array.isArray(hosts) ? hosts : [])
    .map((h) => String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter((h) => HOST_RE.test(h)))].slice(0, 20);
}

export const SITE_SHIM_START = '<!-- sp-site-preview:start -->';
export const SITE_SHIM_END = '<!-- sp-site-preview:end -->';

/** Remove the preview-only shim; the platform SDK replaces it. */
export function stripSitePreviewShim(html) {
  let text = String(html || '');
  for (;;) {
    const start = text.indexOf(SITE_SHIM_START);
    if (start < 0) return text;
    const end = text.indexOf(SITE_SHIM_END, start);
    if (end < 0) return text;
    text = text.slice(0, start) + text.slice(end + SITE_SHIM_END.length);
  }
}

/** The survey JSON a site embeds for its own preview, if any. */
export function extractEmbeddedScheme(html) {
  const match = String(html || '').match(/<script\b[^>]*id=["']sp-scheme["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return { __invalid: true };
  }
}

/**
 * Static checks on an uploaded site.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkSiteHtml(html, questionNames = [], { allowedHosts = [], raw = false } = {}) {
  const hosts = normalizeAllowedHosts(allowedHosts);
  const errors = [];
  const warnings = [];
  const text = stripSitePreviewShim(html);
  const bytes = utf8Bytes(text);
  if (!/<(html|body|div|main|script)\b/i.test(text)) errors.push('index.html does not look like an HTML page.');
  if (bytes > SP_SITE_MAX_BYTES) errors.push(`index.html is ${(bytes / 1048576).toFixed(1)} MB; keep it under 3 MB (media belongs in the Media Dataset).`);
  const scriptSrc = [...text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);
  const scriptHosts = [...CDN_HOSTS, ...hosts.map((h) => `https://${h}`)];
  const blocked = scriptSrc.filter((src) => !scriptHosts.some((host) => src.startsWith(`${host}/`) || src === host));
  if (raw) {
    // No questions declared: the platform keeps the page's own requests as they
    // are and the participant submits from the platform's bar.
    if (/SPSite\.answer\s*\(/.test(text)) warnings.push('index.html calls SPSite.answer but declares no questions, so those answers are not recorded; declare the questions in sp-scheme.');
    if (blocked.length) warnings.push(`Scripts from domains that are not ticked will be blocked, which may break the page: ${blocked.slice(0, 3).join(', ')}.`);
    warnings.push('No questions are declared: the platform records the requests this page sends as they are and does not analyse them.');
    return { errors, warnings };
  }
  if (!/SPSite\.answer\s*\(/.test(text)) errors.push('index.html never calls SPSite.answer(...), so no answers would be recorded.');
  if (!/SPSite\.complete\s*\(/.test(text)) errors.push('index.html never calls SPSite.complete(), so participants could not submit.');
  if (/SPSkill\./.test(text)) errors.push('index.html uses the old SPSkill API; use SPSite instead.');
  if (/\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)/.test(text)) {
    const handled = /SPSite\.on(Request|Submit)\s*\(/.test(text);
    if (!handled) {
      warnings.push(hosts.length
        ? `index.html makes network calls; only ${hosts.join(', ')} can be reached, and data sent elsewhere is handed to SPSite.onSubmit instead.`
        : 'index.html makes network calls; they are blocked on the platform. Answers must go through SPSite.answer.');
    }
  }
  if (blocked.length) {
    errors.push(`Scripts must be inline or come from ${CDN_HOSTS.join(', ')} or an allowed domain: ${blocked.slice(0, 3).join(', ')}.`);
  }
  if (!/getQuestions\s*\(|getQuestion\s*\(|getMedia\s*\(|getData\s*\(|spsite-ready|onReady\s*\(/.test(text)) {
    errors.push('index.html never reads the questions or media from SPSite (SPSite.onReady / getQuestions / getMedia / getData), so it cannot show the media the platform holds.');
  }
  const unseen = questionNames.filter((name) => !text.includes(name));
  if (unseen.length && !/getQuestions\s*\(/.test(text)) {
    warnings.push(`index.html never mentions ${unseen.slice(0, 5).join(', ')}; check that these questions are shown.`);
  }
  return { errors, warnings };
}

/** External hosts a page loads from or talks to, excluding the built-in CDNs and data: URLs. */
export function externalHostsIn(html) {
  const builtIn = new Set(CDN_HOSTS.map((h) => new URL(h).host).concat(['fonts.googleapis.com', 'fonts.gstatic.com']));
  const found = new Map();
  const add = (url, kind) => {
    try {
      const { host, protocol } = new URL(url);
      if (!/^https?:$/.test(protocol) || builtIn.has(host)) return;
      const entry = found.get(host) || { host, kinds: new Set() };
      entry.kinds.add(kind);
      found.set(host, entry);
    } catch { /* relative or invalid */ }
  };
  const text = String(html || '');
  for (const m of text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) add(m[1], 'script');
  for (const m of text.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi)) add(m[1], 'style');
  for (const m of text.matchAll(/\b(?:fetch|open|sendBeacon|axios\.\w+|\$\.(?:ajax|get|post|getJSON))\s*\(\s*(?:['"]\w+['"]\s*,\s*)?['"`](https?:\/\/[^'"`\s]+)/g)) add(m[1], 'request');
  for (const m of text.matchAll(/['"`](https?:\/\/[^'"`\s]+\/(?:tiles?|api|v\d+)\/[^'"`\s]*)['"`]/gi)) add(m[1], 'request');
  return [...found.values()].map((e) => ({ host: e.host, kinds: [...e.kinds] }));
}
