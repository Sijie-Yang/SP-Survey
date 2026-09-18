/* global globalThis */

/** One immutable request per practice attempt; retries must retain its identity and answers. */
export function createPracticeSubmission(data) {
  const token = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}_${Array.from(globalThis.crypto?.getRandomValues?.(new Uint32Array(4))
      || [Math.random(), Math.random(), Math.random(), Math.random()], (n) => n.toString(36)).join('_')}`;
  return JSON.parse(JSON.stringify({
    ...data,
    survey_metadata: {
      ...data.survey_metadata,
      completion_code: `practice_${token}`,
    },
  }));
}
