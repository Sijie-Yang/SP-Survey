import { dimensionDisplayName, dimensionIncomplete, describeDimensionIncomplete, normalizeSliderDimension, persistSliderAliases, sliderScale, sliderGroupAnswerValid } from './sliderScale';
import { validateQuestionSettings, validateSurveyConfig } from './designProtocol/validate';
import { trialHasAnswer } from './trialNavigation';

test('dimension display names keep ids stable and fall back for missing labels', () => {
  expect(dimensionDisplayName({ id: 'safe', label: '安全感', left: 'Unsafe', right: 'Safe' })).toBe('安全感');
  expect(dimensionDisplayName({ id: 'safe', left: 'Unsafe', right: 'Safe' })).toBe('safe');
  expect(dimensionDisplayName({ id: 'dim_1' }, 0)).toBe('Dimension 1');
  expect(dimensionDisplayName({ id: 'dim_2' }, 1, { locale: 'zh' })).toBe('维度 2');
  expect(normalizeSliderDimension({ name: '舒适度' }, 0)).toMatchObject({
    id: '舒适度',
    label: '舒适度',
  });
  expect(normalizeSliderDimension({ name: '舒适度' }, 0).left).toBeUndefined();
  expect(normalizeSliderDimension({ value: 'greenery', text: '绿化感' }, 0)).toMatchObject({
    id: 'greenery',
    label: '绿化感',
  });
  expect(normalizeSliderDimension({ id: 'safe', value: 'other', text: '安全感' }, 0).id).toBe('safe');
  expect(dimensionDisplayName({ value: 'greenery', text: '绿化感' })).toBe('绿化感');
  expect(persistSliderAliases({
    pages: [{ elements: [{ type: 'slidergroup', dimensions: [{ value: 'greenery', text: '绿化感', left: '少', right: '多' }] }] }],
  }).pages[0].elements[0].dimensions[0]).toMatchObject({
    id: 'greenery',
    label: '绿化感',
    left: '少',
    right: '多',
  });
});

test('generated {id,left,right} and pole aliases match survey settings', () => {
  expect(dimensionIncomplete({ id: 'safety', left: 'Unsafe', right: 'Safe' })).toBe(false);
  expect(normalizeSliderDimension({ id: 'safety', left: 'Unsafe', right: 'Safe' }, 0)).toMatchObject({
    id: 'safety',
    label: 'safety',
    left: 'Unsafe',
    right: 'Safe',
  });
  expect(normalizeSliderDimension({
    id: 'walkability',
    leftLabel: 'Hard to walk',
    rightLabel: 'Easy to walk',
  }, 0)).toMatchObject({
    id: 'walkability',
    label: 'walkability',
    left: 'Hard to walk',
    right: 'Easy to walk',
  });
  expect(dimensionIncomplete({ id: 'dim_1', left: 'Low', right: 'High' })).toBe(true);
  expect(describeDimensionIncomplete({ id: 'dim_1' }, 0)).toMatch(/Dimension 1 "dim_1" is incomplete \(missing display name \(label\), left pole, right pole\)/);
  const report = validateSurveyConfig({
    pages: [{
      name: 'page_perception',
      elements: [{
        name: 'scene_semantic_diff',
        title: '请对这张街景在下列维度上进行评价',
        type: 'imageslidergroup',
        dimensions: [{ id: 'dim_1' }],
      }],
    }],
  });
  expect(report.warnings.some((w) => (
    w.message.includes('Question "scene_semantic_diff"')
    && w.message.includes('请对这张街景在下列维度上进行评价')
    && w.message.includes('dim_1')
    && w.message.includes('display name (label)')
  ))).toBe(true);
  expect(validateSurveyConfig({
    pages: [{
      name: 'page_perception',
      elements: [{
        name: 'scene_semantic_diff',
        type: 'imageslidergroup',
        dimensions: [{ id: 'safety', left: '感觉不安全', right: '感觉很安全' }],
      }],
    }],
  }).warnings.filter((w) => w.path.includes('dimensions'))).toEqual([]);
});

test('dimension overrides use inherited bounds and a reachable midpoint', () => {
  expect(sliderScale({ min: 0, step: 0.5 }, { scaleMax: 3 })).toMatchObject({ min: 0, max: 3, step: 0.5, midpoint: 1.5 });
  expect(sliderScale({}, { scaleMin: 0, scaleMax: 5, scaleStep: 2 }).midpoint).toBe(2);
});
test('settings reject reversed and inherited invalid ranges, but unlimited caps remain valid', () => {
  expect(validateQuestionSettings({ type: 'slidergroup', scaleMin: 7, scaleMax: 1 }).length).toBeGreaterThan(0);
  expect(validateQuestionSettings({ minAnnotations: 5, maxAnnotations: 1 }).length).toBeGreaterThan(0);
  expect(validateQuestionSettings({ minAnnotations: 5, maxAnnotations: 0 })).toEqual([]);
  expect(validateQuestionSettings({ minSelectedChoices: 2, maxSelectedChoices: 0 })).toEqual([]);
  expect(validateQuestionSettings({ scaleMax: 7, dimensions: [{ id: 'x', min: 8 }] }).length).toBeGreaterThan(0);
  expect(validateQuestionSettings({ scaleStep: 0, minAnnotations: 1.5 })).toHaveLength(2);
});
test('trial completion requires all dimensions and respects zero, steps and finite ranges', () => {
  const question = { type: 'imageslidergroup', scaleMin: 0, scaleMax: 3, scaleStep: 0.5, dimensions: [{ id: 'a' }, { id: 'b' }] };
  expect(trialHasAnswer({ value: { a: 0 } }, question)).toBe(false);
  expect(trialHasAnswer({ value: { a: 0, b: 1.5 } }, question)).toBe(true);
  expect(sliderGroupAnswerValid({ a: 0, b: 1.2 }, question, true)).toBe(false);
  expect(sliderGroupAnswerValid({ a: 0, b: 4 }, question, true)).toBe(false);
  expect(sliderGroupAnswerValid({ a: 0 }, question)).toBe(true);
});
