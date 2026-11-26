import {
  HELPER_BASE, HELPER_HTTPS_BASE, HELPER_PACKAGE, detectOs, getJob, hasOwnView, helperCommands, helperHealth,
  mergeMediaEntries, runCommand, startJob, summarizeItems,
} from './localHelper';

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = await handler(url, init);
    return { ok: status < 400, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

describe('local helper client', () => {
  it('reports a blocked helper when both probes fail', async () => {
    const fetchImpl = fakeFetch(() => { throw new TypeError('Failed to fetch'); });
    await expect(helperHealth({ fetchImpl })).resolves.toEqual({ running: false, blocked: true });
    expect(fetchImpl.calls.map((c) => c.url)).toEqual([`${HELPER_HTTPS_BASE}/health`, `${HELPER_BASE}/health`]);
  });

  it('counts an https health check as connected and falls back to http', async () => {
    const https = fakeFetch(() => ({ body: { ok: true, version: '0.2.0', streetlevel: '0.12.11' } }));
    await expect(helperHealth({ fetchImpl: https })).resolves.toEqual({
      running: true, version: '0.2.0', streetlevel: '0.12.11', base: HELPER_HTTPS_BASE,
    });
    expect(https.calls.map((c) => c.url)).toEqual([`${HELPER_HTTPS_BASE}/health`]);
    expect(HELPER_HTTPS_BASE).toBe('https://127.0.0.1:47822');
    expect(HELPER_BASE).toBe('http://127.0.0.1:47821');

    const httpFallback = fakeFetch((url) => {
      if (String(url).startsWith('https://')) throw new TypeError('Failed to fetch');
      return { body: { ok: true, version: '0.1.0', streetlevel: '0.12.11' } };
    });
    await expect(helperHealth({ fetchImpl: httpFallback })).resolves.toEqual({
      running: true, version: '0.1.0', streetlevel: '0.12.11', base: HELPER_BASE,
    });
    expect(httpFallback.calls.map((c) => c.url)).toEqual([`${HELPER_HTTPS_BASE}/health`, `${HELPER_BASE}/health`]);
  });

  it('posts the point list, preset, media prefix and session token to the helper', async () => {
    const fetchImpl = fakeFetch(() => ({ body: { ok: true, jobId: 'slj_1', state: 'queued' } }));
    const res = await startJob({
      apiBase: 'https://sp-survey.org', projectId: 'p1', mediaPrefix: 'u/p1/', publicBase: 'https://pub',
      token: 'jwt', points: [{ id: 'a', lat: 1, lng: 2 }], options: { preset: 'road' },
    }, { fetchImpl });
    expect(res.jobId).toBe('slj_1');
    const { url, init } = fetchImpl.calls[0];
    expect(url).toBe(`${HELPER_BASE}/jobs`);
    const httpsFetch = fakeFetch(() => ({ body: { ok: true, jobId: 'slj_https', state: 'queued' } }));
    const httpsRes = await startJob({
      apiBase: 'https://sp-survey.org', projectId: 'p1', mediaPrefix: 'u/p1/', publicBase: 'https://pub',
      token: 'jwt', points: [{ id: 'a', lat: 1, lng: 2 }], options: { preset: 'road' },
    }, { fetchImpl: httpsFetch, base: HELPER_HTTPS_BASE });
    expect(httpsRes.jobId).toBe('slj_https');
    expect(httpsFetch.calls[0].url).toBe(`${HELPER_HTTPS_BASE}/jobs`);
    expect(JSON.parse(init.body)).toMatchObject({ mediaPrefix: 'u/p1/', token: 'jwt', options: { preset: 'road' }, points: [{ id: 'a' }] });
  });

  it('surfaces helper errors with status', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 404, body: { ok: false, error: 'job not found' } }));
    await expect(getJob('x', 3, { fetchImpl })).rejects.toMatchObject({ message: 'job not found', status: 404 });
    expect(fetchImpl.calls[0].url).toBe(`${HELPER_BASE}/jobs/x?since=3`);
  });

  it('detects the operating system', () => {
    expect(detectOs({ userAgentData: { platform: 'macOS' } })).toBe('mac');
    expect(detectOs({ platform: 'MacIntel' })).toBe('mac');
    expect(detectOs({ platform: 'Win32' })).toBe('windows');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('linux');
  });

  it('builds Python-only install and serve commands per OS (no pipx, no git)', () => {
    expect(HELPER_PACKAGE).toBe('https://github.com/Sijie-Yang/SP-Survey-Platform/archive/refs/heads/main.zip#subdirectory=tools/streetlevel-helper');
    const mac = helperCommands('mac', 'https://sp-survey.org');
    expect(mac.systemDeps).toBe('brew install gettext && brew install inih');
    expect(Object.keys(mac)[0]).toBe('systemDeps');
    expect(mac.install).toBe(`python3 -m venv ~/.sp-streetlevel && ~/.sp-streetlevel/bin/python -m pip install --upgrade "${HELPER_PACKAGE}"`);
    expect(mac.serve).toBe('~/.sp-streetlevel/bin/python -m sp_streetlevel serve');
    expect(mac.installedServe).toBe('python3 -m sp_streetlevel serve');
    expect(mac.isolatedInstall).toBeUndefined();
    expect(mac.install).not.toMatch(/--user|\.local\/bin/);
    const win = helperCommands('windows', 'https://sp-survey.org');
    expect(helperCommands('linux', 'https://sp-survey.org').systemDeps).toBeUndefined();
    expect(helperCommands('linux', 'https://www.sp-survey.org').serve).toBe('python3 -m sp_streetlevel serve');
    expect(win).toEqual({ install: `py -m pip install --user --upgrade "${HELPER_PACKAGE}"`, serve: 'py -m sp_streetlevel serve' });
    expect(helperCommands('linux', 'https://staging.example.org').serve).toBe('python3 -m sp_streetlevel serve --allow-origin https://staging.example.org');
    Object.values({ ...mac, ...win }).forEach((cmd) => {
      expect(cmd).not.toMatch(/pipx|git\+/);
    });
  });

  it('builds the one-command fallback with batch view settings', () => {
    expect(runCommand({ projectId: 'proj_1', apiBase: 'https://sp-survey.org', capture: { preset: 'headings', headingCount: 6 } }))
      .toBe('~/.sp-streetlevel/bin/python -m sp_streetlevel run --project proj_1 --preset headings --heading-count 6 --pitch 0 --fov 90 --zoom 3 --folder street-level --folder-mode category');
    expect(runCommand({ projectId: 'proj_1', os: 'linux', apiBase: 'https://sp-survey.org', capture: { preset: 'headings', headingCount: 6 } }))
      .toBe('python3 -m sp_streetlevel run --project proj_1 --preset headings --heading-count 6 --pitch 0 --fov 90 --zoom 3 --folder street-level --folder-mode category');
    expect(runCommand({ projectId: 'p', os: 'windows', capture: { source: 'mapillary', headingMode: 'fixed', fixedHeading: 45 } }))
      .toBe('py -m sp_streetlevel run --project p --source mapillary --preset current --heading-mode fixed --fixed-heading 45 --pitch 0 --fov 90 --folder street-level --folder-mode category');
    expect(runCommand({ projectId: 'p', apiBase: 'http://localhost:3001' })).toContain('--api http://localhost:3001');
  });

  it('treats only pasted / overridden points as having their own view', () => {
    expect(hasOwnView({ heading: null, pitch: null, fov: null })).toBe(false);
    expect(hasOwnView({ heading: 120, pitch: null, fov: null })).toBe(true);
    expect(hasOwnView({ fov: 60 })).toBe(true);
  });

  it('summarizes per-point status and merges uploads by key', () => {
    const points = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const items = { a: { status: 'done', keys: ['k1', 'k2'] }, b: { status: 'no-image' }, c: { status: 'failed' }, d: { status: 'done', keys: ['k2'] } };
    expect(summarizeItems(points, items)).toEqual({ total: 4, done: 2, noImage: 1, failed: 1, pending: 0, running: 0, files: 2 });
    expect(mergeMediaEntries([{ key: 'k1', name: 'old' }], [{ key: 'k1', name: 'new' }, { key: 'k2' }]))
      .toEqual([{ key: 'k1', name: 'new' }, { key: 'k2' }]);
  });
});
