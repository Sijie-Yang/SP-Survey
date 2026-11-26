import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandShortMapsUrl,
  expandShortMapsUrls,
  handleStreetLevelRoutes,
  isShortMapsUrl,
  mergeRegistration,
} from './streetLevel.mjs';

const FINAL = 'https://www.google.com/maps/@48.85,2.29,3a,75y,90h,95t/data=!3m6!1e1!3m4!1sPANO!2e0';

function redirectingFetch(map, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const next = map[url];
    if (next === undefined) return new Response('not found', { status: 404 });
    if (typeof next === 'number') return new Response('', { status: next });
    return new Response(null, { status: 302, headers: { Location: next } });
  };
}

test('expands a maps.app.goo.gl link without requesting the Google Maps page', async () => {
  const calls = [];
  const fetchImpl = redirectingFetch({ 'https://maps.app.goo.gl/abc': FINAL }, calls);
  const r = await expandShortMapsUrl('https://maps.app.goo.gl/abc', { fetchImpl });
  assert.deepEqual(r, { ok: true, input: 'https://maps.app.goo.gl/abc', url: FINAL });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'manual');
});

test('follows multiple short-link hops, relative Locations and consent continue URLs', async () => {
  const fetchImpl = redirectingFetch({
    'https://goo.gl/maps/xyz': '/maps/hop2',
    'https://goo.gl/maps/hop2': 'https://maps.app.goo.gl/final',
    'https://maps.app.goo.gl/final': `https://consent.google.com/ml?continue=${encodeURIComponent(FINAL)}`,
  });
  const r = await expandShortMapsUrl('http://goo.gl/maps/xyz', { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.url, FINAL);
});

test('rejects non-short links, off-allowlist redirects, loops and non-redirects', async () => {
  assert.equal((await expandShortMapsUrl('https://example.com/a')).ok, false);
  const evil = await expandShortMapsUrl('https://maps.app.goo.gl/e', {
    fetchImpl: redirectingFetch({ 'https://maps.app.goo.gl/e': 'https://evil.example/x' }),
  });
  assert.match(evil.error, /unexpected host/);
  const loop = await expandShortMapsUrl('https://maps.app.goo.gl/l', {
    fetchImpl: redirectingFetch({ 'https://maps.app.goo.gl/l': 'https://maps.app.goo.gl/l' }),
  });
  assert.match(loop.error, /Too many redirects/);
  const dead = await expandShortMapsUrl('https://maps.app.goo.gl/d', {
    fetchImpl: redirectingFetch({ 'https://maps.app.goo.gl/d': 200 }),
  });
  assert.match(dead.error, /did not redirect/);
  const thrown = await expandShortMapsUrl('https://maps.app.goo.gl/t', { fetchImpl: async () => { throw new Error('offline'); } });
  assert.match(thrown.error, /offline/);
});

test('batch expansion keeps order and caps input', async () => {
  const fetchImpl = redirectingFetch({ 'https://maps.app.goo.gl/1': FINAL });
  const results = await expandShortMapsUrls(['https://maps.app.goo.gl/1', 'https://example.com'], { fetchImpl });
  assert.deepEqual(results.map((r) => r.ok), [true, false]);
});

test('host checks', () => {
  assert.equal(isShortMapsUrl('https://goo.gl/other'), false);
  assert.equal(isShortMapsUrl('https://maps.app.goo.gl/x'), true);
});

test('route handler: auth and expand', async () => {
  const deny = await handleStreetLevelRoutes(
    new Request('https://x/api/street-level/expand', { method: 'POST', body: '{}' }),
    {},
    { authorize: async () => null },
  );
  assert.equal(deny.status, 401);
  const fetchImpl = async (url) => {
    if (url === 'https://maps.app.goo.gl/abc') return new Response(null, { status: 301, headers: { Location: FINAL } });
    throw new Error(`unexpected fetch ${url}`);
  };
  const expand = await handleStreetLevelRoutes(
    new Request('https://x/api/street-level/expand', { method: 'POST', body: JSON.stringify({ urls: ['https://maps.app.goo.gl/abc'] }) }),
    {},
    { authorize: async () => ({ userId: 'u' }), fetchImpl },
  );
  assert.equal((await expand.json()).results[0].url, FINAL);
  assert.equal(await handleStreetLevelRoutes(new Request('https://x/api/other'), {}), null);
});

test('there is no imagery proxy or panorama route on the Worker', async () => {
  for (const path of ['/api/street-level/mapillary-image?url=x', '/api/street-level/panorama?pano=x', '/api/street-level/tile']) {
    const res = await handleStreetLevelRoutes(new Request(`https://x${path}`), {}, { authorize: async () => ({ userId: 'u' }) });
    assert.equal(res.status, 404, path);
  }
});

function fakeSupabase(row) {
  const calls = [];
  const fn = async (_env, opts) => {
    calls.push(opts);
    if (opts.method === 'PATCH') return [];
    return opts.query.includes(`user_id=eq.${row.user_id}`) && opts.query.includes(`id=eq.${row.id}`) ? [row] : [];
  };
  return { fn, calls };
}

const ROW = {
  id: 'proj1',
  user_id: 'u1',
  preloaded_images: [{ key: 'u1/proj1/old.jpg', name: 'old.jpg', url: 'https://pub/u1/proj1/old.jpg' }],
  image_dataset_config: {
    mediaFolders: ['a'],
    mediaFolderTags: { a: 'set' },
    streetLevel: { points: [{ id: 'p1', lat: 1, lng: 2 }], capture: { preset: 'road' } },
  },
};

test('project route returns the point list and owner-scoped media prefix', async () => {
  const sb = fakeSupabase(ROW);
  const res = await handleStreetLevelRoutes(
    new Request('https://x/api/street-level/projects/proj1'),
    { R2_PUBLIC_URL: 'https://pub/' },
    { authorize: async () => ({ userId: 'u1' }), supabaseRest: sb.fn },
  );
  const body = await res.json();
  assert.deepEqual(body, {
    success: true, projectId: 'proj1', mediaPrefix: 'u1/proj1/', publicBase: 'https://pub',
    points: [{ id: 'p1', lat: 1, lng: 2 }], capture: { preset: 'road' },
  });
  assert.equal(sb.calls[0].serviceRole, true);

  const other = await handleStreetLevelRoutes(
    new Request('https://x/api/street-level/projects/proj1'),
    {},
    { authorize: async () => ({ userId: 'someone-else' }), supabaseRest: sb.fn },
  );
  assert.equal(other.status, 404);

  const open = await handleStreetLevelRoutes(
    new Request('https://x/api/street-level/projects/proj1'),
    {},
    { authorize: async () => ({ userId: null, kind: 'open' }), supabaseRest: sb.fn },
  );
  assert.equal(open.status, 501);
});

test('register merges uploads by key, keeps only owned image keys, and unions folders/tags', async () => {
  const merged = mergeRegistration(ROW, {
    entries: [
      { key: 'u1/proj1/street-level/gsv-P-h000-p00-f090.jpg', url: 'https://evil/x', attribution: { text: '© Google' }, streetLevel: { panoId: 'P' } },
      { key: 'u2/proj1/street-level/x.jpg' },
      { key: 'u1/proj1/features/street_level_v1.csv' },
      { key: 'u1/proj1/old.jpg', name: 'old.jpg' },
    ],
    folders: ['street-level'],
    tags: { 'street-level': 'category', bad: 'nope' },
  }, { prefix: 'u1/proj1/', publicBase: 'https://pub' });
  assert.equal(merged.registered, 2);
  assert.equal(merged.preloadedImages.length, 2);
  const added = merged.preloadedImages.find((p) => p.key.includes('gsv-'));
  assert.equal(added.url, 'https://pub/u1/proj1/street-level/gsv-P-h000-p00-f090.jpg');
  assert.equal(added.folder, 'street-level');
  assert.deepEqual(merged.imageDatasetConfig.mediaFolders, ['a', 'street-level']);
  assert.deepEqual(merged.imageDatasetConfig.mediaFolderTags, { a: 'set', 'street-level': 'category' });
  assert.deepEqual(merged.imageDatasetConfig.streetLevel, ROW.image_dataset_config.streetLevel);

  const sb = fakeSupabase(ROW);
  const res = await handleStreetLevelRoutes(
    new Request('https://x/api/street-level/projects/proj1/register', { method: 'POST', body: JSON.stringify({ entries: [{ key: 'u1/proj1/s/a.jpg' }] }) }),
    { R2_PUBLIC_URL: 'https://pub' },
    { authorize: async () => ({ userId: 'u1' }), supabaseRest: sb.fn },
  );
  assert.equal((await res.json()).registered, 1);
  const patch = sb.calls.find((c) => c.method === 'PATCH');
  assert.match(patch.query, /user_id=eq\.u1/);
  assert.equal(patch.body.preloaded_images.length, 2);
});
