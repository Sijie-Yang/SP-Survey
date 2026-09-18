/** The runtime permits partial spending. Full spending is a separate metric. */
export function allocationStatus(answer, question = {}) {
  const budget = question.budget ?? 100;
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return { valid: false, full: false };
  const entries = Object.entries(answer);
  const allowed = (question.choices || []).map((c) => String(typeof c === 'object' ? c.value : c));
  const validValues = entries.length > 0 && entries.every(([key, v]) => (
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && (!allowed.length || allowed.includes(key))
  ));
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  const valid = validValues && Number.isFinite(budget) && budget > 0 && total <= budget + 1e-8;
  return { total, valid, full: valid && Math.abs(total - budget) < 1e-8 };
}
