import { strToU8, zipSync } from 'fflate';
import {
  SP_SCHEME_EXAMPLE_PACKAGE,
  SP_SITE_PREVIEW_SHIM,
  applySpSchemePackage,
  buildExampleSite,
  buildExampleZip,
  buildSpSchemeText,
  parseSpSchemePackage,
  readSpSchemeUpload,
  validateSpSchemePackage,
} from './spScheme';

const messages = (list) => list.map((item) => item.message).join('\n');
const check = (read) => validateSpSchemePackage(read.pkg, { siteHtml: read.siteHtml });

describe('SP-Scheme text', () => {
  test('asks for one page, tried by the researcher, handed over unchanged', () => {
    const text = buildSpSchemeText();
    expect(text).toContain('ONE web page, `index.html`');
    expect(text.indexOf('let the researcher try it')).toBeLessThan(text.indexOf('Hand over the same page'));
    expect(text).toContain(SP_SITE_PREVIEW_SHIM);
    expect(text).toContain('SPSite.answer');
    expect(text).toContain('SPSite.complete()');
    expect(text).not.toMatch(/customInteractions|SPSkill|skill_save/);
  });

  test('says where the page goes: Studio for the researcher, sp_scheme_import for an agent', () => {
    const text = buildSpSchemeText();
    expect(text).toContain('SP-Survey Studio');
    expect(text).toContain('新建研究');
    expect(text).toContain('`sp_scheme_import`');
    expect(text).not.toContain('Survey Builder → SP-Scheme → Upload');
  });

  test('carries sampling rules and native answer shapes', () => {
    const text = buildSpSchemeText();
    expect(text).toContain('huggingface_random');
    expect(text).toContain('`imageslidergroup`');
    expect(text).toContain('`sliders`: an object { <dimension id>: number }');
    expect(text).not.toMatch(/expectedDraftUpdatedAt/);
  });
});

describe('parseSpSchemePackage', () => {
  test('accepts a model reply wrapped in a json fence', () => {
    const reply = `Here is your study:\n\`\`\`json\n${JSON.stringify(SP_SCHEME_EXAMPLE_PACKAGE)}\n\`\`\`\nGood luck!`;
    expect(parseSpSchemePackage(reply).format).toBe('sp-scheme-package');
  });

  test('rejects non-JSON', () => {
    expect(() => parseSpSchemePackage('not json')).toThrow('not valid JSON');
  });
});

describe('readSpSchemeUpload', () => {
  test('reads a bare index.html and its embedded survey', () => {
    const read = readSpSchemeUpload(strToU8(buildExampleSite()));
    expect(read.siteHtml).toContain('SPSite.onReady');
    expect(read.pkg.survey.pages).toHaveLength(3);
    expect(read.manifestSource).toBe('embedded');
  });

  test('reads a zip nested in a folder and inlines local assets', () => {
    const page = buildExampleSite().replace('</head>', '<link rel="stylesheet" href="css/site.css"><script src="./app.js"></script></head>');
    const zip = zipSync({
      'study/index.html': strToU8(page),
      'study/css/site.css': strToU8('body{color:red}'),
      'study/app.js': strToU8('window.x=1'),
      '__MACOSX/._index.html': strToU8('junk'),
    });
    const read = readSpSchemeUpload(zip);
    expect(read.fromZip).toBe(true);
    expect(read.siteFile).toBe('index.html');
    expect(read.siteHtml).toContain('<style>body{color:red}</style>');
    expect(read.siteHtml).toContain('<script>window.x=1</script>');
    expect(check(read).ok).toBe(true);
  });

  test('a bare sp-scheme.json imports with the standard look and says so', () => {
    const read = readSpSchemeUpload(strToU8(JSON.stringify(SP_SCHEME_EXAMPLE_PACKAGE)));
    const report = check(read);
    expect(report.ok).toBe(true);
    expect(report.site).toBeNull();
    expect(messages(report.warnings)).toContain('No index.html');
  });

  test('rejects a zip with neither page nor manifest', () => {
    expect(() => readSpSchemeUpload(zipSync({ 'a.txt': strToU8('x') }))).toThrow('neither index.html nor sp-scheme.json');
  });

  test('callers with less memory can lower the zip limits', () => {
    const zip = zipSync({ 'index.html': strToU8(`<html><body>${'x'.repeat(4000)}</body></html>`) }, { level: 9 });
    expect(readSpSchemeUpload(zip).siteHtml).toContain('xxxx');
    expect(() => readSpSchemeUpload(zip, { maxZipBytes: 10 })).toThrow('The zip is larger than 1 KB.');
    expect(() => readSpSchemeUpload(zip, { maxUnzippedBytes: 2048 })).toThrow('The zip expands to more than 2 KB.');
    expect(() => readSpSchemeUpload(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]))).toThrow('The zip could not be opened.');
  });
});

describe('validateSpSchemePackage', () => {
  test('the example page passes and keeps the page without the preview shim', () => {
    const report = check(readSpSchemeUpload(buildExampleZip()));
    expect(messages(report.errors)).toBe('');
    expect(report.summary).toMatchObject({ pageCount: 3, questionCount: 3, hasSite: true });
    expect(report.site.html).toContain('SPSite.complete');
    expect(report.site.html).not.toContain('sp-site-preview');
    expect(report.site.id).toMatch(/^site-[0-9a-f]{16}$/);
  });

  test('a page without the embedded survey is rejected', () => {
    const report = validateSpSchemePackage(null, { siteHtml: '<html><body>hi</body></html>' });
    expect(messages(report.errors)).toContain('id="sp-scheme"');
  });

  test('old packages with custom interactions are told to rebuild', () => {
    const pkg = { ...SP_SCHEME_EXAMPLE_PACKAGE, spScheme: '1.0', customInteractions: [{ ref: 'x' }] };
    const text = messages(validateSpSchemePackage(pkg).errors);
    expect(text).toContain('SP-Scheme 1.0');
    expect(text).toContain('no longer uses per-question custom interactions');
  });

  test('a page cannot declare skill questions', () => {
    const pkg = JSON.parse(JSON.stringify(SP_SCHEME_EXAMPLE_PACKAGE));
    pkg.survey.pages[1].elements[0] = { type: 'skillquestion', name: 'safety_duel', skillId: 'preset_image_preference_forced', imageCount: 2 };
    const report = validateSpSchemePackage(pkg, { siteHtml: buildExampleSite() });
    expect(messages(report.errors)).toContain('declare this question with a native type');
  });

  test('rejects invented media URLs on randomly sampled questions', () => {
    const pkg = JSON.parse(JSON.stringify(SP_SCHEME_EXAMPLE_PACKAGE));
    pkg.survey.pages[1].elements[0].choices = [{ value: 'https://example.com/a.jpg' }];
    expect(messages(validateSpSchemePackage(pkg, { siteHtml: buildExampleSite() }).errors)).toContain('media URLs are not allowed');
  });

  test('rejects duplicate question names and credentials', () => {
    const pkg = JSON.parse(JSON.stringify(SP_SCHEME_EXAMPLE_PACKAGE));
    pkg.survey.pages[2].elements[0].name = 'safety_duel';
    pkg.survey.falApiKey = 'secret';
    const text = messages(validateSpSchemePackage(pkg).errors);
    expect(text).toContain('Duplicate question name');
    expect(text).toContain('credential');
  });

  test('a page that never records answers is rejected', () => {
    const html = buildExampleSite().replace(/SPSite\.answer\(/g, 'record(');
    const report = validateSpSchemePackage(SP_SCHEME_EXAMPLE_PACKAGE, { siteHtml: html });
    expect(messages(report.errors)).toContain('never calls SPSite.answer');
  });
});

describe('applySpSchemePackage', () => {
  test('stores the page on the config and keeps project settings', () => {
    const report = check(readSpSchemeUpload(buildExampleZip()));
    const config = applySpSchemePackage(report, { baseConfig: { theme: { primaryColor: '#123456' }, logo: 'x' } });
    expect(config.spSite).toMatchObject({ id: report.site.id, version: '1.0' });
    expect(config.spSite.html).toBe(report.site.html);
    expect(config.theme.primaryColor).toBe('#123456');
    expect(config.logo).toBe('x');
    expect(config.title).toBe('Street perception study');
    expect(config.pages[0].elements[0].type).toBe('boolean');
  });

  test('importing without a page removes an earlier one', () => {
    const report = check(readSpSchemeUpload(strToU8(JSON.stringify(SP_SCHEME_EXAMPLE_PACKAGE))));
    const config = applySpSchemePackage(report, { baseConfig: { spSite: { html: '<html></html>' } } });
    expect(config.spSite).toBeUndefined();
  });

  test('refuses an invalid report', () => {
    expect(() => applySpSchemePackage({ ok: false })).toThrow('Fix the package');
  });
});

test('an imagepicker that shows one image is rejected with the rating type to use', () => {
  const report = validateSpSchemePackage({ format: 'sp-scheme', spScheme: '2.0', survey: { pages: [{ name: 'p', elements: [
    { type: 'imagepicker', name: 'state', imageCount: 1 },
  ] }] } });
  expect(report.errors.map((e) => e.message).join(' ')).toMatch(/imagerating with imageCount 1/);
});

test('a page with no questions is accepted as a raw record and keeps its folders', () => {
  const pkg = { format: 'sp-scheme', spScheme: '2.0', survey: { pages: [], mediaFolders: ['sp/a', '../bad'], completeOn: 'finish$' } };
  const report = validateSpSchemePackage(pkg, { siteHtml: '<html><body><script>fetch("/api/save")</script></body></html>' });
  expect(report.ok).toBe(true);
  expect(report.summary.match).toBe('none');
  expect(report.warnings.map((w) => w.message).join(' ')).toMatch(/records the requests/);
  const config = applySpSchemePackage(report, {});
  expect(config.spSite.mediaFolders).toEqual(['sp/a']);
  expect(config.spSite.completeOn).toBe('finish$');
  expect(config.mediaFolders).toBeUndefined();
});

test('custom questions count as recorded, not analysed', () => {
  const pkg = { format: 'sp-scheme', spScheme: '2.0', survey: { pages: [{ name: 'p', elements: [
    { type: 'imagerating', name: 'a', imageCount: 1 }, { type: 'custom', name: 'b' },
  ] }] } };
  const html = '<html><body><script>SPSite.onReady(function(){}); SPSite.answer("a", 1); SPSite.complete();</script></body></html>';
  const report = validateSpSchemePackage(pkg, { siteHtml: html });
  expect(report.ok).toBe(true);
  expect(report.summary).toMatchObject({ match: 'partial', nativeCount: 1, customCount: 1 });
});
