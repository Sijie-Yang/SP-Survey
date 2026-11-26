// Balanced draws: the "Balanced" sampling mode of a question.
//
// Every participant gets a number (0, 1, 2, … handed out by the server). The
// question's library is laid out as one long repeatable queue: the whole library
// in a seeded random order, then the whole library again in another order, and
// so on. Participant k takes the k-th stretch of that queue. So after any run of
// participants every image has been shown the same number of times (give or take
// one), and nobody sees an image twice.
//
// Nothing here talks to the network or uses a model; the same number and the
// same library always give the same images.
import { hashSeed, seededRandom, shuffled } from './shuffle.js';

/** Largest number a browser picks by itself when the server cannot hand one out. */
export const LOCAL_NUMBER_RANGE = 4096;

/**
 * Positions (0..n-1) that participant `number` takes from a library of `n`
 * units when each participant takes `perPerson` of them.
 */
export function balancedSlice(n, perPerson, number, seed) {
  const size = Math.max(0, Math.floor(n) || 0);
  if (!size) return [];
  const m = Math.max(1, Math.min(Math.floor(perPerson) || 1, size));
  const k = Math.max(0, Math.floor(number) || 0);
  const first = k * m;
  const lastPass = Math.floor((first + m - 1) / size);
  const firstPass = Math.floor(first / size);
  let prev = null;
  const kept = new Map();
  for (let q = 0; q <= lastPass; q += 1) {
    const order = shuffled(Array.from({ length: size }, (_, i) => i), seededRandom(hashSeed(seed, 'pass', q)));
    if (q > 0) {
      // The stretch that starts in the previous pass and ends in this one must not
      // repeat a unit: move any repeat out of this pass's opening positions.
      const passStart = q * size;
      const stretchStart = Math.floor(passStart / m) * m;
      if (stretchStart < passStart) {
        const head = Math.min(stretchStart + m - passStart, size);
        const tail = new Set(prev.slice(stretchStart - (q - 1) * size));
        for (let i = 0; i < head; i += 1) {
          if (!tail.has(order[i])) continue;
          for (let j = head; j < size; j += 1) {
            if (!tail.has(order[j])) {
              const tmp = order[i];
              order[i] = order[j];
              order[j] = tmp;
              break;
            }
          }
        }
      }
    }
    if (q >= firstPass) kept.set(q, order);
    prev = order;
  }
  const out = [];
  for (let s = first; s < first + m; s += 1) out.push(kept.get(Math.floor(s / size))[s % size]);
  return out;
}

/**
 * One participant's balanced draws for a whole survey.
 *
 * `groups` is a list of `{ id, keys, perPerson, questions }`: the units (image
 * or set keys) a group of questions shares, how many of them one participant
 * needs in total, and which questions draw from it. Questions in one group
 * never get the same unit twice.
 */
export function createBalancePlan(groups, { number, seed = '' } = {}) {
  const k = Math.max(0, Math.floor(Number(number)) || 0);
  const byQuestion = new Map();
  (groups || []).forEach((group) => {
    const keys = [...new Set((group.keys || []).filter(Boolean))].sort();
    if (!keys.length) return;
    const groupSeed = hashSeed(seed, group.id);
    const slice = balancedSlice(keys.length, group.perPerson, k, groupSeed).map((i) => keys[i]);
    // The order inside one participant's stretch is their own, so pairs and trial order differ between people.
    const queue = { keys: shuffled(slice, seededRandom(hashSeed(groupSeed, 'order', k))), at: 0 };
    (group.questions || []).forEach((name) => byQuestion.set(name, queue));
  });
  return {
    number: k,
    questions: [...byQuestion.keys()],
    /** The next `count` units for this question, or null when it has no balanced queue (or it ran out). */
    take(questionName, count) {
      const queue = byQuestion.get(questionName);
      const want = Math.max(1, Math.floor(count) || 1);
      if (!queue || queue.at + want > queue.keys.length) return null;
      const out = queue.keys.slice(queue.at, queue.at + want);
      queue.at += want;
      return out;
    },
  };
}

/** A number picked in the browser: used for previews, researcher practice runs and when the server call fails. */
export function localBalanceNumber(rand = Math.random) {
  return Math.floor(rand() * LOCAL_NUMBER_RANGE);
}

// The participant's number survives a reload (same images again) for as long as the server holds it.
export const BALANCE_HOLD_MINUTES = 30;
const storeKey = (projectId) => `sp_balance_number_${projectId || 'default'}`;

export function rememberBalanceNumber(projectId, assignment, now = Date.now()) {
  if (!assignment || assignment.claim !== 'server') return;
  try {
    localStorage.setItem(storeKey(projectId), JSON.stringify({ ...assignment, at: now }));
  } catch { /* private mode */ }
}

export function recallBalanceNumber(projectId, now = Date.now()) {
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey(projectId)) || 'null');
    if (!saved || !Number.isInteger(saved.n) || saved.n < 0) return null;
    if (now - Number(saved.at || 0) > BALANCE_HOLD_MINUTES * 60 * 1000) return null;
    return { n: saved.n, claim: 'server', claim_id: saved.claim_id || null };
  } catch {
    return null;
  }
}

export function forgetBalanceNumber(projectId) {
  try { localStorage.removeItem(storeKey(projectId)); } catch { /* private mode */ }
}

/** What a response records about its balanced draw. */
export function balanceResponseMetadata(assignment) {
  if (!assignment || !Number.isInteger(assignment.n)) return {};
  return { balanced_draw: { n: assignment.n, claim: assignment.claim || 'local', claim_id: assignment.claim_id || null } };
}
