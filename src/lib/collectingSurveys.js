/**
 * How many of the signed-in user's surveys are open for responses.
 *
 * There is no collecting column on projects. The count uses, in order:
 * 1. An explicit collecting flag (`collecting: true`, or status `collecting` / `open`)
 *    includes the survey, unless it is also explicitly closed.
 * 2. An explicit closed flag excludes it (`closed` / `isClosed`, `collecting: false`,
 *    `acceptingResponses: false`, or status `closed` / `paused` / `stopped` / `archived`).
 *    Flags are read from the project, its metadata, and the survey config.
 * 3. Otherwise the survey counts only when it has been published
 *    (`publishedVersion` / `published_version` > 0, or a real `publishedAt` / `published_at`)
 *    and is not closed. Unpublished drafts do not count, including legacy projects
 *    that are still live-on-save and have never been released.
 *
 * Collaborator copies of someone else's project never count. Pass `userId` to
 * drop rows owned by a different account. Response quotas and main-page time
 * windows are not stored as this flag, so they do not change the count.
 */

const CLOSED_STATUSES = new Set(['closed', 'paused', 'stopped', 'archived']);
const COLLECTING_STATUSES = new Set(['collecting', 'open']);

function ownerId(project) {
  return project?.userId || project?.user_id || null;
}

function boolish(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
  }
  return null;
}

function published(project) {
  const version = Number(project.publishedVersion ?? project.published_version);
  if (Number.isFinite(version) && version > 0) return true;
  const stamp = Date.parse(project.publishedAt || project.published_at || '');
  return Number.isFinite(stamp);
}

function containers(project) {
  const meta = project.metadata && typeof project.metadata === 'object' ? project.metadata : null;
  const configs = [
    project._surveyConfig,
    project.surveyConfig,
    project.survey_config,
    project.surveyConfigPublished,
    project.survey_config_published,
  ].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  return [project, meta, ...configs].filter(Boolean);
}

function statusOf(source) {
  return String(
    source.status || source.surveyStatus || source.responseStatus || source.collectingStatus || '',
  ).trim().toLowerCase();
}

/** This viewer's own survey, never a project they were only invited to edit. */
export function isOwnedSurvey(project, userId) {
  if (!project || typeof project !== 'object') return false;
  if (project.accessRole === 'collaborator') return false;
  const owner = ownerId(project);
  if (userId && owner && String(owner) !== String(userId)) return false;
  return true;
}

/** True when this project is currently open for participant responses. */
export function isCollectingSurvey(project) {
  if (!project || typeof project !== 'object') return false;
  let explicitCollecting = false;
  let explicitClosed = false;
  for (const source of containers(project)) {
    const collecting = boolish(source.collecting);
    if (collecting === true) explicitCollecting = true;
    if (collecting === false) explicitClosed = true;
    if (boolish(source.closed) === true || boolish(source.isClosed) === true) explicitClosed = true;
    if (boolish(source.acceptingResponses) === false || boolish(source.openForResponses) === false) {
      explicitClosed = true;
    }
    const status = statusOf(source);
    if (CLOSED_STATUSES.has(status)) explicitClosed = true;
    if (COLLECTING_STATUSES.has(status)) explicitCollecting = true;
  }
  if (explicitClosed) return false;
  if (explicitCollecting) return true;
  return published(project);
}

export function countCollectingSurveys(projects, { userId } = {}) {
  if (!Array.isArray(projects)) return 0;
  return projects.filter((project) => isOwnedSurvey(project, userId) && isCollectingSurvey(project)).length;
}
