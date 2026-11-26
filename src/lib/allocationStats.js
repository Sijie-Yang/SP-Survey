function choiceList(question = {}) {
  const raw = question?.choices;
  if (typeof raw?.toArray === 'function') return raw.toArray();
  return Array.isArray(raw) ? raw : [];
}

export function allocationChoiceKeys(question = {}) {
  return choiceList(question).map((item, index) => {
    if (item == null) return `item_${index}`;
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    const value = item.value ?? item.text;
    return value == null || value === '' ? `item_${index}` : String(value);
  });
}

export function allocationBudget(question = {}) {
  const n = Number(question?.budget);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

/**
 * Highest value this choice may take without pushing the total over the budget.
 * At 0 remaining, headroom is 0 so the slider stops on its current points.
 * A value that is already over the budget can still be lowered.
 */
export function allocationChoiceMax(currentPoints, remaining) {
  const current = Number(currentPoints);
  const safeCurrent = Number.isFinite(current) && current > 0 ? current : 0;
  const room = Number(remaining);
  const headroom = Number.isFinite(room) && room > 0 ? room : 0;
  return safeCurrent + headroom;
}

export function clampAllocationPoints(raw, max) {
  const cap = Number(max);
  const limit = Number.isFinite(cap) ? Math.max(0, cap) : 0;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : parseInt(raw, 10);
  const value = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return Math.min(value, Math.round(limit));
}

/** The runtime permits partial spending. Full spending is a separate metric. */
export function allocationStatus(answer, question = {}) {
  const budget = question.budget ?? 100;
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return { valid: false, full: false };
  const entries = Object.entries(answer);
  const allowed = choiceList(question).map((c) => String(typeof c === 'object' ? (c.value ?? c.text) : c));
  const validValues = entries.length > 0 && entries.every(([key, v]) => (
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && (!allowed.length || allowed.includes(key))
  ));
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  const valid = validValues && Number.isFinite(budget) && budget > 0 && total <= budget + 1e-8;
  return { total, valid, full: valid && Math.abs(total - budget) < 1e-8 };
}

/**
 * Multi-choice allocation is ready to leave the trial when every option has a
 * number, or the budget is fully used (untouched options are then implicit zeros).
 * One slider is ready on its first valid value. A partial multi-choice total is
 * a valid answer for Next, but it is not finished.
 */
export function allocationReadyToAdvance(value, question = {}) {
  const status = allocationStatus(value, question);
  if (!status.valid) return false;
  const keys = allocationChoiceKeys(question);
  if (!keys.length) return false;
  if (keys.length === 1) return true;
  const explicit = keys.every((key) => {
    const v = value[key];
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
  });
  return explicit || status.full;
}
