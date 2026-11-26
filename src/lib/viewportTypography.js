export const FONT_FAMILIES = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  sans: 'Arial, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", SimSun, serif',
  times: '"Times New Roman", "Songti SC", SimSun, serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", "Microsoft YaHei", monospace',
};

// Missing values remain inherited; no typography defaults are written to a survey.
export const TYPOGRAPHY_FIELDS = {
  surveyTitleSize: { min: 12, max: 96, step: 1 },
  pageTitleSize: { min: 12, max: 72, step: 1 },
  questionTitleSize: { min: 10, max: 64, step: 1 },
  descriptionSize: { min: 10, max: 48, step: 1 },
  answerSize: { min: 12, max: 48, step: 1 },
  lineHeight: { min: 1, max: 3, step: 0.05 },
};
export const QUESTION_TYPOGRAPHY_FIELDS = ['questionTitleSize', 'descriptionSize', 'answerSize', 'lineHeight'];
const deviceKey = (viewport) => viewport === 'mobile' ? 'mobile' : 'desktop';

export function normalizeTypography(input = {}) {
  const result = {};
  if (Object.hasOwn(FONT_FAMILIES, input?.fontFamily)) result.fontFamily = input.fontFamily;
  Object.entries(TYPOGRAPHY_FIELDS).forEach(([field, { min, max, step }]) => {
    const raw = input?.[field];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
    result[field] = Number((Math.max(min, Math.min(max, Math.round(raw / step) * step))).toFixed(2));
  });
  return result;
}

export function typographySlot(config, viewport, questionName = null) {
  const slot = config?.viewportLayout?.[deviceKey(viewport)] || {};
  const global = normalizeTypography(slot.typography);
  const own = questionName ? normalizeTypography(slot.questions?.[questionName]?.typography) : global;
  const resolved = questionName ? { ...global, ...own } : global;
  return { own, inherited: questionName ? global : {}, resolved };
}

function replaceTypography(config, viewport, questionName, typography) {
  const key = deviceKey(viewport);
  const layout = config?.viewportLayout || {};
  const slot = { ...layout[key] };
  const target = questionName ? { ...slot.questions?.[questionName] } : slot;
  if (Object.keys(typography).length) target.typography = typography;
  else delete target.typography;
  if (questionName) {
    const questions = { ...slot.questions };
    if (Object.keys(target).length) questions[questionName] = target;
    else delete questions[questionName];
    if (Object.keys(questions).length) slot.questions = questions;
    else delete slot.questions;
  }
  const nextLayout = { ...layout };
  if (Object.keys(slot).length) nextLayout[key] = slot;
  else delete nextLayout[key];
  return { ...config, viewportLayout: nextLayout };
}

export function setTypographyField(config, viewport, questionName, field, value) {
  if (!(field === 'fontFamily' || TYPOGRAPHY_FIELDS[field]) || (questionName && field !== 'fontFamily' && !QUESTION_TYPOGRAPHY_FIELDS.includes(field))) return config;
  const own = typographySlot(config, viewport, questionName).own;
  const next = { ...own };
  if (value == null) delete next[field];
  else {
    const normalized = normalizeTypography({ [field]: value });
    if (normalized[field] == null) return config;
    next[field] = normalized[field];
  }
  if (JSON.stringify(own) === JSON.stringify(next)) return config;
  return replaceTypography(config, viewport, questionName, next);
}

export function resetTypography(config, viewport, questionName = null) {
  return replaceTypography(config, viewport, questionName, {});
}

// Copy only this scope's explicit overrides, leaving the destination layout intact.
export function copyTypography(config, viewport, questionName = null) {
  const target = deviceKey(viewport) === 'desktop' ? 'mobile' : 'desktop';
  return replaceTypography(config, target, questionName, { ...typographySlot(config, viewport, questionName).own });
}

const QUESTION_VARIABLES = {
  questionTitleSize: '--sjs-font-questiontitle-size',
  descriptionSize: '--sjs-font-questiondescription-size',
  answerSize: '--sjs-font-editorfont-size',
  lineHeight: '--sp-text-line-height',
};

export function applyQuestionTypography(root, typography) {
  ['--sjs-font-questiontitle-family', '--sjs-font-questiondescription-family', '--sjs-font-editorfont-family'].forEach((variable) => {
    if (FONT_FAMILIES[typography.fontFamily]) root.style.setProperty(variable, FONT_FAMILIES[typography.fontFamily]);
    else root.style.removeProperty(variable);
  });
  Object.entries(QUESTION_VARIABLES).forEach(([field, variable]) => {
    if (typography[field] != null) root.style.setProperty(variable, `${typography[field]}${field === 'lineHeight' ? '' : 'px'}`);
    else root.style.removeProperty(variable);
  });
  if (typography.descriptionSize != null) root.setAttribute('data-sp-text-description-size', '');
  else root.removeAttribute('data-sp-text-description-size');
  if (typography.lineHeight != null) root.setAttribute('data-sp-text-line-height', '');
  else root.removeAttribute('data-sp-text-line-height');
}

// These selectors target survey text only, never the studio controls or resize handles.
const questionText = [
  '.sd-question__title span', '.sd-question__description',
  '.sd-item__control-label', '.sd-input', '.sd-dropdown__value',
  '.sd-dropdown__filter-string-input', '.sd-rating__item-text',
  '.sd-boolean__label', '.sd-expression', '.sd-table__cell',
];
export function typographyStyles(config, viewport) {
  const t = typographySlot(config, viewport).resolved;
  const styles = {};
  const add = (selector, size, ratio) => {
    if (size == null && t.lineHeight == null && !t.fontFamily) return;
    styles[selector] = {
      ...(size != null ? { fontSize: `${size}px` } : {}),
      ...(size != null || t.lineHeight != null ? { lineHeight: t.lineHeight ?? ratio } : {}),
      ...(t.fontFamily ? { fontFamily: FONT_FAMILIES[t.fontFamily] } : {}),
    };
  };
  add('& .sd-header__text .sd-title', t.surveyTitleSize, 1.25);
  add('& .sd-page .sd-page__title', t.pageTitleSize, 1.33);
  add('& .sd-header__text .sd-description, & .sd-page .sd-page__description', t.descriptionSize, 1.5);
  // The participant mobile stylesheet otherwise shrinks descriptions to 0.9em.
  styles['& [data-sp-text-description-size] .sd-question__description'] = {
    fontSize: 'var(--sjs-font-questiondescription-size)',
    lineHeight: 'var(--sp-text-line-height, 1.5)',
  };
  styles[questionText.map((s) => `& [data-sp-text-line-height] ${s}`).join(', ')] = { lineHeight: 'var(--sp-text-line-height)' };
  return styles;
}
