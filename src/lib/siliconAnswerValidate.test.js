const {
  classifyQuestion,
  validateSiliconAnswer,
} = require('./siliconAnswerValidate');

describe('silicon answer validation', () => {
  test('supports every answerable platform family', () => {
    expect(classifyQuestion({ type: 'imageannotation' }).supported).toBe(false);
    expect(classifyQuestion({ type: 'skillquestion', skillResultSchema: [{ key: 'choice', type: 'choice' }] }).supported).toBe(false);
    expect(classifyQuestion({ type: 'text' }).supported).toBe(true);
    expect(classifyQuestion({ type: 'consent' }).supported).toBe(true);
    expect(classifyQuestion({ type: 'comment' }).supported).toBe(true);
    expect(classifyQuestion({
      type: 'matrix',
      rows: ['safety'],
      columns: ['low', 'high'],
    }).supported).toBe(true);
    expect(classifyQuestion({
      type: 'pointallocation',
      choices: ['trees', 'lights'],
      budget: 100,
    }).supported).toBe(true);
    expect(classifyQuestion({ type: 'imagerating' }).supported).toBe(true);
    expect(classifyQuestion({ type: 'html' }).supported).toBe(false);
  });

  test('validates ratings, checkboxes, text, matrix, allocation, annotation, and skills', () => {
    expect(validateSiliconAnswer({ type: 'imagerating', rateMin: 1, rateMax: 5 }, 4).ok).toBe(true);
    expect(validateSiliconAnswer({ type: 'imagerating', rateMin: 1, rateMax: 5 }, 999).ok).toBe(false);
    expect(validateSiliconAnswer({ type: 'imagerating' }, 'pretty').ok).toBe(false);
    expect(validateSiliconAnswer({
      type: 'imagecheckbox',
      choices: [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }],
    }, ['a']).ok).toBe(true);
    expect(validateSiliconAnswer({
      type: 'imagecheckbox',
      choices: [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }],
    }, ['c']).ok).toBe(false);
    expect(validateSiliconAnswer({
      type: 'imageranking',
      choices: [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
    }, ['c', 'c']).ok).toBe(false);
    expect(validateSiliconAnswer({ type: 'text' }, 'a quiet street').ok).toBe(true);
    expect(validateSiliconAnswer({ type: 'consent' }, true).ok).toBe(true);
    expect(validateSiliconAnswer({
      type: 'matrix',
      rows: ['safety', 'shade'],
      columns: ['low', 'high'],
    }, { safety: 'high', shade: 'low' }).ok).toBe(true);
    expect(validateSiliconAnswer({
      type: 'pointallocation',
      choices: ['trees', 'lights'],
      budget: 100,
    }, { trees: 40, lights: 60 }).ok).toBe(true);
    expect(validateSiliconAnswer({
      type: 'pointallocation',
      choices: ['trees', 'lights'],
      budget: 100,
    }, { trees: 40, lights: 10 }).ok).toBe(false);
    expect(validateSiliconAnswer({
      type: 'imageannotation',
      allowedTools: ['bbox'],
      annotationLabels: ['tree'],
      minAnnotations: 1,
    }, { shapes: [{ tool: 'bbox', label: 'tree', points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.5 }] }] }).ok).toBe(true);
    expect(validateSiliconAnswer({
      type: 'skillquestion',
      skillResultSchema: [{ key: 'choice', type: 'choice' }, { key: 'chosenIndex', type: 'number' }],
    }, { choice: 'A', chosenIndex: 0 }).ok).toBe(true);
    expect(validateSiliconAnswer({ type: 'number', min: 0, max: 100 }, 42).ok).toBe(true);
    expect(validateSiliconAnswer({ type: 'number', min: 10, max: 20 }, 5).ok).toBe(false);
    expect(validateSiliconAnswer({ type: 'imageranking', isRequired: true, choices: [{ value: 'a' }] }, []).ok).toBe(false);
    expect(classifyQuestion({ type: 'imagerating', mediaType: 'video' }).supported).toBe(true);
  });

  test('validates slider groups by dimension id and range', () => {
    const question = {
      type: 'imageslidergroup',
      scaleMin: 1,
      scaleMax: 7,
      dimensions: [
        { id: 'safe', label: '安全感', left: 'Unsafe', right: 'Safe' },
        { id: 'beauty', label: '美观', min: 0, max: 10 },
      ],
    };
    expect(classifyQuestion(question).supported).toBe(true);
    expect(validateSiliconAnswer(question, { safe: 4, beauty: 8 }).ok).toBe(true);
    expect(validateSiliconAnswer(question, { safe: 4 }).ok).toBe(false);
    expect(validateSiliconAnswer(question, 4).ok).toBe(false);
    expect(classifyQuestion({ type: 'imageslidergroup', dimensions: [] }).supported).toBe(false);
  });

  test('accepts multi-trial payloads and no longer blocks set assignment', () => {
    expect(classifyQuestion({ type: 'imagerating', visibleIf: '{q1} = 1' }).supported).toBe(true);
    expect(classifyQuestion({ type: 'imagerating', trialCount: 3 }).supported).toBe(true);
    expect(classifyQuestion({ type: 'imagerating', mediaAssignmentMode: 'set' }).supported).toBe(true);
    const checked = validateSiliconAnswer(
      { type: 'imagerating', rateMin: 1, rateMax: 5, trialCount: 2 },
      { trials: [{ answer: 2, shown_images: ['a'] }, { answer: 5, shown_images: ['b'] }] },
    );
    expect(checked.ok).toBe(true);
    expect(checked.answer.trials).toHaveLength(2);
    expect(validateSiliconAnswer(
      { type: 'imagerating', rateMin: 1, rateMax: 5, trialCount: 2 },
      4,
    ).ok).toBe(false);
  });
});
