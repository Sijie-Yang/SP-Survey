import {
  shapeBBoxIoU,
  findDuplicateShapePairs,
  dedupeShapesByOverlap,
  isSamTextShapeForPrompt,
} from './annotationGeometry';

function poly(id, label, x1, y1, x2, y2, extra = {}) {
  return {
    id,
    label,
    tool: 'polygon',
    points: [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ],
    ...extra,
  };
}

describe('annotationGeometry', () => {
  test('shapeBBoxIoU is 1 for identical boxes', () => {
    const a = poly('a', 'tree', 0.1, 0.1, 0.4, 0.4);
    const b = poly('b', 'tree', 0.1, 0.1, 0.4, 0.4);
    expect(shapeBBoxIoU(a, b)).toBeCloseTo(1, 5);
  });

  test('shapeBBoxIoU is 0 for disjoint boxes', () => {
    const a = poly('a', 'tree', 0.0, 0.0, 0.2, 0.2);
    const b = poly('b', 'tree', 0.5, 0.5, 0.7, 0.7);
    expect(shapeBBoxIoU(a, b)).toBe(0);
  });

  test('findDuplicateShapePairs finds high overlap same label', () => {
    const shapes = [
      poly('a', 'tree', 0.1, 0.1, 0.5, 0.5),
      poly('b', 'tree', 0.12, 0.12, 0.52, 0.52),
      poly('c', 'car', 0.1, 0.1, 0.5, 0.5),
    ];
    const pairs = findDuplicateShapePairs(shapes, { iouThreshold: 0.7 });
    expect(pairs.some((p) => p.aId === 'a' && p.bId === 'b')).toBe(true);
    expect(pairs.every((p) => p.label === 'tree')).toBe(true);
  });

  test('dedupeShapesByOverlap keeps larger shape', () => {
    const shapes = [
      poly('small', 'tree', 0.20, 0.20, 0.40, 0.40),
      poly('large', 'tree', 0.19, 0.19, 0.41, 0.41),
    ];
    expect(shapeBBoxIoU(shapes[0], shapes[1])).toBeGreaterThan(0.7);
    const { shapes: out, removedIds } = dedupeShapesByOverlap(shapes, { iouThreshold: 0.7 });
    expect(out.map((s) => s.id)).toEqual(['large']);
    expect(removedIds).toEqual(['small']);
  });

  test('isSamTextShapeForPrompt matches provenance', () => {
    expect(isSamTextShapeForPrompt({ source: 'sam-text', prompt: 'tree' }, 'tree')).toBe(true);
    expect(isSamTextShapeForPrompt({ source: 'sam-text', prompt: 'car' }, 'tree')).toBe(false);
    expect(isSamTextShapeForPrompt({ label: 'tree' }, 'tree')).toBe(false);
  });
});
