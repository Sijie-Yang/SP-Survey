/**
 * SP-Scheme import, shared by the classic SP-Scheme panel, Studio and the MCP
 * server, so all three turn the same upload into the same survey.
 *
 *   readSpSchemeUpload(bytes)                     spScheme.js
 *   → prepareSpSchemeUpload(read)                 page as declared, or as it is
 *   → revalidateSpSchemeUpload(upload, hosts)     when the allowed hosts change
 *   → upload spSchemeMediaPlan(upload) to the media library (caller's job)
 *   → finalizeSpSchemeImport(report, upload, config)
 *
 * summarizeSpSchemeImport gives a plain JSON view of the result for any UI or
 * agent. Everything here is deterministic: no model, no DOM, no network and no
 * Supabase, so it runs the same in the browser, under Node and in the Worker.
 * Keep every relative import in this module's graph with an explicit `.js`.
 */

import { zipSync } from 'fflate';
import { applySpSchemePackage, validateSpSchemePackage } from './spScheme.js';
import { planUploadMedia, prepareAsIsImport } from './spSchemeAsIs.js';
import { externalHostsIn } from './spSiteCore.js';

const MATCH_LEVELS = ['full', 'partial', 'custom', 'none'];

/**
 * One upload from the files a researcher dropped: one file as it is; several
 * (index.html plus its config, CSV or images) zipped together as one package.
 * @param {{ name: string, bytes: Uint8Array }[]} files
 * @returns {{ bytes: Uint8Array, name: string } | null}
 */
export function bundleSpSchemeFiles(files = []) {
  const list = (Array.isArray(files) ? files : []).filter((file) => file && file.bytes);
  if (!list.length) return null;
  if (list.length === 1) return { bytes: list[0].bytes, name: String(list[0].name || '') };
  const bundle = {};
  list.forEach((file) => { bundle[file.name] = file.bytes; });
  const page = list.find((file) => /\.html?$/i.test(file.name));
  return { bytes: zipSync(bundle), name: page ? `${page.name} + ${list.length - 1}` : `${list.length} files` };
}

/**
 * Hosts a page reaches. `needed`: the page loads a script or a style from the
 * host, so it is allowed by default; hosts it only sends requests to are
 * listed but not allowed. `kinds` says why ('script', 'style', 'request').
 * @returns {{ host: string, kinds: string[], needed: boolean }[]}
 */
export function spSchemeHostList(html) {
  return externalHostsIn(html).map(({ host, kinds }) => ({ host, kinds: [...kinds], needed: kinds.some((kind) => kind !== 'request') }));
}

// A page imported from the web keeps loading its images and data from its own
// site, so that site comes first and is needed (`source: true`).
function withSourceHost(list, sourceHost) {
  const own = list.find((h) => h.host === sourceHost);
  return [
    { host: sourceHost, kinds: own ? [...own.kinds] : [], needed: true, source: true },
    ...list.filter((h) => h.host !== sourceHost),
  ];
}

/** The page's check with these hosts allowed (what toggling a host re-runs). */
export function revalidateSpSchemeUpload(upload, allowedHosts = []) {
  return validateSpSchemePackage(upload?.pkg, {
    siteHtml: upload?.siteHtml || null,
    allowedHosts: Array.isArray(allowedHosts) ? allowedHosts : [],
  });
}

/**
 * What an upload becomes: an SP-Scheme page as uploaded, or any other page as
 * it is (no questions declared; the platform only records what it saves and
 * sends). Nothing here involves a model.
 *
 * The first check allows every host the page names, so a script host alone
 * never pushes an SP-Scheme page into an as-is import. The returned report is
 * the check with the default hosts allowed (`allowed`).
 *
 * @param {object} read readSpSchemeUpload result (or the same shape for a fetched page)
 * @param {{ name?: string, sourceHost?: string|null }} options file or link name; the page's own site for a link import
 * @returns {{ upload: object, hosts: { host, kinds, needed, source? }[], allowed: string[], report: object }}
 */
export function prepareSpSchemeUpload(read, { name = '', sourceHost = null } = {}) {
  let upload = { name, ...read };
  let hosts = [];
  if (read?.siteHtml) {
    const found = spSchemeHostList(read.siteHtml);
    const first = validateSpSchemePackage(read.pkg, { siteHtml: read.siteHtml, allowedHosts: found.map((h) => h.host) });
    if (first.ok) {
      upload = { ...upload, mediaPlan: planUploadMedia(read.mediaFiles) };
      hosts = found;
    } else {
      const prepared = prepareAsIsImport(read.siteHtml, { mediaFiles: read.mediaFiles || [], dataFiles: read.dataFiles || [] });
      upload = {
        ...upload,
        originalHtml: read.siteHtml,
        siteHtml: prepared.html,
        pkg: prepared.pkg,
        mediaPlan: prepared.mediaPlan,
        // declared: the page carries an SP-Scheme block with problems, listed so they can be fixed.
        asIs: { declared: Boolean(first.summary), errors: first.errors, problems: prepared.problems },
      };
      hosts = spSchemeHostList(prepared.html);
    }
  }
  const source = sourceHost ? String(sourceHost).trim().toLowerCase() : '';
  if (source) {
    upload = { ...upload, sourceHost: source };
    hosts = withSourceHost(hosts, source);
  }
  const allowed = hosts.filter((h) => h.needed).map((h) => h.host);
  return { upload, hosts, allowed, report: revalidateSpSchemeUpload(upload, allowed) };
}

/** The zip's media files to upload before finalizing, or null when there are none. */
export function spSchemeMediaPlan(upload) {
  return upload?.mediaPlan?.files?.length ? upload.mediaPlan : null;
}

/**
 * The media plan's folders as a plain list (the plan keeps a Map).
 * `folder` is the zip's folder, `full` the media-library folder.
 * @returns {{ folder: string, full: string, count: number }[]}
 */
export function mediaPlanFolders(plan) {
  const folders = plan?.folders;
  if (!folders) return [];
  const entries = folders instanceof Map ? [...folders.entries()] : Object.entries(folders);
  return entries.map(([folder, entry]) => ({ folder: String(folder), full: String(entry?.full ?? folder), count: Number(entry?.count) || 0 }));
}

/**
 * The survey config after import. Call only with a report whose `ok` is true,
 * after the media plan (if any) is in the media library.
 * @param {object} report revalidateSpSchemeUpload / prepareSpSchemeUpload report
 * @param {object} upload prepareSpSchemeUpload upload
 * @param {object} baseConfig the current config (theme, logo and settings are kept)
 */
export function finalizeSpSchemeImport(report, upload, baseConfig = {}) {
  const next = applySpSchemePackage(report, { baseConfig: baseConfig || {} });
  // Imported as it is: Results and the export treat every record as the page's own.
  if (next.spSite && upload?.asIs) next.spSite.convertedFrom = upload.name || 'index.html';
  // The zip's folders are the page's folders unless the page named its own.
  const plan = spSchemeMediaPlan(upload);
  if (next.spSite && plan && !next.spSite.mediaFolders?.length) next.spSite.mediaFolders = mediaPlanFolders(plan).map((f) => f.full);
  return next;
}

function issueList(list) {
  return (Array.isArray(list) ? list : []).map((item) => (typeof item === 'string'
    ? { path: '', message: item }
    : { path: String(item?.path || ''), message: String(item?.message || '') })).filter((item) => item.message);
}

function plainText(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const hit = value.default ?? value.en ?? Object.values(value).find((v) => typeof v === 'string');
    return typeof hit === 'string' ? hit : '';
  }
  return '';
}

/**
 * What the model that built the page should fix: for a page imported as it is,
 * the problems of the SP-Scheme block it declared and anything that blocks the
 * import; otherwise every error of the check.
 * @returns {{ path: string, message: string }[]}
 */
export function spSchemeProblems(report, upload) {
  const list = upload?.asIs
    ? [...(upload.asIs.declared ? issueList(upload.asIs.errors) : []), ...issueList(upload.asIs.problems), ...issueList(report?.errors)]
    : issueList(report?.errors);
  const seen = new Set();
  return list.filter((item) => {
    const key = `${item.path}\n${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The problems as a Markdown section to send after SP-Scheme ('' when there are none). */
export function spSchemeProblemsText(problems = []) {
  const list = issueList(problems);
  if (!list.length) return '';
  return `\n\n## Problems to fix in my index.html\n${list.map((e) => `- ${e.message}${e.path ? ` (${e.path})` : ''}`).join('\n')}\n`;
}

/**
 * A plain, JSON-safe view of a prepared upload for UIs and agents.
 * Hosts keep machine-readable reasons (`kinds`, `source`) so each UI words them itself.
 * @param {{ report, upload, hosts?, allowed? }} prepared prepareSpSchemeUpload result (report may be revalidated)
 */
export function summarizeSpSchemeImport({ report = null, upload = null, hosts = [], allowed = [] } = {}) {
  const summary = report?.summary || null;
  const plan = spSchemeMediaPlan(upload);
  const allowedSet = new Set(Array.isArray(allowed) ? allowed : []);
  const count = (value) => Number(value) || 0;
  return {
    ok: Boolean(report?.ok),
    asIs: Boolean(upload?.asIs),
    declaredButBroken: Boolean(upload?.asIs?.declared && upload.asIs.errors?.length),
    name: String(upload?.name || ''),
    title: plainText(summary?.title),
    hasSite: Boolean(summary?.hasSite),
    siteFile: upload?.siteFile ? String(upload.siteFile) : null,
    siteBytes: count(summary?.siteBytes),
    matchLevel: MATCH_LEVELS.includes(summary?.match) ? summary.match : 'none',
    pageCount: count(summary?.pageCount),
    questionCount: count(summary?.questionCount),
    nativeCount: count(summary?.nativeCount),
    customCount: count(summary?.customCount),
    types: Object.fromEntries(Object.entries(summary?.types || {}).map(([type, n]) => [String(type), count(n)])),
    errors: issueList(report?.errors),
    warnings: issueList(report?.warnings),
    problems: spSchemeProblems(report, upload),
    media: { files: plan ? plan.files.length : 0, folders: mediaPlanFolders(plan) },
    hosts: (Array.isArray(hosts) ? hosts : []).map((h) => ({
      host: String(h?.host || ''),
      kinds: (Array.isArray(h?.kinds) ? h.kinds : []).map(String),
      needed: Boolean(h?.needed),
      allowed: allowedSet.has(h?.host),
      source: Boolean(h?.source),
    })),
  };
}
