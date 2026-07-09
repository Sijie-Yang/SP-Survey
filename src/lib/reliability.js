/** Inter-rater reliability: Krippendorff's alpha and agreement rate. */

function filenameKey(val) {
  if (!val || typeof val !== 'string') return String(val ?? '');
  return val.split('?')[0].split('/').pop();
}

/**
 * Build a units × coders value matrix for one question.
 * Each unit = one shown image (by filename); each coder = one response row.
 */
export function buildIrrMatrix(responses, questionName, { interval = false } = {}) {
  const unitMap = new Map(); // unitKey -> { coderIndex: value }

  responses.forEach((row, coderIdx) => {
    const qData = row.responses?.[questionName];
    if (!qData) return;
    let ans = typeof qData === 'object' && 'answer' in qData ? qData.answer : qData;
    const shown = qData.shown_images?.length
      ? qData.shown_images
      : (row.displayed_images?.[questionName] || []);

    if (interval && typeof ans === 'number') {
      const unit = shown[0] ? filenameKey(shown[0]) : `row_${coderIdx}`;
      if (!unitMap.has(unit)) unitMap.set(unit, {});
      unitMap.get(unit)[coderIdx] = ans;
      return;
    }

    if (typeof ans === 'string' && shown.length) {
      const chosen = filenameKey(ans);
      shown.forEach((img) => {
        const unit = filenameKey(img);
        if (!unitMap.has(unit)) unitMap.set(unit, {});
        unitMap.get(unit)[coderIdx] = filenameKey(img) === chosen ? 1 : 0;
      });
      return;
    }

    if (typeof ans === 'number') {
      const unit = shown[0] ? filenameKey(shown[0]) : `row_${coderIdx}`;
      if (!unitMap.has(unit)) unitMap.set(unit, {});
      unitMap.get(unit)[coderIdx] = ans;
    }
  });

  const units = [...unitMap.keys()];
  const coderCount = responses.length;
  return { units, coderCount, unitMap };
}

function nominalDistance(a, b) {
  return a === b ? 0 : 1;
}

function intervalDistance(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return nominalDistance(a, b);
  return (na - nb) ** 2;
}

/**
 * Krippendorff's alpha (nominal or interval).
 * Returns null when insufficient overlapping ratings.
 */
export function krippendorffAlpha(responses, questionName, { level = 'interval' } = {}) {
  const { units, unitMap } = buildIrrMatrix(responses, questionName, { interval: level === 'interval' });
  if (units.length < 2) return null;

  const distFn = level === 'interval' ? intervalDistance : nominalDistance;
  let obsDisagreement = 0;
  let obsPairs = 0;
  const allValues = [];

  units.forEach((unit) => {
    const coders = Object.entries(unitMap.get(unit) || {});
    if (coders.length < 2) return;
    coders.forEach(([, v]) => allValues.push(v));
    for (let i = 0; i < coders.length; i += 1) {
      for (let j = i + 1; j < coders.length; j += 1) {
        obsDisagreement += distFn(coders[i][1], coders[j][1]);
        obsPairs += 1;
      }
    }
  });

  if (obsPairs === 0) return null;

  const valueFreq = {};
  allValues.forEach((v) => { valueFreq[v] = (valueFreq[v] || 0) + 1; });
  const totalVals = allValues.length;
  let expDisagreement = 0;
  let expPairs = 0;
  const vals = Object.keys(valueFreq);
  for (let i = 0; i < vals.length; i += 1) {
    for (let j = i; j < vals.length; j += 1) {
      const ni = valueFreq[vals[i]];
      const nj = valueFreq[vals[j]];
      const pairs = i === j ? ni * (ni - 1) / 2 : ni * nj;
      expDisagreement += pairs * distFn(vals[i], vals[j]);
      expPairs += pairs;
    }
  }
  if (expPairs === 0) return null;

  const Do = obsDisagreement / obsPairs;
  const De = expDisagreement / expPairs;
  if (De === 0) return Do === 0 ? 1 : null;
  return 1 - Do / De;
}

export function percentAgreement(responses, questionName) {
  const { units, unitMap } = buildIrrMatrix(responses, questionName);
  let agree = 0;
  let total = 0;
  units.forEach((unit) => {
    const vals = Object.values(unitMap.get(unit) || {});
    if (vals.length < 2) return;
    const first = vals[0];
    if (vals.every((v) => v === first)) agree += 1;
    total += 1;
  });
  return total === 0 ? null : agree / total;
}

export function irrLevelForQuestion(question) {
  if (['rating', 'imagerating', 'mediarating', 'slidergroup', 'imageslidergroup', 'skillquestion'].includes(question.type)) {
    return 'interval';
  }
  return 'nominal';
}

export function interpretAlpha(alpha) {
  if (alpha == null) return 'Insufficient overlapping ratings';
  if (alpha >= 0.8) return 'Excellent reliability (α ≥ 0.80)';
  if (alpha >= 0.667) return 'Acceptable for exploratory research (α ≥ 0.667)';
  if (alpha >= 0.4) return 'Moderate — interpret with caution';
  return 'Poor reliability — review data quality';
}

export function computeQuestionIrr(responses, question) {
  const level = irrLevelForQuestion(question);
  const alpha = krippendorffAlpha(responses, question.name, { level });
  const agreement = percentAgreement(responses, question.name);
  return { alpha, agreement, level, interpretation: interpretAlpha(alpha) };
}
