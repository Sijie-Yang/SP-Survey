/** Reserved answer value; never a media identity or a missing response. */
export const NO_PREFERENCE = '__sp_no_preference__';
export const isNoPreference = answer => answer === NO_PREFERENCE || !!answer && typeof answer === 'object' && !Array.isArray(answer) && answer.choice === 'tie';
export const noPreferenceLabel = (question, language = 'en') => {
  const custom = String(question?.tieLabel || '').trim();
  if (custom) return custom;
  const code = String(language || 'en').toLowerCase();
  return code === 'zh' || code.startsWith('zh-') ? '两者差不多' : 'About the same';
};
export function canChooseTie(question, count) {
  return question?.allowTie === true && !question?.multiSelect && count === 2;
}