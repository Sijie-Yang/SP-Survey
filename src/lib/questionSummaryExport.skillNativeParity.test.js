import {
  buildQuestionExportFiles,
  buildQuestionLongCsv,
  buildQuestionSummaryCsv,
} from './questionSummaryExport';
import { skillFieldNativeQuestion } from './skillNativeAdapter.mjs';
import { SKILL_RESULT_TYPES } from './skillResultTypes';

function normalize(csv, skillName, nativeName, fieldKey = 'value') {
  return String(csv).replaceAll(`${skillName}__${fieldKey}`, nativeName);
}

function row(questionName, answer, shown = []) {
  return {
    id: `r_${questionName}`,
    participant_id: 'p1',
    created_at: '2026-01-01T00:00:00Z',
    responses: { [questionName]: { answer, shown_images: shown } },
  };
}

describe('Skill field export parity with equivalent native questions', () => {
  test.each([
    {
      label: 'number',
      native: { name: 'native', type: 'number' },
      skill: { name: 'skill', type: 'skillquestion', skillResultSchema: [{ key: 'value', type: 'number' }] },
      nativeAnswer: 4,
      skillAnswer: { value: 4 },
    },
    {
      label: 'choice',
      native: { name: 'native', type: 'radiogroup', choices: ['a', 'b'] },
      skill: { name: 'skill', type: 'skillquestion', skillResultSchema: [{ key: 'value', type: 'choice', options: ['a', 'b'] }] },
      nativeAnswer: 'a',
      skillAnswer: { value: 'a' },
    },
    {
      label: 'multi choice',
      native: { name: 'native', type: 'checkbox', choices: ['a', 'b'] },
      skill: { name: 'skill', type: 'skillquestion', skillResultSchema: [{ key: 'value', type: 'multiChoice', options: ['a', 'b'] }] },
      nativeAnswer: ['a', 'b'],
      skillAnswer: { value: ['a', 'b'] },
    },
    {
      label: 'ranking',
      native: { name: 'native', type: 'ranking', choices: ['a', 'b'] },
      skill: { name: 'skill', type: 'skillquestion', skillResultSchema: [{ key: 'value', type: 'rankedList', options: ['a', 'b'] }] },
      nativeAnswer: ['a', 'b'],
      skillAnswer: { value: ['a', 'b'] },
    },
    {
      label: 'allocation',
      native: { name: 'native', type: 'pointallocation', choices: ['a', 'b'], budget: 100 },
      skill: { name: 'skill', type: 'skillquestion', skillResultSchema: [{ key: 'value', type: 'allocation', options: ['a', 'b'], budget: 100 }] },
      nativeAnswer: { a: 40, b: 60 },
      skillAnswer: { value: { a: 40, b: 60 } },
    },
    {
      label: 'matrix',
      native: { name: 'native', type: 'matrix', rows: ['r1', 'r2'], columns: ['yes', 'no'] },
      skill: { name: 'skill', type: 'skillquestion', skillResultSchema: [{ key: 'value', type: 'matrix', rows: ['r1', 'r2'], columns: ['yes', 'no'] }] },
      nativeAnswer: { r1: 'yes', r2: 'no' },
      skillAnswer: { value: { r1: 'yes', r2: 'no' } },
    },
    {
      label: 'scale group',
      native: { name: 'native', type: 'slidergroup', dimensions: [{ id: 'warm', label: 'Warm' }, { id: 'clear', label: 'Clear' }] },
      skill: { name: 'skill', type: 'skillquestion', skillResultSchema: [{ key: 'value', type: 'scaleGroup', dimensions: [{ id: 'warm', label: 'Warm' }, { id: 'clear', label: 'Clear' }] }] },
      nativeAnswer: { warm: 4, clear: 6 },
      skillAnswer: { value: { warm: 4, clear: 6 } },
    },
    {
      label: 'rating',
      native: { name: 'native', type: 'rating', rateMin: 1, rateMax: 7 },
      skill: { name: 'skill', type: 'skillquestion', skillResultSchema: [{ key: 'value', type: 'rating', min: 1, max: 7 }] },
      nativeAnswer: 6,
      skillAnswer: { value: 6 },
    },
    {
      label: 'count',
      native: { name: 'native', type: 'number', min: 0 },
      skill: { name: 'skill', type: 'skillquestion', skillResultSchema: [{ key: 'value', type: 'count' }] },
      nativeAnswer: 3,
      skillAnswer: { value: ['a', 'b', 'c'] },
    },
  ])('$label long and summary are byte-equivalent after question-name normalization', ({ native, skill, nativeAnswer, skillAnswer }) => {
    const nativeRows = [row(native.name, nativeAnswer)];
    const skillRows = [row(skill.name, skillAnswer)];
    const nativeLong = buildQuestionLongCsv(native, nativeRows, null);
    const skillLong = normalize(buildQuestionLongCsv(skill, skillRows, null), skill.name, native.name);
    expect(skillLong).toBe(nativeLong);
    const nativeSummary = buildQuestionSummaryCsv(native, nativeRows);
    const skillSummary = normalize(buildQuestionSummaryCsv(skill, skillRows), skill.name, native.name);
    expect(skillSummary).toBe(nativeSummary);
  });

  test('media boolean uses the native mediaboolean family', () => {
    const image = 'https://cdn.example/a.jpg';
    const native = { name: 'native', type: 'mediaboolean' };
    const skill = {
      name: 'skill', type: 'skillquestion', imageCount: 1,
      skillResultSchema: [{ key: 'value', type: 'boolean' }],
    };
    const nativeRows = [row(native.name, true, [image])];
    const skillRows = [row(skill.name, { value: true, imageUrl: image }, [image])];
    expect(normalize(buildQuestionLongCsv(skill, skillRows, null), 'skill', 'native'))
      .toBe(buildQuestionLongCsv(native, nativeRows, null));
    expect(normalize(buildQuestionSummaryCsv(skill, skillRows), 'skill', 'native'))
      .toBe(buildQuestionSummaryCsv(native, nativeRows));
  });

  test('a strict single-field Skill exports only the same native long and summary tables', () => {
    const skill = {
      name: 'skill', type: 'skillquestion',
      skillResultSchema: [{ key: 'value', type: 'choice', options: ['a', 'b'] }],
    };
    const files = buildQuestionExportFiles(skill, [row('skill', { value: 'a' })], null);
    expect(files.map((file) => file.path)).toEqual([
      'questions/skill__long.csv',
      'questions/skill__summary.csv',
    ]);
    expect(files.some((file) => /raw_json|__field__/.test(file.path))).toBe(false);
  });

  test('Builder skillConfig overrides flow into the equivalent native question settings', () => {
    const native = skillFieldNativeQuestion({
      name: 'skill',
      type: 'skillquestion',
      skillConfig: { options: ['new-a', 'new-b'] },
    }, {
      key: 'choice', type: 'choice', options: ['old-a', 'old-b'],
    });
    expect(native.type).toBe('radiogroup');
    expect(native.choices).toEqual([
      { value: 'new-a', text: 'new-a' },
      { value: 'new-b', text: 'new-b' },
    ]);
  });

  test.each([
    {
      label: 'media choice',
      native: { name: 'native', type: 'mediapicker' },
      field: { key: 'pick', type: 'mediaChoice' },
      nativeAnswer: 'a.jpg',
      skillAnswer: { pick: 'a.jpg', shownUrls: ['a.jpg', 'b.jpg'] },
      shown: ['a.jpg', 'b.jpg'],
    },
    {
      label: 'media ranking',
      native: { name: 'native', type: 'mediaranking' },
      field: { key: 'order', type: 'mediaRankedList' },
      nativeAnswer: ['a.jpg', 'b.jpg', 'c.jpg'],
      skillAnswer: { order: ['a.jpg', 'b.jpg', 'c.jpg'], shownUrls: ['a.jpg', 'b.jpg', 'c.jpg'] },
      shown: ['a.jpg', 'b.jpg', 'c.jpg'],
    },
    {
      label: 'annotation path',
      native: { name: 'native', type: 'imageannotation', annotationLabels: [] },
      field: { key: 'trace', type: 'path' },
      nativeAnswer: { shapes: [{ tool: 'line', points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }], label: 'trace' }] },
      skillAnswer: { trace: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }], imageUrl: 'a.jpg' },
      shown: ['a.jpg'],
    },
    {
      label: 'media matrix',
      native: { name: 'native', type: 'mediamatrix', rows: ['safe'], columns: ['yes', 'no'] },
      field: { key: 'grid', type: 'mediaMatrix', rows: ['safe'], columns: ['yes', 'no'] },
      nativeAnswer: { safe: 'yes' },
      skillAnswer: { grid: { safe: 'yes' }, imageUrl: 'a.jpg' },
      shown: ['a.jpg'],
    },
    {
      label: 'emotion color',
      native: { name: 'native', type: 'skillquestion', skillId: 'preset_emotion_color_picker' },
      field: { key: 'tone', type: 'color' },
      nativeAnswer: { color: { hex: '#4a90d9', source: 'custom' }, imageUrl: 'a.jpg' },
      skillAnswer: { tone: '#4a90d9', imageUrl: 'a.jpg' },
      shown: ['a.jpg'],
    },
    {
      label: 'composite blocks',
      native: { name: 'native', type: 'skillquestion', skillId: 'preset_composite_blocks' },
      field: { key: 'blocks', type: 'compositeBlocks' },
      nativeAnswer: { ratings: [{ id: 'safe', value: 5 }], words: ['green'], choice: 'visit', text: 'nice', imageUrl: 'a.jpg' },
      skillAnswer: { blocks: { ratings: [{ id: 'safe', value: 5 }], words: ['green'], choice: 'visit', text: 'nice' }, imageUrl: 'a.jpg' },
      shown: ['a.jpg'],
    },
  ])('$label reuses the exact native export family', ({ native, field, nativeAnswer, skillAnswer, shown }) => {
    const skill = { name: 'skill', type: 'skillquestion', skillResultSchema: [field] };
    const nativeRows = [row(native.name, nativeAnswer, shown)];
    const skillRows = [row(skill.name, skillAnswer, shown)];
    expect(normalize(buildQuestionLongCsv(skill, skillRows, null), 'skill', 'native', field.key))
      .toBe(buildQuestionLongCsv(native, nativeRows, null));
    expect(normalize(buildQuestionSummaryCsv(skill, skillRows), 'skill', 'native', field.key))
      .toBe(buildQuestionSummaryCsv(native, nativeRows));
  });

  test('every declared legacy-readable Skill type except json has a typed native/preset result route', () => {
    const expected = {
      number: 'number', rating: 'rating', boolean: 'boolean', choice: 'radiogroup', text: 'comment',
      count: 'number', color: 'skillquestion', scaleGroup: 'slidergroup', points: 'imageannotation',
      path: 'imageannotation', polygon: 'imageannotation', bbox: 'imageannotation', allocation: 'pointallocation',
      rankedList: 'ranking', multiChoice: 'checkbox', matrix: 'matrix', mediaMatrix: 'mediamatrix',
      mediaChoice: 'mediapicker', mediaRankedList: 'mediaranking', timeRanges: 'skillquestion',
      timeSeries: 'skillquestion', pairwise: 'skillquestion', pairwiseChoice: 'skillquestion',
      pairwisePreference: 'skillquestion', bestWorst: 'skillquestion', compositeBlocks: 'skillquestion',
    };
    const expectedPreset = {
      color: 'preset_emotion_color_picker',
      timeRanges: 'preset_video_moment_tag',
      timeSeries: 'preset_video_continuous_rating',
      pairwise: 'preset_image_preference_slider',
      pairwiseChoice: 'preset_image_preference_forced',
      pairwisePreference: 'preset_image_preference_slider',
      bestWorst: 'preset_best_worst_choice',
      compositeBlocks: 'preset_composite_blocks',
    };
    const declared = Object.keys(SKILL_RESULT_TYPES).filter((type) => type !== 'json').sort();
    expect(Object.keys(expected).sort()).toEqual(declared);
    declared.forEach((type) => {
      const native = skillFieldNativeQuestion(
        { name: 'skill', type: 'skillquestion', imageCount: 0 },
        { key: 'value', type },
      );
      expect(native?.type).toBe(expected[type]);
      if (expectedPreset[type]) expect(native?.skillId).toBe(expectedPreset[type]);
    });
    expect(skillFieldNativeQuestion(
      { name: 'skill', type: 'skillquestion' },
      { key: 'value', type: 'json' },
    )).toBeNull();
  });

  test('numeric SurveyJS text questions use scalar export instead of text export', () => {
    const question = { name: 'numeric_text', type: 'text', inputType: 'number', min: 0, max: 10 };
    const responses = [row(question.name, 7)];
    expect(buildQuestionLongCsv(question, responses, null).split('\n')[0]).toContain(',value');
    expect(buildQuestionLongCsv(question, responses, null).split('\n')[0]).not.toContain(',text');
    expect(buildQuestionSummaryCsv(question, responses)).toContain(',mean,7,1');
  });
});
