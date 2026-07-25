import { convexHullNormalized, samBoxToPolygon } from './falInference';
import { extractSamInstances, pickSamInstance } from './falServer';

describe('SAM mask → polygon helpers', () => {
  test('convexHullNormalized covers a square', () => {
    const pts = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
      { x: 0.5, y: 0.5 },
    ];
    const hull = convexHullNormalized(pts);
    expect(hull.length).toBe(4);
  });

  test('samBoxToPolygon rejects near-full-frame boxes', () => {
    expect(samBoxToPolygon({ cx: 0.5, cy: 0.5, w: 0.98, h: 0.98 })).toEqual([]);
    const poly = samBoxToPolygon({ cx: 0.4, cy: 0.4, w: 0.2, h: 0.2 });
    expect(poly.length).toBe(4);
  });

  test('extractSamInstances returns all mid-size matches', () => {
    const instances = extractSamInstances({
      masks: [{ url: 'https://example.com/a.png' }, { url: 'https://example.com/b.png' }],
      boxes: [[0.3, 0.4, 0.15, 0.2], [0.7, 0.6, 0.1, 0.12]],
      scores: [0.9, 0.8],
    });
    expect(instances.length).toBe(2);
    expect(instances[0].maskUrl).toContain('a.png');
  });

  test('pickSamInstance still exposes first instance', () => {
    const picked = pickSamInstance({
      masks: [{ url: '' }, { url: 'https://example.com/b.png' }],
      boxes: [[0.5, 0.5, 0.99, 0.99], [0.3, 0.4, 0.15, 0.2]],
      scores: [0.9, 0.8],
    });
    expect(picked.candidates).toBeGreaterThanOrEqual(1);
    expect(picked.maskUrl || picked.box).toBeTruthy();
  });
});
