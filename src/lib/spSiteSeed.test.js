import { prepareSiteDocument, seededRandomScript } from './spSite';

function runSeeded(seed, n = 5) {
  const body = seededRandomScript(seed).replace(/^<script>|<\/script>$/g, '');
  const sandbox = { Math: Object.create(Math) };
  // eslint-disable-next-line no-new-func
  new Function('Math', body)(sandbox.Math);
  return Array.from({ length: n }, () => sandbox.Math.random());
}

test('a seeded page draws the same numbers on every load', () => {
  const a = runSeeded(12345);
  expect(runSeeded(12345)).toEqual(a);
  expect(runSeeded(999)).not.toEqual(a);
  a.forEach((x) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); });
});

test('the seed is injected only when asked, before the page and SDK scripts', () => {
  const html = '<html><head><script>window.x=Math.random()</script></head><body></body></html>';
  expect(prepareSiteDocument(html)).not.toMatch(/Math\.random=function/);
  const doc = prepareSiteDocument(html, { randomSeed: 7 });
  expect(doc.indexOf('Math.random=function')).toBeGreaterThan(-1);
  expect(doc.indexOf('Math.random=function')).toBeLessThan(doc.indexOf('window.x=Math.random()'));
});
