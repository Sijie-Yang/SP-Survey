// Browser mirror of src/server/agentReview.js options (keep in sync).

export const REVIEW_ROLES = Object.freeze([
  { id: 'scientist', emoji: '🔬' },
  { id: 'participant', emoji: '👤' },
  { id: 'planner', emoji: '🏙️' },
  { id: 'psychologist', emoji: '🧠' },
  { id: 'analyst', emoji: '📊' },
]);

export const REVIEW_ROLE_IDS = Object.freeze(REVIEW_ROLES.map((role) => role.id));

export const DEFAULT_REVIEW_OPTIONS = Object.freeze({
  roles: REVIEW_ROLE_IDS,
  method: 'linear',
  maxRounds: 2,
  threshold: 8,
  applyMode: 'review',
  maxRoles: REVIEW_ROLE_IDS.length,
});

function clamp(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeClientReviewOptions(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const maxRoles = clamp(input.maxRoles, 1, REVIEW_ROLE_IDS.length, DEFAULT_REVIEW_OPTIONS.maxRoles);
  const requested = Array.isArray(input.roles) ? input.roles : DEFAULT_REVIEW_OPTIONS.roles;
  const roles = REVIEW_ROLE_IDS.filter((id) => requested.includes(id)).slice(0, maxRoles);
  return {
    roles: roles.length ? roles : [REVIEW_ROLE_IDS[0]],
    method: input.method === 'group' ? 'group' : 'linear',
    maxRounds: clamp(input.maxRounds, 1, 5, DEFAULT_REVIEW_OPTIONS.maxRounds),
    threshold: clamp(input.threshold, 1, 10, DEFAULT_REVIEW_OPTIONS.threshold),
    applyMode: input.applyMode === 'apply' ? 'apply' : 'review',
    maxRoles,
  };
}

export function reviewDefaultMessage(language = 'en') {
  return language === 'zh' ? '评审当前问卷。' : 'Review the current survey.';
}

export function reviewRoleLabel(roleId, t = {}) {
  const key = `aiReviewRole_${roleId}`;
  if (t[key]) return t[key];
  if (roleId === 'revision') return t.aiReviewRevision || 'Revision';
  return String(roleId || '').replace(/^./, (c) => c.toUpperCase());
}

export function reviewRoleEmoji(roleId) {
  return REVIEW_ROLES.find((role) => role.id === roleId)?.emoji || (roleId === 'revision' ? '🛠️' : '•');
}

/** Latest reviewer or revision step still running in a review run. */
export function activeReviewStep(events = []) {
  let active = null;
  for (const event of events) {
    const payload = event?.payload || {};
    if (event?.type === 'review.role') {
      active = payload.status === 'start' ? { round: payload.round, role: payload.role } : null;
    } else if (event?.type === 'review.revision') {
      active = payload.status === 'start' ? { round: payload.round, role: 'revision' } : null;
    } else if (event?.type === 'review.result') {
      active = null;
    }
  }
  return active;
}

export function formatUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return '';
  const n = Number(value);
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

export function formatTokens(value) {
  const n = Number(value || 0);
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}
