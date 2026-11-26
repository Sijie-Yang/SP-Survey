import { strToU8, zipSync } from 'fflate';
import { buildExampleSite, readSpSchemeUpload } from './spScheme';
import { extractEmbeddedScheme } from './spSite';
import {
  bundleSpSchemeFiles,
  finalizeSpSchemeImport,
  mediaPlanFolders,
  prepareSpSchemeUpload,
  revalidateSpSchemeUpload,
  spSchemeMediaPlan,
  spSchemeProblemsText,
  summarizeSpSchemeImport,
} from './spSchemeImport';
import { LEGACY_SURVEY_HTML } from './__fixtures__/legacySurvey';

const prepareBytes = (bytes, options) => prepareSpSchemeUpload(readSpSchemeUpload(bytes), options);

// Nothing a JSON round trip would change or drop (no Map, Set, typed array, undefined or function).
function expectJsonSafe(value, path = 'summary') {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => expectJsonSafe(item, `${path}[${i}]`));
    return;
  }
  expect([path, Object.getPrototypeOf(value)]).toEqual([path, Object.prototype]);
  Object.entries(value).forEach(([key, item]) => {
    expect([`${path}.${key}`, typeof item]).not.toEqual([`${path}.${key}`, 'undefined']);
    expectJsonSafe(item, `${path}.${key}`);
  });
}

describe('a page that follows SP-Scheme', () => {
  test('is imported as declared, with its questions analysed', () => {
    const prepared = prepareBytes(strToU8(buildExampleSite()), { name: 'index.html' });
    expect(prepared.upload.asIs).toBeUndefined();
    expect(prepared.report.ok).toBe(true);
    expect(prepared.hosts).toEqual([]);
    const summary = summarizeSpSchemeImport(prepared);
    expect(summary).toMatchObject({
      ok: true,
      asIs: false,
      declaredButBroken: false,
      title: 'Street perception study',
      matchLevel: 'full',
      questionCount: 3,
      nativeCount: 3,
      customCount: 0,
      errors: [],
      problems: [],
      media: { files: 0, folders: [] },
    });

    const next = finalizeSpSchemeImport(prepared.report, prepared.upload, { theme: { primaryColor: '#111111' }, pages: [{ name: 'old' }] });
    expect(next.theme.primaryColor).toBe('#111111');
    expect(next.pages.map((p) => p.name)).not.toContain('old');
    expect(next.spSite.html).toContain('SPSite.onReady');
    expect(next.spSite.html).not.toContain('sp-site-preview');
    expect(next.spSite.convertedFrom).toBeUndefined();
    expect(next.spSite.mediaFolders).toBeUndefined();
  });

  test('refuses to finalize a report that is not ok', () => {
    const prepared = prepareSpSchemeUpload(readSpSchemeUpload(strToU8('{"format":"sp-scheme-package","survey":{}}')));
    expect(prepared.report.ok).toBe(false);
    expect(() => finalizeSpSchemeImport(prepared.report, prepared.upload, {})).toThrow(/Fix the package errors/);
  });
});

describe('a page that does not follow SP-Scheme', () => {
  test('is imported as it is, with script hosts allowed and request hosts listed', () => {
    const prepared = prepareBytes(strToU8(LEGACY_SURVEY_HTML), { name: 'survey.html' });
    expect(prepared.upload.asIs).toEqual({ declared: false, errors: expect.any(Array), problems: [] });
    expect(prepared.upload.originalHtml).toBe(LEGACY_SURVEY_HTML);
    expect(extractEmbeddedScheme(prepared.upload.siteHtml).survey.pages).toEqual([]);
    const byHost = Object.fromEntries(prepared.hosts.map((h) => [h.host, h]));
    expect(byHost['cdn.legacy-lab.org']).toEqual({ host: 'cdn.legacy-lab.org', kinds: ['script'], needed: true });
    expect(byHost['api.legacy-lab.org']).toEqual({ host: 'api.legacy-lab.org', kinds: ['request'], needed: false });
    expect(prepared.allowed).toEqual(['cdn.legacy-lab.org']);
    expect(prepared.report.ok).toBe(true);

    const summary = summarizeSpSchemeImport(prepared);
    expect(summary).toMatchObject({ ok: true, asIs: true, declaredButBroken: false, matchLevel: 'none', questionCount: 0 });
    expect(summary.hosts.find((h) => h.host === 'cdn.legacy-lab.org')).toEqual({ host: 'cdn.legacy-lab.org', kinds: ['script'], needed: true, allowed: true, source: false });
    expect(summary.hosts.find((h) => h.host === 'api.legacy-lab.org').allowed).toBe(false);

    const next = finalizeSpSchemeImport(prepared.report, prepared.upload, { pages: [] });
    expect(next.pages).toEqual([]);
    expect(next.spSite.convertedFrom).toBe('survey.html');
    expect(next.spSite.allowedHosts).toEqual(['cdn.legacy-lab.org']);
    expect(next.spSite.html).toContain('How safe does this street feel?');
  });

  test('unticking the script host re-checks the page and keeps the choice', () => {
    const prepared = prepareBytes(strToU8(LEGACY_SURVEY_HTML), { name: 'survey.html' });
    const report = revalidateSpSchemeUpload(prepared.upload, []);
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.message).join(' ')).toMatch(/will be blocked, which may break the page/);
    expect(summarizeSpSchemeImport({ ...prepared, report, allowed: [] }).hosts.every((h) => !h.allowed)).toBe(true);
    expect(finalizeSpSchemeImport(report, prepared.upload, {}).spSite.allowedHosts).toBeUndefined();
  });

  test('a broken SP-Scheme block is listed as problems to hand back to the model', () => {
    const html = '<!doctype html><html><head><script type="application/json" id="sp-scheme">{"format":"sp-scheme","spScheme":"0.1","survey":{"pages":[{"elements":[{"type":"nosuchtype","name":"q1"}]}]}}</script></head><body>hi</body></html>';
    const prepared = prepareBytes(strToU8(html), { name: 'index.html' });
    const summary = summarizeSpSchemeImport(prepared);
    expect(summary).toMatchObject({ ok: true, asIs: true, declaredButBroken: true });
    expect(summary.problems.length).toBeGreaterThan(0);
    expect(summary.problems.map((p) => p.message).join(' ')).toMatch(/SP-Scheme 0\.1/);
    const text = spSchemeProblemsText(summary.problems);
    expect(text).toMatch(/^\n\n## Problems to fix in my index\.html\n- /);
    expect(spSchemeProblemsText([])).toBe('');
    expect(finalizeSpSchemeImport(prepared.report, prepared.upload, {}).pages).toEqual([]);
  });
});

describe('a zip with media folders', () => {
  test('an as-is page gets the zip\'s folders as its own, and the summary lists them', () => {
    const page = '<!doctype html><html><body><script>const PHOTO_URLS = []; localStorage.setItem("answers", "{}");</script></body></html>';
    const zip = zipSync({
      'study/index.html': strToU8(page),
      'study/images/a.jpg': new Uint8Array([1, 2, 3]),
      'study/images/b.jpg': new Uint8Array([4, 5, 6]),
      'study/cover.png': new Uint8Array([7]),
    });
    const prepared = prepareBytes(zip, { name: 'study.zip' });
    expect(prepared.upload.asIs).toBeTruthy();
    const plan = spSchemeMediaPlan(prepared.upload);
    expect(plan.files.map((f) => [f.path, f.folder])).toEqual([['cover.png', 'files'], ['images/a.jpg', 'images'], ['images/b.jpg', 'images']]);
    expect(mediaPlanFolders(plan)).toEqual([{ folder: 'files', full: 'files', count: 1 }, { folder: 'images', full: 'images', count: 2 }]);

    const summary = summarizeSpSchemeImport(prepared);
    expect(summary.media).toEqual({ files: 3, folders: [{ folder: 'files', full: 'files', count: 1 }, { folder: 'images', full: 'images', count: 2 }] });
    expect(summary.name).toBe('study.zip');

    const next = finalizeSpSchemeImport(prepared.report, prepared.upload, {});
    expect(next.spSite.mediaFolders).toEqual(['files', 'images']);
    expect(next.spSite.convertedFrom).toBe('study.zip');
  });

  test('a declared page that names no folder reads the zip\'s folders', () => {
    const zip = zipSync({
      'ex/index.html': strToU8(buildExampleSite()),
      'ex/images/a.jpg': new Uint8Array([1]),
      'ex/images/b.jpg': new Uint8Array([2]),
    });
    const prepared = prepareBytes(zip, { name: 'ex.zip' });
    expect(prepared.upload.asIs).toBeUndefined();
    expect(summarizeSpSchemeImport(prepared).media).toEqual({ files: 2, folders: [{ folder: 'images', full: 'images', count: 2 }] });
    const next = finalizeSpSchemeImport(prepared.report, prepared.upload, {});
    expect(next.spSite.mediaFolders).toEqual(['images']);
    expect(next.spSite.convertedFrom).toBeUndefined();
  });

  test('a declared page that names its own folders keeps them', () => {
    const page = '<!doctype html><html><head><script type="application/json" id="sp-scheme">{"format":"sp-scheme-package","spScheme":"2.0","survey":{"pages":[],"mediaFolders":["stimuli"]}}</script></head><body><script>SPSite.getMedia("stimuli");</script></body></html>';
    const zip = zipSync({ 'index.html': strToU8(page), 'images/a.jpg': new Uint8Array([1]) });
    const prepared = prepareBytes(zip, { name: 'own.zip' });
    expect(prepared.upload.asIs).toBeUndefined();
    expect(prepared.report.ok).toBe(true);
    expect(finalizeSpSchemeImport(prepared.report, prepared.upload, {}).spSite.mediaFolders).toEqual(['stimuli']);
  });

  test('several dropped files are read as one zip', () => {
    const bundled = bundleSpSchemeFiles([
      { name: 'index.html', bytes: strToU8(LEGACY_SURVEY_HTML) },
      { name: 'config.json', bytes: strToU8('{"tasks":[{"id":"safety"}]}') },
    ]);
    expect(bundled.name).toBe('index.html + 1');
    const prepared = prepareBytes(bundled.bytes, { name: bundled.name });
    const next = finalizeSpSchemeImport(prepared.report, prepared.upload, {});
    expect(next.spSite.html).toContain('id="sp-data"');
    expect(next.spSite.html).toContain('config.json');
    expect(next.spSite.convertedFrom).toBe('index.html + 1');

    const one = strToU8('<html></html>');
    expect(bundleSpSchemeFiles([{ name: 'a.html', bytes: one }])).toEqual({ name: 'a.html', bytes: one });
    expect(bundleSpSchemeFiles([])).toBeNull();
  });
});

describe('a page imported from its link', () => {
  test('keeps loading from its own site, listed first and allowed', () => {
    const html = '<!doctype html><html><head><base href="https://lab.github.io/rating/"></head><body><img src="img/1.jpg"><script>fetch("https://script.google.com/macros/s/x/exec",{method:"POST",body:"{}"});</script></body></html>';
    const read = { siteHtml: html, siteFile: 'index.html', pkg: extractEmbeddedScheme(html), dataFiles: [], mediaFiles: [], files: [], fromZip: false, sourceUrl: 'https://lab.github.io/rating/' };
    const prepared = prepareSpSchemeUpload(read, { name: 'https://lab.github.io/rating/', sourceHost: 'Lab.GitHub.io' });
    expect(prepared.upload.sourceHost).toBe('lab.github.io');
    expect(prepared.hosts[0]).toEqual({ host: 'lab.github.io', kinds: [], needed: true, source: true });
    expect(prepared.hosts.find((h) => h.host === 'script.google.com')).toMatchObject({ needed: false });
    expect(prepared.allowed).toEqual(['lab.github.io']);

    const summary = summarizeSpSchemeImport(prepared);
    expect(summary.hosts[0]).toEqual({ host: 'lab.github.io', kinds: [], needed: true, allowed: true, source: true });
    expect(summary.asIs).toBe(true);

    const next = finalizeSpSchemeImport(prepared.report, prepared.upload, {});
    expect(next.spSite.allowedHosts).toEqual(['lab.github.io']);
    expect(next.spSite.convertedFrom).toBe('https://lab.github.io/rating/');
  });
});

describe('summary', () => {
  test('is plain JSON in every case', () => {
    const zip = zipSync({ 'study/index.html': strToU8(LEGACY_SURVEY_HTML), 'study/images/a.jpg': new Uint8Array([1]) });
    const cases = [
      prepareBytes(zip, { name: 'study.zip' }),
      prepareBytes(strToU8(buildExampleSite()), { name: 'index.html' }),
      prepareSpSchemeUpload(readSpSchemeUpload(strToU8('{"survey":{}}'))),
    ];
    cases.forEach((prepared) => {
      const summary = summarizeSpSchemeImport(prepared);
      expectJsonSafe(summary);
      expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
    });
    expect(summarizeSpSchemeImport()).toMatchObject({ ok: false, asIs: false, matchLevel: 'none', errors: [], hosts: [] });
  });

  test('takes a plain title from a translated one', () => {
    const page = buildExampleSite().replace('"title": "Street perception study"', '"title": { "default": "Street study", "zh": "街道研究" }');
    expect(page).not.toBe(buildExampleSite());
    const prepared = prepareBytes(strToU8(page), { name: 'index.html' });
    expect(summarizeSpSchemeImport(prepared).title).toBe('Street study');
  });

  test('a package with no page lists its errors as problems', () => {
    const prepared = prepareSpSchemeUpload(readSpSchemeUpload(strToU8('{"format":"sp-scheme-package","spScheme":"2.0","survey":{}}')));
    const summary = summarizeSpSchemeImport(prepared);
    expect(summary).toMatchObject({ ok: false, asIs: false, hasSite: false, hosts: [] });
    expect(summary.problems).toEqual([{ path: 'survey.pages', message: 'survey.pages must be an array of pages.' }]);
  });
});
