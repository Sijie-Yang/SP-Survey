import {
  normalizeBatchSamJobs,
  estimateBatchSamCalls,
  BATCH_MODE_REPLACE_SAME_PROMPT,
} from './batchSamText';
import {
  preannotationSafeId,
  preannotationSafeIdPath,
  withShapeProvenance,
  SHAPE_SOURCE_SAM_TEXT,
} from './imageFeaturesR2';
import { remapShapeLabels, clearShapeLabel, removeShapesWithLabel } from './preannotateLabels';

describe('batchSamText helpers', () => {
  test('normalizeBatchSamJobs drops incomplete rows', () => {
    expect(normalizeBatchSamJobs([
      { prompt: 'tree', label: 'tree' },
      { prompt: 'car', label: '' },
      { prompt: '', label: 'road' },
    ])).toEqual([{ prompt: 'tree', label: 'tree' }]);
  });

  test('normalizeBatchSamJobs accepts legacy single pair', () => {
    expect(normalizeBatchSamJobs(null, { prompt: 'sky', label: 'sky' }))
      .toEqual([{ prompt: 'sky', label: 'sky' }]);
  });

  test('estimateBatchSamCalls multiplies images × jobs', () => {
    expect(estimateBatchSamCalls(10, 3)).toEqual({
      images: 10,
      jobs: 3,
      calls: 30,
      maxMasksPerCall: 32,
    });
  });

  test('default mode constant', () => {
    expect(BATCH_MODE_REPLACE_SAME_PROMPT).toBe('replace_same_prompt');
  });
});

describe('preannotation path keys', () => {
  test('path-aware id differs across folders', () => {
    const a = preannotationSafeIdPath({ name: 'img.jpg', folder: 'street/a' });
    const b = preannotationSafeIdPath({ name: 'img.jpg', folder: 'street/b' });
    expect(a).not.toBe(b);
    expect(a).toContain('street');
    expect(preannotationSafeId({ name: 'img.jpg', folder: 'street/a' })).toBe('img.jpg');
  });
});

describe('shape provenance + label migrate helpers', () => {
  test('withShapeProvenance stamps fields', () => {
    const s = withShapeProvenance(
      { id: '1', tool: 'polygon', points: [], label: 'tree' },
      { source: SHAPE_SOURCE_SAM_TEXT, prompt: 'tree', batchRunId: 'batch_1' },
    );
    expect(s.source).toBe('sam-text');
    expect(s.prompt).toBe('tree');
    expect(s.batchRunId).toBe('batch_1');
    expect(s.createdAt).toBeTruthy();
  });

  test('remap / clear / remove labels', () => {
    const shapes = [
      { id: '1', label: 'tree' },
      { id: '2', label: 'car' },
    ];
    expect(remapShapeLabels(shapes, 'tree', 'vegetation').map((s) => s.label))
      .toEqual(['vegetation', 'car']);
    expect(clearShapeLabel(shapes, 'tree').map((s) => s.label))
      .toEqual([null, 'car']);
    expect(removeShapesWithLabel(shapes, 'tree').map((s) => s.id))
      .toEqual(['2']);
  });
});
