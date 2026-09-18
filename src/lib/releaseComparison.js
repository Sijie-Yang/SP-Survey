const stable = (value) => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const questions = (config) => (config?.pages || []).flatMap((p) => p.elements || []);
const id = (m) => typeof m === 'string' ? m : m.media_id || m.key || m.url;
export function compareRelease(before, after, previousMedia = [], nextMedia = []) {
  const old = new Map(questions(before).map((q) => [q.name, q]));
  const next = new Map(questions(after).map((q) => [q.name, q]));
  const added = [...next.keys()].filter((k) => !old.has(k));
  const removed = [...old.keys()].filter((k) => !next.has(k));
  const changed = [...next.keys()].filter((k) => old.has(k) && stable(old.get(k)) !== stable(next.get(k)));
  const oldMedia = new Map(previousMedia.map((m) => [id(m), m]));
  const newMedia = new Map(nextMedia.map((m) => [id(m), m]));
  return { added, removed, changed,
    changedDetails: changed.map((name) => ({ name, title: typeof next.get(name).title === 'string' ? next.get(name).title : name,
      fields: [...new Set([...Object.keys(old.get(name)), ...Object.keys(next.get(name))])]
        .filter((field) => stable(old.get(name)[field]) !== stable(next.get(name)[field])) })),
    configChanged: stable(before) !== stable(after),
    mediaAdded: [...newMedia.keys()].filter((k) => !oldMedia.has(k)).length,
    mediaRemoved: [...oldMedia.keys()].filter((k) => !newMedia.has(k)).length,
    mediaChanged: [...newMedia.keys()].filter((k) => oldMedia.has(k) && stable(oldMedia.get(k)) !== stable(newMedia.get(k))).length,
  };
}

export function publicMediaConfig(config = {}) {
  const secrets = new Set(['huggingFaceToken', 'falApiKey', 'falKey', 'supabaseKey', 'supabaseAnonKey', 'openaiApiKey', 'apiKey']);
  return Object.fromEntries(Object.entries(config || {}).filter(([key]) => !secrets.has(key)));
}

export const sameReleaseValue = (a, b) => stable(a) === stable(b);
