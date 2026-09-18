import { deriveSamPreannotFeatures, samLabelKey, preannotationKey } from './imageFeaturesR2';
import { createAnnotationHistory } from './annotationHistory';

const box = (label, x = 0) => ({ tool: 'bbox', label, points: [{ x, y: 0 }, { x: x + 0.5, y: 0.5 }] });

test('Chinese labels and literal escape-looking labels remain distinct', () => {
  expect(samLabelKey('树木')).not.toBe(samLabelKey('建筑'));
  expect(samLabelKey('Tree')).not.toBe(samLabelKey('tree'));
  expect(samLabelKey('tree')).toBe('tree');
  expect(samLabelKey('u_6811')).not.toBe(samLabelKey('树'));
  const record = deriveSamPreannotFeatures([box('树木'), box('建筑')], { labels: ['天空'], reviewStatus: 'accepted' });
  expect(record.features[`sam_count_${samLabelKey('树木')}`]).toBe(1);
  expect(record.features[`sam_count_${samLabelKey('建筑')}`]).toBe(1);
  expect(record.features[`sam_count_${samLabelKey('天空')}`]).toBe(0);
  expect(record.review_status).toBe('accepted');
  expect(record.label_dictionary[samLabelKey('树木')]).toBe('树木');
});

test('union coverage removes overlap while retaining summed area and object count', () => {
  const record = deriveSamPreannotFeatures([box('tree'), box('tree')]);
  expect(record.features.sam_total_mask_ratio).toBeCloseTo(0.25);
  expect(record.features.sam_ratio_tree).toBeCloseTo(0.25);
  expect(record.features.sam_area_sum_tree).toBeCloseTo(0.5);
  expect(record.features.sam_count_tree).toBe(2);
  expect(deriveSamPreannotFeatures([box('tree'), box('tree', 0.25)]).features.sam_ratio_tree).toBeCloseTo(0.375);
});

test('different labels share union coverage, points and lines do not invent area', () => {
  const record = deriveSamPreannotFeatures([box('tree'), box('building'), { tool: 'point', label: 'person', points: [{ x: 0.2, y: 0.2 }] }]);
  expect(record.features.sam_total_mask_ratio).toBeCloseTo(0.25);
  expect(record.features.sam_count_person).toBe(1);
  expect(record.features.sam_ratio_person).toBe(0);
});

test('stable annotation key survives moves and avoids same-name/Unicode collisions', () => {
  const a = { name: '照片.jpg', media_id: 'project/照片.jpg', folder: 'before' };
  expect(preannotationKey('user/project/', a)).toBe(preannotationKey('user/project/', { ...a, folder: 'after' }));
  expect(preannotationKey('user/project/', a)).not.toBe(preannotationKey('user/project/', { ...a, media_id: 'project/相片.jpg' }));
  expect(preannotationKey('user/project/', a)).not.toContain('%');
});

test('undo restores deletion, labels and entire drag; redo invalidates after another edit', () => {
  const history = createAnnotationHistory();
  const original = [box('tree')], labeled = [box('building')], dragged = [box('building', 0.25)];
  history.record(original);
  const gesture = {};
  history.record(labeled, gesture);
  history.record([box('building', 0.1)], gesture);
  expect(history.undo(dragged)).toEqual(labeled);
  expect(history.undo(labeled)).toEqual(original);
  expect(history.redo(original)).toEqual(labeled);
  history.record(labeled);
  expect(history.canRedo).toBe(false);
  expect(history.undo([])).toEqual(labeled);
});
