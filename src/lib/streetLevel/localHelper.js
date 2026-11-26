/**
 * Client for the researcher's local `sp_streetlevel` helper (127.0.0.1 only).
 * The helper downloads imagery on the researcher's machine and uploads the
 * finished files through the normal media upload API; nothing here fetches imagery.
 */

export const HELPER_PORT = 47821;
export const HELPER_HTTPS_PORT = 47822;
export const HELPER_BASE = `http://127.0.0.1:${HELPER_PORT}`;
/** Safari blocks http://127.0.0.1 from https://sp-survey.org, so the panel tries this first. */
export const HELPER_HTTPS_BASE = `https://127.0.0.1:${HELPER_HTTPS_PORT}`;
export const HELPER_BASES = [HELPER_HTTPS_BASE, HELPER_BASE];
export const HELPER_PACKAGE = 'https://github.com/Sijie-Yang/SP-Survey-Platform/archive/refs/heads/main.zip#subdirectory=tools/streetlevel-helper';
export const ACTIVE_JOB_STATES = new Set(['queued', 'running']);
export const MAPILLARY_TOKEN_STORAGE_KEY = 'sp-streetlevel-mapillary-token';

export const DEFAULT_CAPTURE = {
  source: 'google',
  preset: 'current',
  headingMode: 'road',
  fixedHeading: 0,
  headingCount: 4,
  pitch: 0,
  fov: 90,
  width: 1024,
  zoom: 3,
  radius: 50,
  folder: 'street-level',
  folderMode: 'category',
  minInterval: 1.5,
};

export const SOURCES = ['google', 'mapillary'];
export const PRESETS = ['current', 'road', 'headings', 'pano'];
export const HEADING_MODES = ['road', 'fixed'];
export const FOLDER_MODES = ['single', 'category', 'set-per-point'];
export const OPERATING_SYSTEMS = ['mac', 'windows', 'linux'];
/** macOS only: pyexiv2 (a streetlevel dependency) ships libexiv2 linked against these Homebrew libraries. */
export const MAC_SYSTEM_DEPS = 'brew install gettext && brew install inih';

/** 'mac' | 'windows' | 'linux' from the browser's platform hints. */
export function detectOs(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const hint = `${nav.userAgentData?.platform || ''} ${nav.platform || ''} ${nav.userAgent || ''}`.toLowerCase();
  if (/win/.test(hint)) return 'windows';
  if (/mac|iphone|ipad|darwin/.test(hint)) return 'mac';
  return 'linux';
}

export function pythonCommand(os) {
  return os === 'windows' ? 'py' : 'python3';
}

function originFlag(origin) {
  if (!origin || /^https:\/\/(www\.)?sp-survey\.org$/.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(origin)) return '';
  return ` --allow-origin ${origin}`;
}

const VENV_PYTHON = '~/.sp-streetlevel/bin/python';

/** Interpreter the panel tells this OS to run. macOS uses the private venv, not conda’s python3. */
export function pythonInvoke(os) {
  return os === 'mac' ? VENV_PYTHON : pythonCommand(os);
}

/** Install + start commands that need nothing but Python 3.9+ (no pipx, no git, no PATH edit). */
export function helperCommands(os, origin) {
  const flag = originFlag(origin);
  const py = pythonCommand(os);
  // macOS: install into ~/.sp-streetlevel first. `pip install --user` on Anaconda/conda base
  // upgrades cryptography and breaks conda’s pyopenssl. `python3 -m sp_streetlevel serve` stays
  // available for a copy that is already installed.
  if (os === 'mac') {
    return {
      systemDeps: MAC_SYSTEM_DEPS,
      install: `python3 -m venv ~/.sp-streetlevel && ${VENV_PYTHON} -m pip install --upgrade "${HELPER_PACKAGE}"`,
      serve: `${VENV_PYTHON} -m sp_streetlevel serve${flag}`,
      installedServe: `${py} -m sp_streetlevel serve${flag}`,
    };
  }
  const commands = {
    install: `${py} -m pip install --user --upgrade "${HELPER_PACKAGE}"`,
    serve: `${py} -m sp_streetlevel serve${flag}`,
  };
  if (os !== 'windows') {
    commands.isolatedInstall = `python3 -m venv ~/.sp-streetlevel && ${VENV_PYTHON} -m pip install --upgrade "${HELPER_PACKAGE}"`;
    commands.isolatedServe = `${VENV_PYTHON} -m sp_streetlevel serve${flag}`;
  }
  return commands;
}

export function runCommand({ projectId, apiBase, capture = {}, os = 'mac' }) {
  const c = { ...DEFAULT_CAPTURE, ...capture };
  const parts = [`${pythonInvoke(os)} -m sp_streetlevel run`, `--project ${projectId}`];
  if (apiBase && apiBase !== 'https://sp-survey.org') parts.push(`--api ${apiBase}`);
  if (c.source !== 'google') parts.push(`--source ${c.source}`);
  parts.push(`--preset ${c.preset}`);
  if (c.preset === 'headings') parts.push(`--heading-count ${c.headingCount}`);
  if (c.headingMode === 'fixed' && (c.preset === 'current' || c.preset === 'headings')) {
    parts.push('--heading-mode fixed', `--fixed-heading ${c.fixedHeading}`);
  }
  parts.push(`--pitch ${c.pitch}`, `--fov ${c.fov}`);
  if (c.source === 'google') parts.push(`--zoom ${c.zoom}`);
  parts.push(`--folder ${c.folder}`, `--folder-mode ${c.folderMode}`);
  return parts.join(' ');
}

async function call(path, { method = 'GET', body, timeoutMs = 8000, fetchImpl = fetch, base = HELPER_BASE } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl?.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw Object.assign(new Error(data?.error || `Helper HTTP ${res.status}`), { status: res.status });
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Probe HTTPS first (Safari on https://sp-survey.org), then HTTP.
 * `{ running: true, version, streetlevel, base }` or `{ running: false, blocked: true }`
 * when both probes fail — the helper may be up and the browser blocked the call.
 */
export async function helperHealth(opts = {}) {
  const { bases = HELPER_BASES, ...rest } = opts;
  for (const base of bases) {
    try {
      const data = await call('/health', { timeoutMs: 2500, ...rest, base });
      return { running: true, version: data.version, streetlevel: data.streetlevel, base };
    } catch {
      /* try the next listener */
    }
  }
  return { running: false, blocked: true };
}

export function startJob({ apiBase, projectId, mediaPrefix, publicBase, token, points, options }, opts = {}) {
  return call('/jobs', { method: 'POST', body: { apiBase, projectId, mediaPrefix, publicBase, token, points, options }, ...opts });
}

export function getJob(jobId, since = 0, opts = {}) {
  return call(`/jobs/${encodeURIComponent(jobId)}?since=${since}`, opts);
}

export function sendToken(jobId, token, opts = {}) {
  return call(`/jobs/${encodeURIComponent(jobId)}/token`, { method: 'POST', body: { token }, ...opts });
}

export function cancelJob(jobId, opts = {}) {
  return call(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: {}, ...opts });
}

export function resumeJob(jobId, token, opts = {}) {
  return call(`/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST', body: { token }, ...opts });
}

/** Merge helper-reported uploads into preloadedImages by key. */
export function mergeMediaEntries(existing = [], incoming = []) {
  const byKey = new Map();
  existing.forEach((e) => byKey.set(e?.key || e?.media_id || e?.url, e));
  incoming.forEach((e) => { if (e?.key) byKey.set(e.key, { ...(byKey.get(e.key) || {}), ...e }); });
  return [...byKey.values()];
}

/** Per-point status counts; files are unique keys (points can share a pano view). */
export function summarizeItems(points = [], items = {}) {
  const counts = { total: 0, done: 0, noImage: 0, failed: 0, pending: 0, running: 0, files: 0 };
  const files = new Set();
  points.forEach((p) => {
    const it = items[p.id];
    if (!it) return;
    counts.total += 1;
    if (it.status === 'done') { counts.done += 1; (it.keys || []).forEach((k) => files.add(k)); }
    else if (it.status === 'no-image') counts.noImage += 1;
    else if (it.status === 'failed') counts.failed += 1;
    else if (it.status === 'running') counts.running += 1;
    else counts.pending += 1;
  });
  counts.files = files.size;
  return counts;
}

/** True when the point carries its own view (pasted Street View URL or a manual override). */
export function hasOwnView(point) {
  return point?.heading != null || point?.pitch != null || point?.fov != null;
}
