/**
 * Public survey slugs: https://host/s/{slug}
 * Project-id links stay at /survey?project={id}.
 * Keep this pattern identical to supabase/project_public_slug.sql.
 */

export const RESERVED_PUBLIC_SLUGS = Object.freeze(['admin', 'api', 's', 'survey', 'login']);

const RESERVED = new Set(RESERVED_PUBLIC_SLUGS);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_LENGTH = 2;
const MAX_LENGTH = 40;

export function normalizePublicSlug(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/** @returns {{ ok: boolean, slug: string, code: 'empty'|'ok'|'invalid'|'reserved' }} */
export function validatePublicSlug(raw) {
  const slug = normalizePublicSlug(raw);
  if (!slug) return { ok: true, slug: '', code: 'empty' };
  if (RESERVED.has(slug)) return { ok: false, slug, code: 'reserved' };
  if (slug.length < MIN_LENGTH || slug.length > MAX_LENGTH || !SLUG_PATTERN.test(slug)) {
    return { ok: false, slug, code: 'invalid' };
  }
  return { ok: true, slug, code: 'ok' };
}

export function isPublicSlugPath(pathname) {
  return /^\/s\/[^/]+\/?$/.test(String(pathname || ''));
}

/** Valid slug from /s/{slug}, or null when the path is not a usable custom link. */
export function publicSlugFromPathname(pathname) {
  const match = String(pathname || '').match(/^\/s\/([^/]+)\/?$/);
  if (!match) return null;
  let decoded = match[1];
  try { decoded = decodeURIComponent(match[1]); } catch { return null; }
  const check = validatePublicSlug(decoded);
  return check.ok && check.slug ? check.slug : null;
}

/**
 * Stable key for the participant URL. A project query wins so
 * /survey?project={id} never depends on the slug.
 */
export function participantLocationKey(location = {}) {
  const search = location.search ?? '';
  const pathname = location.pathname ?? '';
  const project = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('project');
  if (project) return `id:${project}`;
  if (isPublicSlugPath(pathname)) {
    const slug = publicSlugFromPathname(pathname);
    return slug ? `slug:${slug}` : 'slug:invalid';
  }
  return 'default';
}

export function legacySurveyShareUrl(origin, projectId) {
  return `${origin}/survey?project=${encodeURIComponent(projectId)}`;
}

export function customSurveyShareUrl(origin, slug) {
  return `${origin}/s/${normalizePublicSlug(slug)}`;
}

export function surveyShareUrl(origin, project) {
  if (!project?.id) return null;
  const check = validatePublicSlug(project.publicSlug || project.public_slug || '');
  if (check.ok && check.slug) return customSurveyShareUrl(origin, check.slug);
  return legacySurveyShareUrl(origin, project.id);
}

export function publicSlugErrorCode(error) {
  const blob = [error?.code, error?.message, error?.details, error?.hint, typeof error === 'string' ? error : '']
    .filter(Boolean)
    .join(' ');
  if (/slug_taken|duplicate key value|projects_public_slug_key/i.test(blob)) return 'taken';
  if (/slug_reserved/i.test(blob)) return 'reserved';
  if (/slug_invalid|projects_public_slug_format/i.test(blob)) return 'invalid';
  if (/not_owner|not_authenticated|42501|permission denied/i.test(blob)) return 'forbidden';
  if (/set_project_public_slug|resolve_survey_slug|PGRST202|schema cache|could not find the function/i.test(blob)) return 'unavailable';
  return 'unknown';
}
