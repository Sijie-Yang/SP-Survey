/**
 * Plain facts about a project for Studio: what kind of survey it is, whether
 * participants already see it, which image folders the page reads and what is
 * missing before it can go live. Pure and deterministic; the page words the
 * results in the researcher's language.
 */

import { SITE_MEDIA_ROOT, SITE_PAGE_FILES, findImageSlots, pageMediaFolderNames, siteMediaFolderNames, siteMediaFolders } from './spSite';
import { mediaFor, pageMediaCalls } from './spSchemeDiagnosis';
import { defaultMediaCount, hasMediaSlots, shouldInjectMedia } from './surveyMediaInjection';
import { compareRelease, publicMediaConfig, sameReleaseValue } from './releaseComparison';
import { getRecursiveMedia, inferMediaType, listAllKnownFolders, normalizeFolderPath, normalizeMediaEntry } from './mediaUtils';

/** The project's current draft config. */
export function projectConfig(project) {
  return project?._surveyConfig && typeof project._surveyConfig === 'object' ? project._surveyConfig : {};
}

export function configHasQuestions(config) {
  return (config?.pages || []).some((page) => (page?.elements || []).length > 0);
}

/**
 * 'page': a participant page built by an AI (SP-Scheme); 'classic': questions
 * built in the classic editor; 'empty': nothing yet.
 */
export function projectKind(projectOrConfig) {
  const config = projectOrConfig?._surveyConfig !== undefined ? projectConfig(projectOrConfig) : (projectOrConfig || {});
  if (config?.spSite?.html) return 'page';
  if (configHasQuestions(config)) return 'classic';
  return 'empty';
}

function stamp(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : null;
}

/**
 * Whether the draft differs from the version participants get, the same way
 * the classic Versions panel decides it: the survey, the media list and the
 * media settings (never the clocks, and never the name or description).
 * @param {{ config: object, media: object }|null} published the live version (loadStudioRelease)
 */
export function releaseHasChanges(published, project) {
  if (!published) return false;
  const media = published.media || {};
  const diff = compareRelease(published.config, projectConfig(project), media.preloadedImages || [], project?.preloadedImages || []);
  return Boolean(diff.configChanged || diff.mediaAdded || diff.mediaRemoved || diff.mediaChanged)
    || !sameReleaseValue(media.imageDatasetConfig, publicMediaConfig(project?.imageDatasetConfig));
}

/**
 * What participants get when they open the link:
 *   'live'       not release-managed, so they see the latest saved draft
 *   'published'  release-managed and the draft equals version N
 *   'pending'    release-managed and the draft has changes participants do not see yet
 *   'draft'      nothing to show yet (no page, no questions)
 * Without `published` (not loaded yet) a release-managed project counts as published.
 * @returns {{ state: 'draft'|'live'|'published'|'pending', version: number }}
 */
export function projectStatus(project, published = null) {
  const version = Number(project?.publishedVersion) || 0;
  if (!project?.releaseManaged || !version) {
    return { state: projectKind(project) === 'empty' ? 'draft' : 'live', version: 0 };
  }
  return { state: releaseHasChanges(published, project) ? 'pending' : 'published', version };
}

/** Newest first by last change (projects without a date go last). */
export function sortProjectsNewestFirst(projects = []) {
  const time = (p) => stamp(p?.lastModified) ?? stamp(p?.draftUpdatedAt) ?? stamp(p?.createdAt) ?? 0;
  return [...(Array.isArray(projects) ? projects : [])].filter((p) => p?.id).sort((a, b) => time(b) - time(a));
}

function projectPrefix(project) {
  return project?.userId && project?.id ? `${project.userId}/${project.id}/` : null;
}

/** Folders the participant page reads its images from (the library root is left out). */
export function pageFolders(config) {
  if (!config?.spSite?.html) return [];
  const names = new Set();
  [...siteMediaFolderNames(config), ...pageMediaFolderNames(config.spSite.html)].forEach((name) => {
    if (name === SITE_MEDIA_ROOT) return;
    const folder = normalizeFolderPath(name);
    if (folder) names.add(folder);
  });
  return [...names];
}

/**
 * True when the folder of an upload matters: the page reads folders by name
 * (SPSite.getMedia or linked folders) or keeps an empty image list of its own.
 * For classic surveys and pages whose images the platform draws, it does not.
 */
export function pageUsesFolders(config) {
  const html = config?.spSite?.html;
  if (!html) return false;
  const calls = pageMediaCalls(html);
  return Boolean(calls.folders.length || calls.dynamic || siteMediaFolderNames(config).length
    || findImageSlots(html).some((slot) => !slot.count));
}

/** Files in a folder of the project library, subfolders included. */
export function folderFileCount(project, folder) {
  return getRecursiveMedia(project?.preloadedImages || [], folder, projectPrefix(project)).length;
}

/**
 * The image library by folder, with file counts.
 * @returns {{ folder: string, count: number }[]}
 */
export function libraryFolders(project) {
  const pool = project?.preloadedImages || [];
  const settings = project?.imageDatasetConfig || {};
  const prefix = projectPrefix(project);
  return listAllKnownFolders(pool, settings.mediaFolderTags, prefix, settings.mediaFolders)
    .map((folder) => ({ folder, count: getRecursiveMedia(pool, folder, prefix).length }));
}

/** Library files that sit in no folder. */
export function looseFileCount(project) {
  const prefix = projectPrefix(project);
  return (project?.preloadedImages || []).filter((raw) => {
    const entry = normalizeMediaEntry(raw, prefix);
    return entry?.url && !entry.folder;
  }).length;
}

/** Up to `max` images to show as a strip of thumbnails. */
export function libraryThumbnails(project, max = 4) {
  const prefix = projectPrefix(project);
  const out = [];
  for (const raw of project?.preloadedImages || []) {
    const entry = normalizeMediaEntry(raw, prefix);
    if (entry?.url && /^https?:|^\//i.test(entry.url) && (entry.type || inferMediaType(entry.name)) === 'image') out.push(entry);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * What the page asks for but participants would not get, judged from what the
 * platform actually serves (siteMediaFolders, as on the participant page):
 *   { folder, reason: 'empty' }     the folder has no files
 *   { folder, reason: 'unlinked' }  the folder has files, but it is not linked to the page
 *   { folder: '', reason: 'slots' } the page's own image list stays empty
 */
export function missingPageFolders(project, config = projectConfig(project)) {
  const html = config?.spSite?.html;
  if (!html) return [];
  const served = siteMediaFolders(project?.preloadedImages || [], config);
  const calls = pageMediaCalls(html);
  const linked = siteMediaFolderNames(config).filter((name) => name !== SITE_MEDIA_ROOT);
  const names = [...new Set([...calls.folders, ...linked].map((name) => normalizeFolderPath(name)).filter(Boolean))];
  const missing = names
    .filter((folder) => !mediaFor(served, folder).length)
    .map((folder) => ({ folder, reason: folderFileCount(project, folder) ? 'unlinked' : 'empty' }));
  const slotsEmpty = !calls.folders.length && !calls.dynamic && findImageSlots(html).some((slot) => !slot.count);
  const libraryServed = Object.entries(served).some(([key, list]) => key !== SITE_PAGE_FILES && list.length);
  if (slotsEmpty && !linked.length && !libraryServed) missing.push({ folder: '', reason: 'slots' });
  return missing;
}

/**
 * The config after uploading into `folder`: the folder is linked to the page
 * (spSite.mediaFolders) when the page reads it by name but it is not linked,
 * or when the page fills an empty image list of its own and has no folder
 * linked. Otherwise the same config.
 */
export function linkUploadFolder(config, folder) {
  const html = config?.spSite?.html;
  const target = normalizeFolderPath(folder);
  if (!html || !target) return config;
  const linked = config.spSite.mediaFolders || [];
  if (linked.map((name) => normalizeFolderPath(name)).includes(target)) return config;
  const readsIt = pageMediaCalls(html).folders.map((name) => normalizeFolderPath(name)).includes(target);
  const fillsSlots = !siteMediaFolderNames(config).length && findImageSlots(html).some((slot) => !slot.count);
  if (!readsIt && !fillsSlots) return config;
  return { ...config, spSite: { ...config.spSite, mediaFolders: [...linked, target] } };
}

/**
 * Media entries after an upload: the fresh list plus the uploaded entries it
 * does not hold yet (the batch uploader reports everything uploaded so far).
 */
export function appendUploadedMedia(existing = [], uploaded = []) {
  const known = new Set((existing || []).map((entry) => entry?.key || entry?.url).filter(Boolean));
  return [...(existing || []), ...(uploaded || []).filter((entry) => !known.has(entry?.key || entry?.url))];
}

/**
 * The fewest images the survey's platform-drawn questions need: the largest
 * number one question shows at once. Below it a question cannot be filled.
 */
export function surveyImageNeed(config) {
  return (config?.pages || []).flatMap((page) => page?.elements || []).reduce((need, question) => {
    if (!question || !(shouldInjectMedia(question) || hasMediaSlots(question))) return need;
    const perTrial = hasMediaSlots(question)
      ? question.mediaSlots.reduce((sum, slot) => sum + Math.max(1, Number(slot?.count) || 1), 0)
      : Number(question.imageCount) || defaultMediaCount(question);
    return Math.max(need, perTrial);
  }, 0);
}

/**
 * A folder name a researcher typed, made safe for the library: letters,
 * digits, `_` and `-` in each part, parts joined by `/`; no `.` or `..` parts.
 */
export function cleanFolderName(raw) {
  return normalizeFolderPath(raw)
    .split('/')
    .map((part) => part.normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, ''))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
    .slice(0, 120);
}

/** The folder new uploads go to by default: the first one the page reads, else "images". */
export function defaultUploadFolder(config) {
  return pageFolders(config)[0] || 'images';
}

/**
 * A new project's name after an import: the page's title, else the file name
 * without its extension, else the fallback. Generic file names do not count.
 */
export function importedProjectName({ title = '', name = '' } = {}, fallback = 'New study') {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const fromTitle = clean(title);
  if (fromTitle) return fromTitle;
  const file = clean(String(name || '').split(/[\\/]/).pop().replace(/\s\+\s\d+$/, '').replace(/\.(html?|zip)$/i, ''));
  if (file && !/^(index|page|survey|study|files?|\d+ files)$/i.test(file)) return file;
  return fallback;
}

const INJECTED_BLOCK_RE = /[ \t]*<script\b[^>]*\bid=["']sp-(?:scheme|data)["'][^>]*>[\s\S]*?<\/script>[ \t]*\n?/gi;

/**
 * The page to hand back to an AI. A page imported as it is carries blocks the
 * platform added (`<script id="sp-scheme">`, `<script id="sp-data">`); sent
 * back with them, it would come back as a declared page with no questions.
 * The original page is used when it is stored; otherwise those blocks are cut.
 */
export function pageHtmlForAi(spSite) {
  if (!spSite?.html) return '';
  if (!spSite.convertedFrom) return String(spSite.html);
  if (typeof spSite.originalHtml === 'string' && spSite.originalHtml) return spSite.originalHtml;
  return String(spSite.html).replace(INJECTED_BLOCK_RE, '');
}

/**
 * The page text for an AI to edit: SP-Scheme first, then the current page.
 */
export function pageForAiText(schemeText, html) {
  return `${schemeText}\n\n## My current index.html\nEdit this page and hand it back as index.html, or as a zip with its images.\n\n\`\`\`html\n${String(html || '')}\n\`\`\`\n`;
}
