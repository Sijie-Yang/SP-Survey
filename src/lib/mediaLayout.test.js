import { defaultMediaSlots, mediaPlacements, normalizeMediaLayout, setMediaLayout } from './mediaLayout';
import { layoutImageGallery } from './imagePickerLayout';

test('mixed random ratios retain their order, natural proportions and one shared height', () => {
  const a = mediaPlacements({ height: 240, minHeight: 100, gap: 12 }, [4, 4/3], 900);
  const b = mediaPlacements({ height: 240, minHeight: 100, gap: 12 }, [4/3, 4], 900);
  expect(a.rows).toBe(1);
  expect(a.items[0].height).toBeCloseTo(a.items[1].height);
  expect(a.items[0].width / a.items[0].height).toBeCloseTo(4);
  expect(a.items[0].width).toBeCloseTo(b.items[1].width);
  expect(a.items[0].height).toBeCloseTo(b.items[1].height);
  expect(mediaPlacements({ minHeight: 140 }, [4,4], 390).rows).toBe(2);
  expect(mediaPlacements({ packing: 'row' }, [4,4], 390).rows).toBe(1);
});
test('free positions survive same-ratio replacement and fall back for incompatible samples', () => {
  const rule = { mode: 'free', slots: defaultMediaSlots([1,1]), stageHeight: 70 };
  const result = mediaPlacements(rule, [1,1], 600);
  expect(result.mode).toBe('free');
  expect(result.items[1].x).toBeGreaterThan(result.items[0].x);
  expect(mediaPlacements(rule, [4,1], 600)).toMatchObject({ mode: 'dynamic', fallback: 'ratio' });
  expect(mediaPlacements(rule, [1,1,1], 600)).toMatchObject({ mode: 'dynamic', fallback: 'count' });
  const single = mediaPlacements({ mode: 'free', slots: [{ x: 20, y: 5, width: 50, ar: 2 }] }, [2], 600);
  expect(single.items[0]).toEqual({ x: 120, y: 30, width: 300, height: 150 });
});
test('grid preserves aspect ratio; device edits and resets retain unrelated settings', () => {
  const result = mediaPlacements({ mode: 'grid', columns: 2, height: 180 }, [4,1,2], 600);
  expect(result.rows).toBe(2);
  expect(result.items.map(p => p.width/p.height)).toEqual([4,1,2]);
  const initial = { viewportLayout: { mobile: { questions: { q: { mediaWidth: 70 } } } } };
  const desktop = setMediaLayout(initial, 'desktop', 'q', { mode: 'grid' });
  expect(desktop.viewportLayout.mobile).toBe(initial.viewportLayout.mobile);
  expect(setMediaLayout(desktop, 'desktop', 'q', null).viewportLayout.desktop.questions.q).toBeUndefined();
  expect(normalizeMediaLayout({ slots: [{ width: 80, x: 90, y: -1 }] }).slots[0]).toMatchObject({ x: 20, y: 0, width: 80 });
});
test('participant gallery consumes saved rules and removes positioning when reset', () => {
  const host = document.createElement('div');
  host.dataset.spMediaLayout = JSON.stringify({ mode: 'free', slots: [{ x: 20, y: 10, width: 50, ar: 2 }] });
  host.innerHTML = '<div class="sd-image"><img class="sd-image__image" /></div>';
  document.body.appendChild(host);
  const root = host.firstChild, img = root.firstChild;
  Object.defineProperty(root, 'clientWidth', { value: 600 });
  Object.defineProperty(img, 'naturalWidth', { value: 1200 }); Object.defineProperty(img, 'naturalHeight', { value: 600 });
  layoutImageGallery(root);
  expect(root.dataset.spMediaMode).toBe('free');
  expect(img.style.left).toBe('120px'); expect(img.style.width).toBe('300px'); expect(img.style.height).toBe('150px');
  host.removeAttribute('data-sp-media-layout'); layoutImageGallery(root);
  expect(img.style.position).toBe(''); expect(img.style.left).toBe(''); expect(root.style.height).toBe('');
  host.remove();
});

test('dense rows and grids reduce gaps rather than overflow narrow cards', () => {
  for (const mode of ['dynamic', 'grid']) {
    const layout = mediaPlacements({ mode, packing: 'row', gap: 80, columns: 8 }, Array(12).fill(4), 200);
    layout.items.forEach(p => { expect(p.x).toBeGreaterThanOrEqual(-0.01); expect(p.x+p.width).toBeLessThanOrEqual(200.01); expect(p.height).toBeGreaterThan(0); });
  }
});
