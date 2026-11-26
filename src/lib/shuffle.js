// Random order helpers. Kept free of survey-core and DOM so Node tests can load them.
// `list.sort(() => 0.5 - Math.random())` is NOT a fair shuffle (items near the front
// stay near the front more often than they should); use `shuffled` instead.

/** Fisher–Yates shuffle: every order equally likely. Returns a new array. */
export function shuffled(list, rand = Math.random) {
  const out = Array.isArray(list) ? list.slice() : [];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** 32-bit FNV-1a hash of any values joined as text. */
export function hashSeed(...parts) {
  const text = parts.map((p) => String(p ?? '')).join('␟');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, repeatable random numbers in [0, 1). */
export function seededRandom(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
