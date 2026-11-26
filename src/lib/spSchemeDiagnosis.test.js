import {
  buildDiagnosisFiles, diagnoseSpSchemeProject, embeddedDataFiles, pageMediaCalls, spSchemeKind, summarizeResponses,
} from './spSchemeDiagnosis';

const ratingPages = [{ name: 'p1', elements: [{ type: 'rating', name: 'safety', rateMin: 1, rateMax: 5 }] }];
const schemePage = (body) => `<!doctype html><html><head></head><body><script>${body}</script></body></html>`;
const media = (folder, n) => Array.from({ length: n }, (_, i) => ({ url: `https://media.example/${folder}/img${i}.jpg`, name: `img${i}.jpg`, folder }));

const sitePage = schemePage("SPSite.onReady(function(){ var imgs = SPSite.getMedia('streets'); SPSite.answer('safety', 3, { shown: imgs[0] }); SPSite.complete(); });");

function project(over = {}) {
  return {
    id: 'proj_x',
    name: 'Test',
    config: { pages: ratingPages, spScheme: { version: '1' }, spSite: { html: sitePage, mediaFolders: ['streets'] } },
    preloadedImages: media('streets', 4),
    ...over,
  };
}

describe('spSchemeKind', () => {
  it('tells a declared page, an as-is page, a question package and a normal survey apart', () => {
    expect(spSchemeKind({ pages: ratingPages, spSite: { html: '<html></html>' } })).toBe('site');
    expect(spSchemeKind({ pages: ratingPages, spSite: { html: '<html></html>', convertedFrom: 'a.zip' } })).toBe('asIs');
    expect(spSchemeKind({ pages: [], spSite: { html: '<html></html>' } })).toBe('asIs');
    expect(spSchemeKind({ pages: ratingPages, spScheme: { version: '1' } })).toBe('package');
    expect(spSchemeKind({ pages: ratingPages })).toBeNull();
  });
});

describe('diagnoseSpSchemeProject', () => {
  it('passes a page that asks for a linked folder with images', () => {
    const d = diagnoseSpSchemeProject(project());
    expect(d.kind).toBe('site');
    expect(d.checks.filter((c) => c.level === 'error')).toEqual([]);
    expect(d.checks.some((c) => /streets.*4 张/.test(c.title))).toBe(true);
  });

  it('says an empty library falls back to the preview library', () => {
    const d = diagnoseSpSchemeProject(project({ preloadedImages: [] }));
    expect(d.checks.some((c) => c.level === 'error')).toBe(false);
    expect(d.checks.some((c) => /预览图库/.test(c.title))).toBe(true);
  });

  it('flags a getMedia folder that holds no images', () => {
    const d = diagnoseSpSchemeProject(project({ preloadedImages: media('other', 3) }));
    expect(d.checks.find((c) => /streets/.test(c.title)).level).toBe('error');
  });

  it('judges what participants are served: the published version when release-managed', () => {
    const published = { pages: ratingPages, spSite: { html: sitePage, mediaFolders: ['streets'] } };
    const d = diagnoseSpSchemeProject(project({
      releaseManaged: true,
      publishedVersion: 3,
      publishedConfig: published,
      publishedMedia: { preloadedImages: [] },
      config: { ...published, spSite: { ...published.spSite, mediaFolders: ['streets', 'more'] } },
    }));
    expect(d.served.published).toBe(true);
    expect(d.draftDiffers).toBe(true);
    // The published media snapshot is empty, so the page gets nothing.
    expect(d.checks.find((c) => /streets/.test(c.title)).level).toBe('error');
  });

  it('explains an empty image list (filled per participant) vs a hard-coded one', () => {
    const asIs = (body) => project({ config: { pages: [], spSite: { html: schemePage(body), convertedFrom: 'x.zip', mediaFolders: ['streets'] } } });
    const empty = diagnoseSpSchemeProject(asIs('const PHOTO_URLS = []; show(PHOTO_URLS);'));
    expect(empty.kind).toBe('asIs');
    expect(empty.checks.find((c) => /PHOTO_URLS/.test(c.title)).level).toBe('ok');
    const fixed = diagnoseSpSchemeProject(asIs("const photos = ['a.jpg', 'b.jpg']; show(photos);"));
    expect(fixed.checks.find((c) => /photos/.test(c.title)).level).toBe('warn');
    const none = diagnoseSpSchemeProject(asIs("var pics = [{src:'https://x.org/a.jpg'}];"));
    expect(none.checks.find((c) => /没有向平台要图片/.test(c.title)).detail).toMatch(/1 个外部图片网址/);
  });

  it('counts questions whose images the platform draws', () => {
    const pages = [{ name: 'p', elements: [{ type: 'imagepicker', name: 'safe_pair', imageCount: 2, trialCount: 5, randomImageSelection: true }] }];
    const html = schemePage("SPSite.onReady(function(){ var q = SPSite.getQuestions(); SPSite.answer('safe_pair', 'a', { trial: 0 }); SPSite.complete(); });");
    const d = diagnoseSpSchemeProject(project({ preloadedImages: [], config: { pages, spSite: { html } } }));
    const check = d.checks.find((c) => /按题抽取/.test(c.title));
    expect(check.level).toBe('ok');
    expect(check.detail).toMatch(/safe_pair（每次 2 张，做 5 次）.*预览图库/);
    expect(d.checks.some((c) => /没有向平台要图片/.test(c.title))).toBe(false);
  });

  it('reports a declared page that never submits', () => {
    const d = diagnoseSpSchemeProject(project({ config: { pages: ratingPages, spSite: { html: schemePage("SPSite.onReady(function(){ SPSite.getMedia('streets'); SPSite.answer('safety', 1); });"), mediaFolders: ['streets'] } } }));
    expect(d.checks.some((c) => c.level === 'error' && /SPSite\.complete/.test(c.detail))).toBe(true);
  });

  it('marks a page that is only in the draft', () => {
    const d = diagnoseSpSchemeProject(project({ releaseManaged: true, publishedConfig: { pages: ratingPages } }));
    expect(d.kind).toBeNull();
    expect(d.checks[0].level).toBe('error');
  });
});

describe('helpers', () => {
  it('reads getMedia folders', () => {
    expect(pageMediaCalls("SPSite.getMedia('a/'); SPSite.getMedia(\"b\"); SPSite.getMedia(name)")).toEqual({ folders: ['a', 'b'], dynamic: true });
  });

  it('reads embedded data files', () => {
    expect(embeddedDataFiles('<script type="application/json" id="sp-data">{"cfg.json":"{}"}</script>')).toEqual({ 'cfg.json': '{}' });
  });

  it('summarises what responses hold', () => {
    const [s] = summarizeResponses([{
      id: 'r1',
      created_at: '2026-10-27T00:00:00Z',
      responses: {
        safety: { trials: [{ value: 3, shown_images: ['a'] }, { value: 2, shown_images: [] }] },
        __sp_requests: [{}, {}],
        __sp_page_state: { 'sp-media:PHOTO_URLS': [], progress: { done: true } },
      },
    }]);
    expect(s).toMatchObject({ questions: ['safety'], requests: 2, mediaLists: ['sp-media:PHOTO_URLS'], trialsWithImages: 1 });
  });
});

describe('buildDiagnosisFiles', () => {
  it('rebuilds the upload: page, data files, given media, settings and README', async () => {
    const html = sitePage.replace('<head>', '<head><script type="application/json" id="sp-data">{"data/design.csv":"a,b"}</script>');
    const p = project({ config: { pages: ratingPages, spSite: { html, mediaFolders: ['streets'] } }, preloadedImages: [...media('streets', 2), ...media('unused', 1)] });
    const fetched = [];
    const { files, mediaReport } = await buildDiagnosisFiles(p, {
      responseCount: 7,
      responses: [{ id: 'r1', responses: { safety: 3 } }],
      fetchBytes: async (url) => { fetched.push(url); if (url.endsWith('img1.jpg')) throw new Error('404'); return new Uint8Array([1, 2]); },
    });
    const paths = files.map((f) => f.path);
    expect(paths[0]).toBe('README.md');
    expect(paths).toEqual(expect.arrayContaining(['index.html', 'data/design.csv', 'config.json', 'media.csv', 'media/streets/img0.jpg', 'responses-sample.json']));
    expect(paths).not.toContain('media/unused/img0.jpg');
    expect(mediaReport).toMatchObject({ saved: 1, failed: [{ path: 'media/streets/img1.jpg', error: '404' }] });
    expect(JSON.parse(files.find((f) => f.path === 'config.json').content).spSite.html).toBe('(见 index.html)');
    const readme = files[0].content;
    expect(readme).toMatch(/答卷数量：7/);
    expect(readme).toMatch(/下载失败 1 个/);
    expect(files.find((f) => f.path === 'media.csv').content).toMatch(/unused,img0\.jpg,.*,no/);
  });
});
