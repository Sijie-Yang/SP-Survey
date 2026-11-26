/**
 * Links into the classic editor: /admin?project=<id>[&tab=media|builder|host|share|results].
 * AdminApp reads them once on start, opens that project and tab, then removes
 * the parameters from the address bar.
 */

/** Tab names a link may ask for, mapped to AdminWorkspaceTabs indices. */
export const ADMIN_DEEP_LINK_TABS = Object.freeze({
  media: 1,
  builder: 2,
  host: 3,
  share: 4,
  results: 5,
});

const DEEP_LINK_PARAMS = ['project', 'tab'];

// Project ids are `proj_<ts>_<rand>`; older and local ids are file-name-like.
// No slashes and no leading dot, so an id can never walk a local API path.
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function isAdminDeepLinkProjectId(value) {
  return typeof value === 'string' && PROJECT_ID_PATTERN.test(value);
}

/**
 * @param {string} search location.search, with or without the leading "?"
 * @returns {{ projectId: string|null, tab: number|null, present: boolean }}
 *   `present` is true when the address carries any deep-link parameter, even
 *   an unusable one, so the caller knows to clean the address bar.
 */
export function parseAdminDeepLink(search = '') {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const rawProject = (params.get('project') || '').trim();
  const rawTab = (params.get('tab') || '').trim().toLowerCase();
  const tab = Object.prototype.hasOwnProperty.call(ADMIN_DEEP_LINK_TABS, rawTab)
    ? ADMIN_DEEP_LINK_TABS[rawTab]
    : null;
  return {
    projectId: isAdminDeepLinkProjectId(rawProject) ? rawProject : null,
    tab,
    present: DEEP_LINK_PARAMS.some((key) => params.has(key)),
  };
}

/** The same search string without the deep-link parameters ("" when nothing is left). */
export function stripAdminDeepLink(search = '') {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  DEEP_LINK_PARAMS.forEach((key) => params.delete(key));
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** Classic editor address for one project, optionally on a named tab. */
export function adminProjectPath(projectId, tab = null) {
  if (!isAdminDeepLinkProjectId(projectId)) return '/admin';
  const params = new URLSearchParams({ project: projectId });
  if (tab && Object.prototype.hasOwnProperty.call(ADMIN_DEEP_LINK_TABS, tab)) params.set('tab', tab);
  return `/admin?${params.toString()}`;
}

/** Studio address for one project, or the Studio start screen. */
export function studioPathForProject(projectId) {
  return projectId ? `/studio/${encodeURIComponent(projectId)}` : '/studio';
}

/**
 * Tab remembered in a sessionStorage project state (`project_editing_states[id]`).
 * Version 1 states had no Introduction tab, so their indices shift up by one.
 */
export function savedAdminTab(savedState, { tabsVersion, maxTab }) {
  const value = Number(savedState?.tabValue);
  if (!Number.isInteger(value) || value < 0) return 0;
  let tab = value;
  if ((Number(savedState?.tabsVersion) || 1) < tabsVersion) tab += 1;
  return Math.min(tab, maxTab);
}
