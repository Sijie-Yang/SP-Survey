/**
 * Street-level routes on the Worker. No imagery is fetched or processed here:
 * downloads run in the researcher's local `sp-streetlevel` helper, which then
 * uses the normal authenticated media upload (/api/r2/upload).
 *
 * POST /api/street-level/expand                  { urls } → resolve maps.app.goo.gl / goo.gl/maps
 *   short links by reading redirect Location headers only (the Maps page itself is never requested).
 * GET  /api/street-level/projects/:id            → point list + media prefix for the CLI fallback.
 * POST /api/street-level/projects/:id/register   { entries, folders, tags } → add uploaded files to the
 *   project media library (CLI fallback; the panel registers files itself).
 */

import { supabaseRest as defaultSupabaseRest } from './supabaseUserClient.mjs';

const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
const GOOGLE_MAPS_HOST_RE = /^(?:www\.|maps\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/i;
const CONSENT_HOST_RE = /^consent\.google\.[a-z.]+$/i;
const MAX_EXPAND_URLS = 50;
const MAX_HOPS = 5;
const MAX_REGISTER_ENTRIES = 2000;
const FOLDER_TAGS = new Set(['set', 'category']);

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

function parseUrl(raw) {
  try { return new URL(String(raw || '').trim()); } catch { return null; }
}

export function isShortMapsUrl(raw) {
  const url = parseUrl(raw);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return false;
  const host = url.hostname.toLowerCase();
  if (!SHORT_HOSTS.has(host)) return false;
  return host === 'maps.app.goo.gl' || url.pathname.startsWith('/maps');
}

export function isGoogleMapsUrl(raw) {
  const url = parseUrl(raw);
  return Boolean(url && url.protocol === 'https:' && GOOGLE_MAPS_HOST_RE.test(url.hostname)
    && (url.pathname.startsWith('/maps') || url.hostname.toLowerCase().startsWith('maps.')));
}

/**
 * Follow a short Maps link hop by hop (redirect: 'manual') until the Location
 * points at a Google Maps URL. Every hop must stay on an allowlisted host.
 */
export async function expandShortMapsUrl(raw, { fetchImpl = fetch, maxHops = MAX_HOPS } = {}) {
  if (!isShortMapsUrl(raw)) return { ok: false, input: raw, error: 'Not a maps.app.goo.gl or goo.gl/maps link' };
  let current = parseUrl(raw);
  current.protocol = 'https:';
  for (let hop = 0; hop < maxHops; hop += 1) {
    let res;
    try {
      res = await fetchImpl(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SP-Survey link expander)', Accept: 'text/html' },
      });
    } catch (err) {
      return { ok: false, input: raw, error: `Fetch failed: ${err?.message || err}` };
    }
    try { await res.body?.cancel?.(); } catch { /* ignore */ }
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) {
      return { ok: false, input: raw, error: `Short link did not redirect (HTTP ${res.status})` };
    }
    let next = parseUrl(new URL(location, current).toString());
    if (next && CONSENT_HOST_RE.test(next.hostname) && next.searchParams.get('continue')) {
      next = parseUrl(next.searchParams.get('continue'));
    }
    if (!next) return { ok: false, input: raw, error: 'Invalid redirect target' };
    if (isGoogleMapsUrl(next.toString())) return { ok: true, input: raw, url: next.toString() };
    if (!SHORT_HOSTS.has(next.hostname.toLowerCase())) {
      return { ok: false, input: raw, error: `Redirected to an unexpected host (${next.hostname})` };
    }
    current = next;
  }
  return { ok: false, input: raw, error: 'Too many redirects' };
}

export async function expandShortMapsUrls(urls, opts = {}) {
  const list = (Array.isArray(urls) ? urls : []).slice(0, MAX_EXPAND_URLS);
  const results = [];
  for (const u of list) {
    results.push(await expandShortMapsUrl(u, opts));
  }
  return results;
}

function normalizeFolder(path) {
  return String(path || '')
    .split('/')
    .map((s) => s.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

async function loadOwnedProject(env, supabaseRest, userId, projectId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,image_dataset_config,preloaded_images`,
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

/** Merge helper-reported uploads into the project's media library (by key; folders and tags unioned). */
export function mergeRegistration(row, { entries = [], folders = [], tags = {} }, { prefix, publicBase }) {
  const base = String(publicBase || '').replace(/\/$/, '');
  const clean = [];
  for (const e of entries.slice(0, MAX_REGISTER_ENTRIES)) {
    const key = String(e?.key || '');
    if (!key.startsWith(prefix) || key.includes('..') || !/\.(jpe?g|png|webp)$/i.test(key)) continue;
    const rel = key.slice(prefix.length);
    const parts = rel.split('/');
    const name = parts.pop();
    clean.push({
      url: base ? `${base}/${key}` : String(e.url || ''),
      name,
      key,
      media_id: key,
      folder: parts.join('/'),
      type: 'image',
      ...(e.attribution && typeof e.attribution === 'object' ? { attribution: {
        text: String(e.attribution.text || '').slice(0, 200),
        url: String(e.attribution.url || '').slice(0, 500),
        license: String(e.attribution.license || '').slice(0, 120),
      } } : {}),
      ...(e.streetLevel && typeof e.streetLevel === 'object' ? { streetLevel: {
        provider: String(e.streetLevel.provider || '').slice(0, 40),
        panoId: String(e.streetLevel.panoId || '').slice(0, 120),
        pointId: String(e.streetLevel.pointId || '').slice(0, 80),
        runId: String(e.streetLevel.runId || '').slice(0, 80),
      } } : {}),
    });
  }
  const byKey = new Map((Array.isArray(row.preloaded_images) ? row.preloaded_images : []).map((p) => [p?.key || p?.url, p]));
  clean.forEach((e) => byKey.set(e.key, { ...(byKey.get(e.key) || {}), ...e }));
  const cfg = row.image_dataset_config && typeof row.image_dataset_config === 'object' ? row.image_dataset_config : {};
  const safeTags = Object.fromEntries(Object.entries(tags || {})
    .map(([f, t]) => [normalizeFolder(f), t])
    .filter(([f, t]) => f && FOLDER_TAGS.has(t)));
  const mediaFolders = [...new Set([
    ...(Array.isArray(cfg.mediaFolders) ? cfg.mediaFolders : []),
    ...(Array.isArray(folders) ? folders : []).map(normalizeFolder),
    ...clean.map((e) => e.folder),
  ].filter(Boolean))].sort();
  return {
    registered: clean.length,
    preloadedImages: [...byKey.values()],
    imageDatasetConfig: { ...cfg, mediaFolders, mediaFolderTags: { ...(cfg.mediaFolderTags || {}), ...safeTags } },
  };
}

async function handleProjectRoutes(request, env, user, match, supabaseRest) {
  if (!user?.userId) {
    return json({ success: false, error: 'Needs a signed-in Platform account (Supabase). In local file mode pass the point list to the helper from the panel instead.', code: 'NOT_AVAILABLE' }, { status: 501 });
  }
  const projectId = decodeURIComponent(match[1]);
  const row = await loadOwnedProject(env, supabaseRest, user.userId, projectId);
  if (!row) return json({ success: false, error: 'Project not found' }, { status: 404 });
  const prefix = `${user.userId}/${projectId}/`;
  const publicBase = String(env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!match[2] && request.method === 'GET') {
    const sl = row.image_dataset_config?.streetLevel || {};
    return json({
      success: true,
      projectId,
      mediaPrefix: prefix,
      publicBase,
      points: Array.isArray(sl.points) ? sl.points : [],
      capture: sl.capture || {},
    });
  }
  if (match[2] === 'register' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const merged = mergeRegistration(row, body || {}, { prefix, publicBase });
    const now = new Date().toISOString();
    await supabaseRest(env, {
      path: '/rest/v1/projects',
      method: 'PATCH',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(user.userId)}`,
      body: {
        preloaded_images: merged.preloadedImages,
        image_dataset_config: merged.imageDatasetConfig,
        preloaded_at: now,
        preloaded_source: 'r2',
        updated_at: now,
      },
    });
    return json({ success: true, projectId, registered: merged.registered });
  }
  return json({ success: false, error: 'Not found' }, { status: 404 });
}

/**
 * Route handler. Returns null when the path is not a street-level route.
 * `authorize(request)` resolves to `{ userId }` for signed-in users (null otherwise).
 */
export async function handleStreetLevelRoutes(request, env, {
  authorize,
  fetchImpl = fetch,
  supabaseRest = defaultSupabaseRest,
} = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/street-level/')) return null;
  const user = authorize ? await authorize(request) : { userId: null };
  if (!user) {
    return json({ success: false, error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  if (url.pathname === '/api/street-level/expand' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const urls = Array.isArray(body?.urls) ? body.urls : (body?.url ? [body.url] : []);
    if (!urls.length) return json({ success: false, error: '"urls" is required' }, { status: 400 });
    if (urls.length > MAX_EXPAND_URLS) {
      return json({ success: false, error: `At most ${MAX_EXPAND_URLS} links per request` }, { status: 400 });
    }
    const results = await expandShortMapsUrls(urls, { fetchImpl });
    return json({ success: true, results });
  }
  const projectMatch = url.pathname.match(/^\/api\/street-level\/projects\/([^/]+)(?:\/(register))?$/);
  if (projectMatch) {
    try {
      return await handleProjectRoutes(request, env, user, projectMatch, supabaseRest);
    } catch (err) {
      return json({ success: false, error: err.message || String(err) }, { status: err.status || 500 });
    }
  }
  return json({ success: false, error: 'Not found' }, { status: 404 });
}
