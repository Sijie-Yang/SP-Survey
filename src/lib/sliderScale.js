const GENERIC_DIMENSION_ID = /^(dim(?:ension)?_?\d+|d\d+|scale_?\d+)$/i;
const SLIDER_TYPES = new Set(['slidergroup', 'imageslidergroup', 'mediaslidergroup']);

function text(value) {
  return value == null ? '' : String(value).trim();
}

export function dimensionPoles(dimension = {}) {
  return {
    left: text(
      dimension.left
      ?? dimension.low
      ?? dimension.leftLabel
      ?? dimension.left_label
      ?? dimension.minLabel
      ?? dimension.min_label,
    ),
    right: text(
      dimension.right
      ?? dimension.high
      ?? dimension.rightLabel
      ?? dimension.right_label
      ?? dimension.maxLabel
      ?? dimension.max_label,
    ),
  };
}

function explicitDisplayName(dimension = {}) {
  return text(dimension.label || dimension.text || dimension.name || dimension.title);
}

function idAsDisplayName(dimension = {}) {
  const id = text(dimension.id);
  return id && !GENERIC_DIMENSION_ID.test(id) ? id : '';
}

export function dimensionDisplayName(dimension = {}, index = 0, { locale } = {}) {
  const label = explicitDisplayName(dimension) || idAsDisplayName(dimension);
  if (label) return label;
  const { left, right } = dimensionPoles(dimension);
  if (left && right) return `${left} ↔ ${right}`;
  if (left || right) return left || right;
  return locale === 'zh' ? `维度 ${index + 1}` : `Dimension ${index + 1}`;
}

export function dimensionIncompleteFields(dimension = {}) {
  const missing = [];
  if (!explicitDisplayName(dimension) && !idAsDisplayName(dimension)) missing.push('display name (label)');
  const { left, right } = dimensionPoles(dimension);
  if (!left) missing.push('left pole');
  if (!right) missing.push('right pole');
  return missing;
}

export function dimensionIncomplete(dimension = {}) {
  return dimensionIncompleteFields(dimension).length > 0;
}

export function describeDimensionIncomplete(dimension = {}, index = 0) {
  const missing = dimensionIncompleteFields(dimension);
  if (!missing.length) return null;
  const id = text(dimension.id);
  return `Dimension ${index + 1}${id ? ` "${id}"` : ''} is incomplete (missing ${missing.join(', ')}). Expected {id, label, left, right}. Historical answer ids are unchanged.`;
}

export function normalizeSliderDimension(dimension, index = 0) {
  if (dimension == null || typeof dimension !== 'object' || Array.isArray(dimension)) {
    return { id: `dim_${index + 1}` };
  }
  const next = { ...dimension };
  const mappedLabel = explicitDisplayName(next) || idAsDisplayName(next);
  if (mappedLabel && !text(next.label)) next.label = mappedLabel;
  const { left, right } = dimensionPoles(next);
  if (left && !text(next.left)) next.left = left;
  if (right && !text(next.right)) next.right = right;
  if (!text(next.id)) {
    const fromValue = text(next.value);
    next.id = fromValue || mappedLabel.replace(/\s+/g, '_').slice(0, 40) || `dim_${index + 1}`;
  }
  return next;
}

export function normalizeSliderQuestion(question) {
  if (!question || !SLIDER_TYPES.has(question.type) || !Array.isArray(question.dimensions)) {
    return question;
  }
  return {
    ...question,
    dimensions: question.dimensions.map((item, index) => normalizeSliderDimension(item, index)),
  };
}

export function persistSliderAliases(surveyConfig) {
  if (!surveyConfig || !Array.isArray(surveyConfig.pages)) return surveyConfig;
  return {
    ...surveyConfig,
    pages: surveyConfig.pages.map((page) => ({
      ...page,
      elements: (page.elements || []).map((element) => normalizeSliderQuestion(element)),
    })),
  };
}

export function matrixItemLabel(item, index = 0, kind = 'Row') {
  if (item == null) return `${kind} ${index + 1}`;
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  return text(item.text || item.label || item.value) || `${kind} ${index + 1}`;
}

/** Effective bounds shared by rendering and answer validation. */
export function sliderScale(dimension = {}, question = {}) {
  const min = dimension.min ?? question.scaleMin ?? 1;
  const max = dimension.max ?? question.scaleMax ?? 7;
  const step = dimension.step ?? question.scaleStep ?? 1;
  const valid = Number.isFinite(min) && Number.isFinite(max) && max > min && Number.isFinite(step) && step > 0;
  const midpoint = valid ? Number(Math.min(max, min + Math.round((max - min) / (2 * step)) * step).toPrecision(12)) : 0;
  return { min, max, step, midpoint, valid };
}

export function sliderGroupAnswerValid(value, question, requireAll = false) {
  if (value == null) return !requireAll;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  return (question.dimensions || []).every((d) => {
    const v = value[d.id];
    if (v == null || v === '') return !requireAll;
    const { min, max, step, valid } = sliderScale(d, question);
    const ticks = (v - min) / step;
    return valid && typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
      && (v === max || Math.abs(ticks - Math.round(ticks)) < 1e-7);
  });
}
