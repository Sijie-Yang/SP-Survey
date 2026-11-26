import { popDraftPoint } from './annotationDraftUndo';

const point = (x, y) => ({ x, y });
const shape = (tool, ...coords) => ({ tool, points: coords.map(([x, y]) => point(x, y)) });

test('undo removes only the last polygon or line vertex', () => {
  const polygon = shape('polygon', [0.1, 0.2], [0.3, 0.4], [0.5, 0.6]);
  const line = shape('line', [0.1, 0.1], [0.4, 0.2], [0.8, 0.9]);
  expect(popDraftPoint(polygon).points).toEqual([point(0.1, 0.2), point(0.3, 0.4)]);
  expect(polygon.points).toHaveLength(3);
  expect(popDraftPoint(line).points).toEqual([point(0.1, 0.1), point(0.4, 0.2)]);
  expect(popDraftPoint({ tool: 'path', points: [point(0, 0), point(1, 1)] }).points).toEqual([point(0, 0)]);
});

test('undo of the last remaining vertex clears the draft', () => {
  expect(popDraftPoint(shape('polygon', [0.2, 0.2]))).toBeNull();
  expect(popDraftPoint(shape('line', [0.2, 0.2]))).toBeNull();
  expect(popDraftPoint({ tool: 'region', points: [point(0.2, 0.2)] })).toBeNull();
});

test('box drafts stay intact so undo can still cancel them', () => {
  const box = { tool: 'bbox', points: [point(0, 0), point(1, 1)] };
  expect(popDraftPoint(box)).toBe(box);
  expect(popDraftPoint(null)).toBeNull();
});
