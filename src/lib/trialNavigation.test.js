import {
  SP_TRIALS_ANSWER_KEY,
  allTrialsAnswered,
  buildProgressUnits,
  clampTrialCount,
  clearTrialsAnswerStore,
  collectSurveyDataWithTrials,
  emptyTrialsAnswer,
  getAnswerablePageQuestions,
  getTrialCount,
  isTrialsAnswer,
  normalizeTrialsAnswer,
  persistTrialsAnswer,
  questionUnitHasAnswer,
  supportsTrialLoop,
  trialHasAnswer,
} from './trialNavigation';

describe('trialNavigation', () => {
  test('supportsTrialLoop for interactive media types only', () => {
    expect(supportsTrialLoop('imagerating')).toBe(true);
    expect(supportsTrialLoop('imagepicker')).toBe(true);
    expect(supportsTrialLoop('image')).toBe(false);
    expect(supportsTrialLoop('skillquestion')).toBe(false);
    expect(supportsTrialLoop('rating')).toBe(false);
  });

  test('getTrialCount clamps and defaults', () => {
    expect(getTrialCount({ type: 'imagerating' })).toBe(1);
    expect(getTrialCount({ type: 'imagerating', trialCount: 10 })).toBe(10);
    expect(getTrialCount({ type: 'imagerating', trialCount: 999 })).toBe(200);
    expect(clampTrialCount('0')).toBe(1);
  });

  test('normalizeTrialsAnswer wraps legacy flat values', () => {
    const n = normalizeTrialsAnswer(4, 3);
    expect(isTrialsAnswer(n)).toBe(true);
    expect(n.trials[0].value).toBe(4);
    expect(n.trials[1].value).toBe(null);
  });

  test('allTrialsAnswered', () => {
    const ans = emptyTrialsAnswer(2);
    expect(allTrialsAnswered(ans, 2)).toBe(false);
    ans.trials[0].value = 3;
    ans.trials[1].value = 5;
    expect(allTrialsAnswered(ans, 2)).toBe(true);
    expect(trialHasAnswer({ value: 0 })).toBe(true);
  });

  test('buildProgressUnits expands trialCount', () => {
    const units = buildProgressUnits([
      { name: 'q1', type: 'imagerating', trialCount: 3 },
      { name: 'q2', type: 'text', trialCount: 5 },
    ]);
    expect(units).toHaveLength(4); // 3 + 1 (text ignores trial loop)
    expect(units.filter((u) => u.questionName === 'q1')).toHaveLength(3);
  });

  test('questionUnitHasAnswer prefers trials store when trialCount briefly looks like 1', () => {
    clearTrialsAnswerStore();
    const trials = emptyTrialsAnswer(3);
    trials.trials[0].value = 4;
    trials.trials[1].value = 5;
    const q = {
      name: 'q_rate',
      type: 'imagerating',
      // Simulate SurveyJS dropping trialCount during media apply
      trialCount: 1,
      value: null,
    };
    persistTrialsAnswer(q, trials, 2);
    expect(questionUnitHasAnswer(q, 0)).toBe(true);
    expect(questionUnitHasAnswer(q, 1)).toBe(true);
    expect(questionUnitHasAnswer(q, 2)).toBe(false);
    clearTrialsAnswerStore();
  });

  test('collectSurveyDataWithTrials prefers module store / spTrialsAnswer', () => {
    clearTrialsAnswerStore();
    const trials = emptyTrialsAnswer(2);
    trials.trials[0].value = 'a';
    trials.trials[1].value = 'b';
    const q1 = {
      name: 'q1',
      type: 'imagepicker',
      trialCount: 2,
      value: 'b',
      trialMediaSets: [[{ url: 'a.jpg' }], [{ url: 'b.jpg' }]],
    };
    persistTrialsAnswer(q1, trials, 1);
    const survey = {
      data: { q1: 'b', q2: 'hello' },
      getAllQuestions: () => ([
        q1,
        { name: 'q2', type: 'text', trialCount: 1, value: 'hello' },
      ]),
    };
    const data = collectSurveyDataWithTrials(survey);
    expect(data.q1.trials).toHaveLength(2);
    expect(data.q1.trials[0].value).toBe('a');
    expect(data.q1.trials[1].value).toBe('b');
    expect(data.q2).toBe('hello');
    clearTrialsAnswerStore();
  });

  test('getAnswerablePageQuestions skips html', () => {
    const page = {
      questions: [
        { name: 'intro', getType: () => 'html' },
        { name: 'q1', getType: () => 'radiogroup' },
      ],
    };
    expect(getAnswerablePageQuestions(page).map((q) => q.name)).toEqual(['q1']);
  });

  test('questionUnitHasAnswer ignores empty values', () => {
    expect(questionUnitHasAnswer({ type: 'text', value: '' }, 0)).toBe(false);
    expect(questionUnitHasAnswer({ type: 'text', value: 'hi' }, 0)).toBe(true);
    const trials = emptyTrialsAnswer(2);
    trials.trials[0].value = 'a';
    expect(questionUnitHasAnswer({
      type: 'imagepicker',
      trialCount: 2,
      value: 'a',
      [SP_TRIALS_ANSWER_KEY]: trials,
    }, 0)).toBe(true);
    expect(questionUnitHasAnswer({
      type: 'imagepicker',
      trialCount: 2,
      value: null,
      [SP_TRIALS_ANSWER_KEY]: trials,
    }, 1)).toBe(false);
  });

  test('imagematrix / mediamatrix require every row answered', () => {
    const q = {
      type: 'imagematrix',
      rows: [{ value: 'r1' }, { value: 'r2' }, { value: 'r3' }],
      columns: [{ value: 'c1' }, { value: 'c2' }],
      value: { r1: 'c1' },
    };
    expect(questionUnitHasAnswer(q, 0)).toBe(false);
    expect(trialHasAnswer({ value: { r1: 'c1' } }, q)).toBe(false);
    q.value = { r1: 'c1', r2: 'c2', r3: 'c1' };
    expect(questionUnitHasAnswer(q, 0)).toBe(true);

    const trials = emptyTrialsAnswer(2);
    trials.trials[0].value = { r1: 'c1', r2: 'c2' };
    const mq = {
      type: 'mediamatrix',
      trialCount: 2,
      rows: ['a', 'b'],
      [SP_TRIALS_ANSWER_KEY]: trials,
    };
    expect(questionUnitHasAnswer(mq, 0)).toBe(false);
    trials.trials[0].value = { a: 'x', b: 'y' };
    expect(questionUnitHasAnswer(mq, 0)).toBe(true);
    expect(allTrialsAnswered(trials, 2, mq)).toBe(false);
    trials.trials[1].value = { a: 'x', b: 'y' };
    expect(allTrialsAnswered(trials, 2, mq)).toBe(true);
  });
});
