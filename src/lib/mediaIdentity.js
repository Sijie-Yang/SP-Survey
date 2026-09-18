/** Stable source identity. Filenames are labels, not globally unique IDs. */
export function mediaIdentityKey(value) {
  const source = typeof value === 'string' ? value : value?.url || value?.name || '';
  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source);
    url.hash = '';
    // Remove expiring access signatures, retain parameters that identify the resource.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(x-amz-|x-goog-|signature$|expires$|token$|awsaccesskeyid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  }
  return String(source).split('#')[0];
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
