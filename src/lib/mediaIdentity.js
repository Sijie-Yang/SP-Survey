// Analysis resolves the same few hundred media URLs once per trial, per method, per question.
const IDENTITY_CACHE_LIMIT = 20000;
const identityCache = new Map();

/** Stable source identity. Filenames are labels, not globally unique IDs. */
export function mediaIdentityKey(value) {
  const source = typeof value === 'string' ? value : value?.url || value?.name || '';
  if (/^https?:\/\//i.test(source)) {
    const cached = identityCache.get(source);
    if (cached !== undefined) return cached;
    const key = urlIdentityKey(source);
    if (identityCache.size >= IDENTITY_CACHE_LIMIT) identityCache.clear();
    identityCache.set(source, key);
    return key;
  }
  return String(source).split('#')[0];
}

function urlIdentityKey(source) {
  const url = new URL(source);
  url.hash = '';
  // Remove expiring access signatures, retain parameters that identify the resource.
  for (const key of [...url.searchParams.keys()]) {
    if (/^(x-amz-|x-goog-|signature$|expires$|token$|awsaccesskeyid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

export function mediaDisplayName(value) {
  return mediaIdentityKey(value).split('?')[0].split('/').pop() || '';
}

export function resolveMediaAnswerKey(value, shown = []) {
  const key = mediaIdentityKey(value);
  const index = key.match(/^(?:image|media)_(\d+)$/);
  if (index && shown[Number(index[1])]) return mediaIdentityKey(shown[Number(index[1])]);
  const exact = shown.find((item) => mediaIdentityKey(item) === key);
  if (exact) return mediaIdentityKey(exact);
  // Legacy filename-only answers can be recovered only when unambiguous.
  if (!key.includes('/')) {
    const matches = shown.filter((item) => mediaDisplayName(item) === key);
    if (matches.length === 1) return mediaIdentityKey(matches[0]);
    if (matches.length > 1) return '';
  }
  return key;
}

/** One answer describes this ordered stimulus group, not independent images. */
export function stimulusUnitKey(shown = []) {
  const keys = shown.map(mediaIdentityKey).filter(Boolean);
  return keys.length > 1 ? JSON.stringify(keys) : keys[0] || '(no_media)';
}

export function stimulusUnitLabel(key) {
  if (key?.startsWith('[')) {
    try { return JSON.parse(key).map(mediaDisplayName).join(' + '); } catch { /* legacy label */ }
  }
  return /^(https?:\/\/|\/)/.test(key || '') ? mediaDisplayName(key) : key;
}
