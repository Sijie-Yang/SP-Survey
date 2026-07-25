import {
  extractAnswerFromIframeMessage,
  normalizeSkillSchemaArray,
} from './skillAnswerBridge';

describe('extractAnswerFromIframeMessage', () => {
  test('accepts official SPSkill payload', () => {
    expect(extractAnswerFromIframeMessage({
      source: 'sp-survey-skill',
      type: 'answer',
      value: { score: 1 },
    })).toEqual({ value: { score: 1 } });
  });

  test('ignores height/ready from SDK', () => {
    expect(extractAnswerFromIframeMessage({
      source: 'sp-survey-skill',
      type: 'ready',
    })).toBeNull();
  });

  test('accepts ChatGPT-style skill-result posts', () => {
    const result = { mode: 'cue_detective', rankedCues: ['a', 'b', 'c'] };
    expect(extractAnswerFromIframeMessage({
      type: 'skill-result',
      result,
      value: result,
      valid: true,
    })).toEqual({ value: result });
  });

  test('accepts skillResult / SP_SURVEY_SKILL_RESULT aliases', () => {
    expect(extractAnswerFromIframeMessage({
      type: 'skillResult',
      result: { x: 1 },
    })).toEqual({ value: { x: 1 } });
    expect(extractAnswerFromIframeMessage({
      type: 'SP_SURVEY_SKILL_RESULT',
      value: { y: 2 },
    })).toEqual({ value: { y: 2 } });
  });

  test('ignores host init messages', () => {
    expect(extractAnswerFromIframeMessage({
      source: 'sp-survey-host',
      type: 'init',
      config: { mode: 'x' },
    })).toBeNull();
  });
});

describe('normalizeSkillSchemaArray', () => {
  test('coerces string keys to schema objects', () => {
    expect(normalizeSkillSchemaArray(['mode', 'prompt'])).toEqual([
      { key: 'mode', label: 'mode', type: 'string' },
      { key: 'prompt', label: 'prompt', type: 'string' },
    ]);
  });

  test('keeps object schemas', () => {
    expect(normalizeSkillSchemaArray([
      { key: 'score', label: 'Score', type: 'number' },
    ])).toEqual([
      { key: 'score', label: 'Score', type: 'number' },
    ]);
  });
});
