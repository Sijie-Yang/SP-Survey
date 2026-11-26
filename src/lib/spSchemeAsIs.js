/**
 * Import a page that does not match SP-Scheme as it is: no questions are
 * declared, the page runs unchanged, and the platform records what it saves
 * in its own storage and every request it sends. No model is involved.
 */

import { applyConversion, candidateHosts, planMediaUpload, rawConversionResult } from './spSchemeConvert.js';
import { stripSitePreviewShim } from './spSiteCore.js';

/**
 * The page prepared for an as-is import: an empty SP-Scheme block replaces any
 * invalid one, the zip's media files are planned for the media library in the
 * zip's own folders (and linked as the page's folders), and its data files are
 * embedded for SPSite.getData.
 * @returns {{ html: string, pkg: object, mediaPlan: object|null, hosts: object[], problems: string[] }}
 */
export function prepareAsIsImport(html, { mediaFiles = [], dataFiles = [] } = {}) {
  const source = stripSitePreviewShim(String(html || ''));
  const applied = applyConversion(source, rawConversionResult(), [], { mediaFiles, dataFiles });
  return {
    html: applied.html,
    pkg: applied.pkg,
    mediaPlan: applied.mediaPlan?.files?.length ? applied.mediaPlan : null,
    hosts: candidateHosts(applied.html, null),
    problems: applied.problems,
  };
}

/** Where a zip's media files go in the library (the zip's own folders), for any upload. */
export function planUploadMedia(mediaFiles = []) {
  if (!Array.isArray(mediaFiles) || !mediaFiles.length) return null;
  const plan = planMediaUpload(mediaFiles, [], '');
  return plan.files.length ? plan : null;
}
