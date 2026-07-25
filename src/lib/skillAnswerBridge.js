/**
 * Extract a skill answer from iframe → parent postMessage payloads.
 * Official protocol: { source: 'sp-survey-skill', type: 'answer', value }.
 * Also accepts common AI/ChatGPT mistaken shapes so answers are not silently dropped.
 */

const ALT_ANSWER_TYPES = new Set([
  'answer',
  'skill-result',
  'skillResult',
  'SP_SURVEY_SKILL_RESULT',
  'skill_answer',
  'skill-answer',
]);

/**
 * @param {unknown} data
 * @returns {{ value: unknown } | null}
 */
export function extractAnswerFromIframeMessage(data) {
  if (!data || typeof data !== 'object') return null;
  const d = data;

  // Official SDK
  if (d.source === 'sp-survey-skill' && d.type === 'answer') {
    return { value: d.value };
  }

  // Height / ready / other SDK traffic — ignore
  if (d.source === 'sp-survey-skill' && d.type !== 'answer') return null;

  // Host init must never be treated as an answer
  if (d.source === 'sp-survey-host') return null;

  const type = d.type != null ? String(d.type) : '';
  if (!ALT_ANSWER_TYPES.has(type)) return null;

  if ('value' in d && d.value !== undefined) return { value: d.value };
  if ('result' in d && d.result !== undefined) return { value: d.result };
  if ('answer' in d && d.answer !== undefined) return { value: d.answer };
  return null;
}

/** Normalize AI-generated schema arrays that are plain string keys. */
export function normalizeSkillSchemaArray(raw, { defaultType = 'string' } = {}) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string' && item.trim()) {
        return { key: item.trim(), label: item.trim(), type: defaultType };
      }
      if (item && typeof item === 'object' && item.key) {
        const { key, label, type, ...nativeSettings } = item;
        return {
          ...nativeSettings,
          key: String(key),
          label: label != null ? String(label) : String(key),
          type: type != null ? String(type) : defaultType,
        };
      }
      return null;
    })
    .filter(Boolean);
}
