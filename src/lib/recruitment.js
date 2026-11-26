// Recruitment platforms (Prolific, CloudResearch Connect, any other panel).
// One project setting, `recruitment`, decides three deterministic things:
//   1. which link parameters identify the participant (recorded as survey_metadata.recruitment),
//   2. where a participant who arrived from the platform is sent back after the answers are saved,
//   3. that the same platform participant cannot submit the same project twice.
// Nothing here depends on a model; every rule is plain code with tests.

export const RECRUITMENT_PLATFORMS = ['prolific', 'connect', 'other'];

const PARAM_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_MAX = 128;

export const PROLIFIC_RETURN_BASE = 'https://app.prolific.com/submissions/complete';

/**
 * Per-platform constants. `linkSuffix` is what the researcher pastes after the survey link on the
 * platform (the platform replaces the {{%…%}} placeholders); Connect adds its own parameters.
 */
export const PLATFORM_PRESETS = {
  prolific: {
    label: 'Prolific',
    idParam: 'PROLIFIC_PID',
    extraParams: { study: 'STUDY_ID', session: 'SESSION_ID' },
    linkSuffix: 'PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}',
  },
  connect: {
    label: 'CloudResearch Connect',
    idParam: 'participantId',
    extraParams: { study: 'projectId', session: 'assignmentId' },
    linkSuffix: '',
  },
  other: {
    label: 'Other platform',
    idParam: '',
    extraParams: {},
    linkSuffix: '',
  },
};

export function cleanCode(value) {
  const v = String(value ?? '').trim();
  return CODE_RE.test(v) ? v : '';
}

/** Only http(s) links; anything else (javascript:, data:, typos) is dropped. */
export function cleanReturnUrl(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  try {
    const url = new URL(v.replace(/\{id\}/g, 'ID'));
    return url.protocol === 'https:' || url.protocol === 'http:' ? v : '';
  } catch {
    return '';
  }
}

/** The stored setting, cleaned; null when no platform is chosen. */
export function normalizeRecruitment(config) {
  const r = config?.recruitment;
  if (!r || typeof r !== 'object' || !RECRUITMENT_PLATFORMS.includes(r.platform)) return null;
  const out = { platform: r.platform };
  if (r.platform === 'prolific') {
    out.completionCode = cleanCode(r.completionCode);
    out.quotaFullCode = cleanCode(r.quotaFullCode);
  } else {
    out.returnUrl = cleanReturnUrl(r.returnUrl);
  }
  if (r.platform === 'other') {
    const p = String(r.idParam ?? '').trim();
    out.idParam = PARAM_RE.test(p) ? p : '';
  }
  return out;
}

export function recruitmentIdParam(setting) {
  if (!setting) return '';
  return setting.platform === 'other' ? setting.idParam || '' : PLATFORM_PRESETS[setting.platform].idParam;
}

/** What a researcher still has to fill in; empty when the setting is complete. */
export function recruitmentMissing(setting) {
  if (!setting) return [];
  const missing = [];
  if (setting.platform === 'prolific' && !setting.completionCode) missing.push('completionCode');
  if (setting.platform === 'connect' && !setting.returnUrl) missing.push('returnUrl');
  if (setting.platform === 'other' && !setting.idParam) missing.push('idParam');
  return missing;
}

const cleanId = (v) => {
  const s = String(v ?? '').trim();
  // eslint-disable-next-line no-control-regex
  return s && s.length <= ID_MAX && !/[\u0000-\u001f]/.test(s) ? s : '';
};

/**
 * The platform participant who opened this link, or null when the link carries no platform id
 * (a researcher testing the plain link, or someone who found it elsewhere).
 */
export function readRecruitmentContext(setting, search = '') {
  if (!setting) return null;
  const idParam = recruitmentIdParam(setting);
  if (!idParam) return null;
  const params = new URLSearchParams(search || '');
  const id = cleanId(params.get(idParam));
  if (!id) return null;
  const out = { platform: setting.platform, id };
  const extras = PLATFORM_PRESETS[setting.platform].extraParams;
  Object.entries(extras).forEach(([key, name]) => {
    const v = cleanId(params.get(name));
    if (v) out[key] = v;
  });
  return out;
}

/**
 * Where to send the participant back to, or '' to stay on the page.
 * outcome: 'complete' (answers saved) or 'quota_full' (survey closed before starting).
 */
export function recruitmentReturnUrl(setting, context, outcome = 'complete') {
  if (!setting || !context?.id || recruitmentMissing(setting).length) return '';
  if (setting.platform === 'prolific') {
    const code = outcome === 'quota_full' ? setting.quotaFullCode : setting.completionCode;
    return code ? `${PROLIFIC_RETURN_BASE}?cc=${encodeURIComponent(code)}` : '';
  }
  if (outcome !== 'complete' || !setting.returnUrl) return '';
  return setting.returnUrl.replace(/\{id\}/g, encodeURIComponent(context.id));
}

/** The code a participant may need to paste by hand (Prolific only; other platforms use the link). */
export function recruitmentCodeFor(setting, outcome = 'complete') {
  if (setting?.platform !== 'prolific') return '';
  return outcome === 'quota_full' ? setting.quotaFullCode : setting.completionCode;
}

/**
 * The study link to paste on the platform. Placeholders stay literal ({{%PROLIFIC_PID%}}),
 * so the query string is joined by hand rather than through URLSearchParams.
 */
export function platformStudyLink(baseUrl, setting) {
  if (!baseUrl) return '';
  const suffix = setting ? PLATFORM_PRESETS[setting.platform]?.linkSuffix : '';
  if (!suffix) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${suffix}`;
}

/** survey_metadata.recruitment for a saved response. */
export function recruitmentMetadata(context) {
  if (!context?.id) return {};
  return { recruitment: { ...context, outcome: 'complete' } };
}

// Remembers, per browser, that this platform participant already finished, so a reload shows
// the same "done" page even before the server check answers.
const doneKey = (projectId) => `sp_recruitment_done_${projectId || 'default'}`;

export function rememberRecruitmentDone(projectId, context) {
  if (!context?.id) return;
  try {
    const list = JSON.parse(localStorage.getItem(doneKey(projectId)) || '[]');
    const key = `${context.platform}:${context.id}`;
    if (!list.includes(key)) localStorage.setItem(doneKey(projectId), JSON.stringify([...list, key].slice(-50)));
  } catch { /* private mode */ }
}

export function recruitmentDoneHere(projectId, context) {
  if (!context?.id) return false;
  try {
    return JSON.parse(localStorage.getItem(doneKey(projectId)) || '[]').includes(`${context.platform}:${context.id}`);
  } catch {
    return false;
  }
}
