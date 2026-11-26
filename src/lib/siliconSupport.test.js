import {
  classifyQuestion,
  groupSiliconProcess,
  siliconPlanSummary,
  siliconQuestionReport,
  siliconRunCounts,
  siliconRunOutcome,
  siliconRunPlan,
  surveyQuestionOrdinals,
} from './siliconSupport';

test('treats image slider groups with dimension ids as supported', () => {
  expect(classifyQuestion({
    type: 'imageslidergroup',
    dimensions: [{ id: 'safe', label: '安全感', left: 'Unsafe', right: 'Safe' }],
  }).supported).toBe(true);
  expect(classifyQuestion({ type: 'imageslidergroup', dimensions: [] }).supported).toBe(false);
  expect(classifyQuestion({ type: 'imageannotation' }).supported).toBe(false);
  expect(classifyQuestion({ type: 'imageannotation' }).verified).toBe(false);
  expect(classifyQuestion({ type: 'text' }).supported).toBe(true);
  expect(classifyQuestion({ type: 'imagerating', trialCount: 4 }).supported).toBe(true);
});

test('splits a draft into supported and unsupported pretest questions', () => {
  const report = siliconQuestionReport({
    pages: [{
      elements: [
        { type: 'html', name: 'intro' },
        { type: 'imagerating', name: 'pleasant', title: 'Pleasant' },
        { type: 'imageslidergroup', name: 'scales', dimensions: [{ id: 'safe' }] },
        { type: 'imagerating', name: 'mark', title: 'Mark the scene', trialCount: 2 },
      ],
    }],
  });
  expect(report.supported.map((item) => item.name)).toEqual(['pleasant', 'scales', 'mark']);
  expect(report.unsupported).toEqual([]);
});

test('labels run completion without calling it scientifically valid', () => {
  expect(siliconRunOutcome({ status: 'completed' }, {})).toBe('loading');
  expect(siliconRunOutcome({ status: 'completed' }, { answer: 3, hydrated: true })).toBe('allComplete');
  expect(siliconRunOutcome({ status: 'completed' }, { answer: 0, error: 4, hydrated: true })).toBe('allFailed');
  expect(siliconRunOutcome({ status: 'completed' }, { answer: 2, error: 1, hydrated: true })).toBe('partialValid');
  expect(siliconRunOutcome({ status: 'partial', error_summary: 'Token budget exhausted; run is partially complete.' }, { hydrated: true })).toBe('budgetPartial');
  expect(siliconRunOutcome({ status: 'failed', error_summary: 'Token budget exhausted before the run completed.' }, { hydrated: true })).toBe('budgetFailed');
  expect(siliconRunOutcome({ status: 'failed', error_summary: 'Provider 500' }, { hydrated: true })).toBe('allFailed');
  expect(siliconRunOutcome({ status: 'failed', error_summary: 'Provider 500' }, {
    answer: 2,
    error: 1,
    hydrated: true,
  })).toBe('failed');
  expect(siliconRunCounts({ status: 'running' }).ready).toBe(false);
  expect(siliconRunCounts({ status: 'running', progress_valid: 0, progress_processed: 0, counts_ready: true }).ready).toBe(true);
  expect(siliconRunOutcome({ status: 'failed', error_summary: 'No usable images resolved' }, {
    answer: 0,
    skip: 4,
    hydrated: true,
  })).toBe('allFailed');
});

test('separates personas, envelopes, and trial units', () => {
  const survey = {
    pages: [{
      elements: [
        { type: 'html', name: 'intro' },
        { type: 'text', name: 'q1', title: 'City' },
        { type: 'imagerating', name: 'comfort', title: 'Street comfort', trialCount: 4 },
        { type: 'ranking', name: 'walk', title: 'Walk preference' },
      ],
    }],
  };
  expect(siliconPlanSummary({
    personaCount: 1,
    repeats: 1,
    questions: [{ type: 'imagerating', trialCount: 1 }],
  })).toEqual({ personas: 1, repeats: 1, envelopes: 1, questions: 1, trials: 1 });
  expect(siliconPlanSummary({
    personaCount: 1,
    repeats: 1,
    questionNames: ['comfort'],
    surveyConfig: survey,
  })).toEqual({ personas: 1, repeats: 1, envelopes: 1, questions: 1, trials: 4 });
  expect(siliconRunPlan({
    persona_ids: ['p1'],
    repeats: 1,
    question_names: ['comfort'],
    survey_snapshot: survey,
  }).trials).toBe(4);
  expect(siliconRunPlan({
    persona_ids: ['p1'],
    repeats: 1,
    question_names: ['comfort'],
    progress_total: 4,
  })).toEqual({
    personas: 1,
    repeats: 1,
    envelopes: 1,
    questions: 1,
    trials: 4,
  });
  expect(surveyQuestionOrdinals(survey)).toEqual({
    q1: { n: 1, title: 'City', type: 'text' },
    comfort: { n: 2, title: 'Street comfort', type: 'imagerating' },
    walk: { n: 3, title: 'Walk preference', type: 'ranking' },
  });
});

test('groups process cards by persona, envelope, frozen question number, and trial', () => {
  const run = {
    persona_ids: ['p1'],
    repeats: 1,
    question_names: ['comfort'],
    persona_snapshot: [{ id: 'p1', name: '林女士' }],
    survey_snapshot: {
      pages: [{
        elements: [
          { type: 'html', name: 'intro' },
          { type: 'text', name: 'city', title: 'City' },
          { type: 'imagerating', name: 'comfort', title: '街景舒适度评分', trialCount: 4 },
        ],
      }],
    },
    execution_plan: {
      questions: [{ name: 'comfort', title: '街景舒适度评分', trials: 4, supported: true }],
    },
  };
  const grouped = groupSiliconProcess({
    run,
    units: [
      { persona_id: 'p1', repeat_index: 1, question_name: 'comfort', trial_index: 1, status: 'saved', answer: 4 },
      { persona_id: 'p1', repeat_index: 1, question_name: 'comfort', trial_index: 2, status: 'saved', answer: 3 },
      { persona_id: 'p1', repeat_index: 1, question_name: 'comfort', trial_index: 3, status: 'pending' },
      { persona_id: 'p1', repeat_index: 1, question_name: 'comfort', trial_index: 4, status: 'pending' },
    ],
    events: [
      { type: 'unit.start', question_name: 'comfort', payload: { persona_id: 'p1', repeat_index: 1, trial_index: 3 } },
      { type: 'unit.start', question_name: 'comfort', payload: { persona_id: 'p1', repeat_index: 1, trial_index: 3 } },
    ],
  });
  expect(grouped).toHaveLength(1);
  expect(grouped[0].personaName).toBe('林女士');
  expect(grouped[0].questions).toHaveLength(1);
  expect(grouped[0].questions[0].ordinal).toBe(2);
  expect(grouped[0].questions[0].title).toBe('街景舒适度评分');
  expect(grouped[0].questions[0].trialCount).toBe(4);
  expect(grouped[0].questions[0].state).toBe('active');
  expect(grouped[0].questions[0].trials).toHaveLength(4);
  expect(grouped[0].questions[0].trials[2].events).toHaveLength(2);
});

