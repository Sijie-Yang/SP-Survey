import {
  isKnownSkillResultType,
  validateSkillResultValue,
  checkAnswerAgainstResultSchema,
  KNOWN_SKILL_RESULT_TYPE_IDS,
} from './skillResultTypes';

describe('isKnownSkillResultType', () => {
  it('knows catalog + string alias', () => {
    expect(isKnownSkillResultType('points')).toBe(true);
    expect(isKnownSkillResultType('rankedList')).toBe(true);
    expect(isKnownSkillResultType('string')).toBe(true);
    expect(isKnownSkillResultType('foobar')).toBe(false);
  });
});

describe('validateSkillResultValue', () => {
  it('validates points', () => {
    expect(validateSkillResultValue('points', [{ x: 0.1, y: 0.2, label: 'door' }]).ok).toBe(true);
    expect(validateSkillResultValue('points', []).ok).toBe(false);
    expect(validateSkillResultValue('points', [{ x: 'a' }]).ok).toBe(false);
  });

  it('validates path', () => {
    expect(validateSkillResultValue('path', [{ x: 0, y: 0 }, { x: 1, y: 1 }]).ok).toBe(true);
    expect(validateSkillResultValue('path', [{ x: 0, y: 0 }]).ok).toBe(false);
  });

  it('validates polygon and bbox (box alias)', () => {
    expect(validateSkillResultValue('polygon', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]).ok).toBe(true);
    expect(validateSkillResultValue('polygon', [{ x: 0, y: 0 }, { x: 1, y: 0 }]).ok).toBe(false);
    expect(validateSkillResultValue('bbox', [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }]).ok).toBe(true);
    expect(validateSkillResultValue('box', [{ x: 0, y: 0 }, { x: 1, y: 1 }]).ok).toBe(true);
  });

  it('validates allocation and scaleGroup', () => {
    expect(validateSkillResultValue('allocation', { trees: 40, seats: 60 }).ok).toBe(true);
    expect(validateSkillResultValue('scaleGroup', { pleasant: 70 }).ok).toBe(true);
    expect(validateSkillResultValue('allocation', {}).ok).toBe(false);
  });

  it('validates rankedList', () => {
    expect(validateSkillResultValue('rankedList', ['A', 'B', 'C']).ok).toBe(true);
    expect(validateSkillResultValue('rankedList', []).ok).toBe(false);
  });

  it('validates multiChoice, matrix, mediaChoice, mediaRankedList', () => {
    expect(validateSkillResultValue('multiChoice', ['a', 'b']).ok).toBe(true);
    expect(validateSkillResultValue('matrix', { comfort: 'agree' }).ok).toBe(true);
    expect(validateSkillResultValue('matrix', [{ row: 'a', column: 'b' }]).ok).toBe(true);
    expect(validateSkillResultValue('mediaMatrix', { comfort: 'agree' }).ok).toBe(true);
    expect(validateSkillResultValue('mediaChoice', 'scene.jpg').ok).toBe(true);
    expect(validateSkillResultValue('mediaRankedList', ['a.jpg', 'b.jpg']).ok).toBe(true);
  });

  it('validates rating and compositeBlocks', () => {
    expect(validateSkillResultValue('rating', 4).ok).toBe(true);
    expect(validateSkillResultValue('compositeBlocks', {
      ratings: [{ id: 'safe', value: 5 }], words: ['green'], choice: 'yes', text: 'nice',
    }).ok).toBe(true);
    expect(validateSkillResultValue('compositeBlocks', {}).ok).toBe(false);
  });

  it('validates timeRanges, timeSeries, pairwise, bestWorst', () => {
    expect(validateSkillResultValue('timeRanges', [{ start: 1, end: 3 }]).ok).toBe(true);
    expect(validateSkillResultValue('timeRanges', { segments: [{ start: 0, end: 2 }] }).ok).toBe(true);
    expect(validateSkillResultValue('timeSeries', [{ t: 0, v: 50 }, { t: 1, value: 60 }]).ok).toBe(true);
    expect(validateSkillResultValue('pairwise', { preference: 20, imageA: 'a', imageB: 'b' }).ok).toBe(true);
    expect(validateSkillResultValue('pairwise', 35).ok).toBe(true);
    expect(validateSkillResultValue('bestWorst', { bestIndex: 0, worstIndex: 2 }).ok).toBe(true);
    expect(validateSkillResultValue('bestWorst', { best: 'a', worst: 'b' }).ok).toBe(true);
    expect(validateSkillResultValue('bestWorst', { bestIndex: 0 }).ok).toBe(false);
  });

  it('accepts unknown types with any value', () => {
    expect(validateSkillResultValue('myCustomGraph', { edges: [] }).ok).toBe(true);
  });
});

describe('checkAnswerAgainstResultSchema', () => {
  it('reports per-field status', () => {
    const schema = [
      { key: 'marks', label: 'Marks', type: 'points' },
      { key: 'note', label: 'Note', type: 'text' },
    ];
    const r = checkAnswerAgainstResultSchema(
      { marks: [{ x: 0.5, y: 0.5 }], imageUrl: 'http://x' },
      schema,
    );
    expect(r.recorded).toBe(true);
    expect(r.fields[0].ok).toBe(true);
    expect(r.fields[1].ok).toBe(false);
    expect(r.fields[1].detail).toBe('missing');
  });
});

describe('catalog', () => {
  it('includes annotation + structured archetypes', () => {
    expect(KNOWN_SKILL_RESULT_TYPE_IDS).toEqual(expect.arrayContaining([
      'points', 'path', 'polygon', 'bbox', 'allocation', 'rankedList',
      'multiChoice', 'matrix', 'mediaChoice', 'mediaRankedList',
      'rating', 'mediaMatrix', 'timeRanges', 'timeSeries', 'pairwise', 'bestWorst', 'compositeBlocks',
    ]));
  });
});
