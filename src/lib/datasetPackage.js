/**
 * Citable dataset package: the full results export plus the files a data
 * repository (Zenodo, OSF, Dryad…) and a reader need — README, LICENSE,
 * CITATION.cff, datapackage.json, the survey as run and a stimulus manifest.
 * Everything is derived deterministically from the stored responses.
 */
import { buildResultsExportBundle, buildSiteResultsExportFiles, collectShownStimuli } from './questionSummaryExport.js';
import { platformCffReferenceLines, platformCitations } from './platformCitation.js';
import { buildResponsesWideCsv } from './responsesWideExport.js';
import { rowsToCsv, exportDateStamp } from './csvUtil.js';
import { downloadZip } from './zipDownload.js';
import { normalizeBooleanAnswer } from './responseAnswerUnits.js';
import { figureSvgFiles, figuresForSurvey } from './journalFigures.js';

export const DATASET_LICENSES = {
  'CC-BY-4.0': {
    name: 'Creative Commons Attribution 4.0 International',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    summary: 'You may share and adapt the data for any purpose, including commercially, as long as you give appropriate credit.',
    summaryZh: '任何人都可以分享和改编数据，包括商用，只要注明出处。',
  },
  'CC-BY-NC-4.0': {
    name: 'Creative Commons Attribution-NonCommercial 4.0 International',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
    summary: 'You may share and adapt the data for non-commercial purposes, as long as you give appropriate credit.',
    summaryZh: '可以分享和改编数据，但不能商用，并且要注明出处。',
  },
  'CC0-1.0': {
    name: 'Creative Commons Zero 1.0 Universal (public domain dedication)',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    summary: 'The authors waive all rights; the data may be used for any purpose without conditions.',
    summaryZh: '作者放弃全部权利，任何人可无条件使用。',
  },
};

export const DEFAULT_DATASET_META = {
  title: '',
  description: '',
  authors: [],
  keywords: [],
  version: '1.0',
  license: 'CC-BY-4.0',
  doi: '',
  anonymize: { pseudonymizeIds: true, dateOnly: true, dropFreeText: true },
  includeSurvey: true,
  includeImages: false,
  // Name of a yes/no question (e.g. "may your answers be reused?"): only
  // submissions answering yes are packed. Empty = every submission.
  onlyAgreedTo: '',
};

/** Saved form values merged over the defaults (older saves may lack fields). */
export function readDatasetMeta(project) {
  const saved = project?.metadata?.datasetRelease;
  const meta = { ...DEFAULT_DATASET_META, ...(saved && typeof saved === 'object' ? saved : {}) };
  meta.anonymize = { ...DEFAULT_DATASET_META.anonymize, ...(saved?.anonymize || {}) };
  if (!meta.title) meta.title = project?.name || '';
  if (!DATASET_LICENSES[meta.license]) meta.license = DEFAULT_DATASET_META.license;
  meta.authors = Array.isArray(meta.authors) ? meta.authors : [];
  meta.keywords = Array.isArray(meta.keywords) ? meta.keywords : [];
  return meta;
}

/** "Given Family; 0000-0002-1825-0097; Affiliation" per line → author objects. */
export function parseAuthorLines(text) {
  return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name = '', orcid = '', affiliation = ''] = line.split(';').map((s) => s.trim());
    return { name, orcid: normalizeOrcid(orcid), affiliation };
  }).filter((a) => a.name);
}

export function formatAuthorLines(authors) {
  return (authors || []).map((a) => {
    const parts = [a.name || '', a.orcid || '', a.affiliation || ''];
    while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
    return parts.join('; ');
  }).join('\n');
}

export function normalizeOrcid(raw) {
  const m = String(raw || '').match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
  return m ? m[1].toUpperCase() : '';
}

function splitName(name) {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0], given: '' };
  // "Yang, Sijie" or "Sijie Yang"
  if (name.includes(',')) {
    const [family, given] = name.split(',').map((s) => s.trim());
    return { family, given };
  }
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
}

// ── Anonymisation ───────────────────────────────────────────────────────────

const NON_FREE_TEXT_INPUTS = new Set(['number', 'range', 'date', 'datetime-local', 'time', 'month', 'week', 'color']);

/** Questions whose answers are typed text (names, e-mails, comments…). */
export function freeTextQuestionNames(questions) {
  return (questions || []).filter((q) => q?.name && (
    q.type === 'comment'
    || q.type === 'multipletext'
    || (q.type === 'text' && !NON_FREE_TEXT_INPUTS.has(q.inputType))
  )).map((q) => q.name);
}

const questionTitle = (q) => (typeof q.title === 'string' ? q.title : (q.title?.default || q.title?.en || '')) || q.name;

/** Optional yes/no questions that can gate reuse (a required consent gate cannot). */
export function reuseConsentQuestions(questions) {
  return (questions || [])
    .filter((q) => q?.name && q.type === 'boolean' && !q.isRequired)
    .map((q) => ({ name: q.name, title: questionTitle(q) }));
}

export function answeredYes(row, name) {
  const v = row?.responses?.[name] ?? row?.raw_responses?.[name];
  return normalizeBooleanAnswer(v) === 1;
}

// Device and recruitment fields that can identify a person.
const IDENTIFYING_METADATA = ['completion_code', 'browser_id', 'user_agent', 'screen_resolution', 'url_params', 'recruitment', 'ip', 'ip_hash'];
const IDENTIFYING_ROW_FIELDS = ['idempotency_key', 'user_id', 'email', 'ip', 'ip_hash'];
const TIMESTAMP_ROW_FIELDS = ['created_at', 'saved_at', 'updated_at'];
const TIMESTAMP_METADATA = ['completion_time', 'survey_draft_updated_at', 'start_time', 'started_at'];

function toDateOnly(value) {
  if (!value) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
}

const pad = (n) => String(n).padStart(4, '0');

/**
 * Returns a function that anonymises one response row. One instance per
 * package keeps participant/row pseudonyms consistent across every file.
 */
export function createAnonymizer(options = {}, questions = []) {
  const { pseudonymizeIds = false, dateOnly = false, dropFreeText = false } = options;
  const freeText = new Set(dropFreeText ? freeTextQuestionNames(questions) : []);
  const participants = new Map();
  const rows = new Map();
  const participantAlias = (id) => {
    if (!id) return id;
    if (!participants.has(id)) participants.set(id, `P${pad(participants.size + 1)}`);
    return participants.get(id);
  };
  const rowAlias = (id) => {
    if (id == null) return id;
    if (!rows.has(id)) rows.set(id, `R${pad(rows.size + 1)}`);
    return rows.get(id);
  };
  const stripAnswers = (answers) => {
    if (!answers || typeof answers !== 'object' || !freeText.size) return answers;
    const out = { ...answers };
    freeText.forEach((name) => { delete out[name]; });
    return out;
  };
  const transform = (row) => {
    if (!row || typeof row !== 'object') return row;
    const out = { ...row, responses: stripAnswers(row.responses), raw_responses: stripAnswers(row.raw_responses) };
    const meta = { ...(row.survey_metadata || {}) };
    if (pseudonymizeIds) {
      out.participant_id = participantAlias(row.participant_id);
      if ('id' in row) out.id = rowAlias(row.id);
      IDENTIFYING_ROW_FIELDS.forEach((k) => { delete out[k]; });
      IDENTIFYING_METADATA.forEach((k) => { delete meta[k]; });
    }
    if (dateOnly) {
      TIMESTAMP_ROW_FIELDS.forEach((k) => { if (out[k]) out[k] = toDateOnly(out[k]); });
      TIMESTAMP_METADATA.forEach((k) => { if (meta[k]) meta[k] = toDateOnly(meta[k]); });
    }
    out.survey_metadata = meta;
    return out;
  };
  transform.freeTextQuestions = [...freeText];
  return transform;
}

// ── Stimuli ─────────────────────────────────────────────────────────────────

/** Every stimulus that was shown, with how often and in which questions. */
export function collectStimuli(questions, responses, surveyConfig) {
  return collectShownStimuli(questions, responses, surveyConfig);
}

function uniquePath(name, used) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let i = 2; used.has(candidate.toLowerCase()); i += 1) candidate = `${stem}_${i}${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

async function sha256Hex(bytes) {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : null;
  if (!subtle) return '';
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetches each stimulus into stimuli/files/. Failures are listed in the
 * manifest (included=false) instead of stopping the package.
 */
export async function fetchStimulusFiles(stimuli, { fetchImpl = typeof fetch === 'function' ? fetch : null, resolveUrl = (s) => s, onProgress } = {}) {
  const used = new Set();
  const files = [];
  const rows = [];
  for (let i = 0; i < stimuli.length; i += 1) {
    const s = stimuli[i];
    const url = resolveUrl(s.source);
    let included = false;
    let sha256 = '';
    let path = '';
    let note = '';
    if (url && /^(https?:|blob:|data:)/.test(url) && fetchImpl) {
      try {
        const res = await fetchImpl(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        path = `stimuli/files/${uniquePath(s.file_name || `stimulus_${i + 1}`, used)}`;
        sha256 = await sha256Hex(bytes);
        files.push({ path, content: bytes });
        included = true;
      } catch (err) {
        note = `not downloaded: ${err?.message || err}`;
      }
    } else {
      note = 'no downloadable URL';
    }
    rows.push({ ...s, included, path, sha256, note });
    onProgress?.(i + 1, stimuli.length);
  }
  return { files, rows };
}

export function buildStimuliManifestCsv(rows) {
  const header = ['file_name', 'source', 'times_shown', 'questions', 'included', 'path_in_package', 'sha256', 'note'];
  return rowsToCsv([header, ...rows.map((r) => [
    r.file_name, r.source, r.times_shown, (r.questions || []).join('|'),
    r.included ? 'true' : 'false', r.path || '', r.sha256 || '', r.note || '',
  ])]);
}

// ── Descriptive files ───────────────────────────────────────────────────────

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

export function buildCitationCff(meta, { releaseDate = exportDateStamp(), url = '' } = {}) {
  const license = DATASET_LICENSES[meta.license] ? meta.license : DEFAULT_DATASET_META.license;
  const lines = [
    'cff-version: 1.2.0',
    'message: "If you use this dataset, please cite it as below."',
    'type: dataset',
    `title: ${yamlString(meta.title || 'Untitled dataset')}`,
    'authors:',
  ];
  const authors = meta.authors?.length ? meta.authors : [{ name: 'Anonymous' }];
  authors.forEach((a) => {
    const { family, given } = splitName(a.name);
    lines.push(`  - family-names: ${yamlString(family)}`);
    if (given) lines.push(`    given-names: ${yamlString(given)}`);
    if (a.orcid) lines.push(`    orcid: ${yamlString(`https://orcid.org/${a.orcid}`)}`);
    if (a.affiliation) lines.push(`    affiliation: ${yamlString(a.affiliation)}`);
  });
  lines.push(`version: ${yamlString(meta.version || '1.0')}`);
  lines.push(`date-released: ${releaseDate}`);
  lines.push(`license: ${license}`);
  if (meta.doi) lines.push(`doi: ${yamlString(meta.doi)}`);
  if (url) lines.push(`url: ${yamlString(url)}`);
  if (meta.description) lines.push(`abstract: ${yamlString(meta.description)}`);
  if (meta.keywords?.length) {
    lines.push('keywords:');
    meta.keywords.forEach((k) => lines.push(`  - ${yamlString(k)}`));
  }
  lines.push('references:', ...platformCffReferenceLines());
  return `${lines.join('\n')}\n`;
}

export function buildLicenseText(meta, { year = new Date().getFullYear() } = {}) {
  const lic = DATASET_LICENSES[meta.license] || DATASET_LICENSES[DEFAULT_DATASET_META.license];
  const holders = (meta.authors || []).map((a) => a.name).filter(Boolean).join(', ') || 'The dataset authors';
  return [
    `${meta.title || 'This dataset'}`,
    `Copyright (c) ${year} ${holders}`,
    '',
    `This dataset is licensed under the ${lic.name} license (${meta.license}).`,
    lic.summary,
    '',
    `Full legal text: ${lic.url}legalcode`,
    '',
    'The license covers the response data and documentation in this package.',
    'Stimulus images keep the terms of their original source (see stimuli/manifest.csv);',
    'they are included only where the authors chose to and were allowed to redistribute them.',
    '',
  ].join('\n');
}

function csvHeader(csv) {
  const text = String(csv || '').replace(/^﻿/, '');
  const first = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { first.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') break;
    else cell += ch;
  }
  first.push(cell);
  return first.filter((h, i) => h || i < first.length - 1);
}

/** Frictionless Data Package descriptor (https://specs.frictionlessdata.io). */
export function buildDatapackageJson(meta, { files, wideCsv, questions = [], releaseDate = exportDateStamp() }) {
  const titleByName = new Map((questions || []).map((q) => [q.name, typeof q.title === 'string' ? q.title : (q.title?.default || q.title?.en || '')]));
  const describe = (column) => {
    const base = column.split('__')[0];
    return titleByName.get(column) || titleByName.get(base) || undefined;
  };
  const resourceFor = (path) => {
    const name = path.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
    const format = (path.split('.').pop() || '').toLowerCase();
    const res = { name, path, format, ...(format === 'csv' ? { mediatype: 'text/csv', encoding: 'utf-8' } : {}) };
    if (path === 'data/responses_wide.csv' && wideCsv) {
      res.description = 'One row per submission, one column per recorded answer.';
      res.schema = { fields: csvHeader(wideCsv).map((col) => ({ name: col, type: 'string', ...(describe(col) ? { description: describe(col) } : {}) })) };
    }
    return res;
  };
  const resources = files
    .map((f) => f.path)
    .filter((p) => /\.(csv|json)$/i.test(p) && p !== 'datapackage.json')
    .map(resourceFor);
  const lic = DATASET_LICENSES[meta.license] || DATASET_LICENSES[DEFAULT_DATASET_META.license];
  const pkg = {
    profile: 'data-package',
    name: String(meta.title || 'sp-survey-dataset').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'sp-survey-dataset',
    title: meta.title || undefined,
    description: meta.description || undefined,
    version: meta.version || '1.0',
    created: `${releaseDate}T00:00:00Z`,
    ...(meta.doi ? { id: `https://doi.org/${meta.doi}` } : {}),
    licenses: [{ name: meta.license, path: lic.url, title: lic.name }],
    contributors: (meta.authors || []).map((a) => ({
      title: a.name,
      role: 'author',
      ...(a.orcid ? { path: `https://orcid.org/${a.orcid}` } : {}),
      ...(a.affiliation ? { organization: a.affiliation } : {}),
    })),
    keywords: meta.keywords?.length ? meta.keywords : undefined,
    sources: [{ title: 'Collected with SP-Survey', path: 'https://sp-survey.org' }],
    resources,
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function buildDatasetReadme(meta, {
  project, nSubmissions, nParticipants, dateRange, questions = [], siteConverted = false,
  freeTextDropped = [], reuseFilter = null, stimuli = { total: 0, included: 0 }, includeSurvey = true, releaseDate = exportDateStamp(),
}) {
  const lic = DATASET_LICENSES[meta.license] || DATASET_LICENSES[DEFAULT_DATASET_META.license];
  const authors = (meta.authors || []).map((a) => `${a.name}${a.orcid ? ` (ORCID ${a.orcid})` : ''}${a.affiliation ? `, ${a.affiliation}` : ''}`);
  const authorShort = (meta.authors || []).map((a) => splitName(a.name).family).filter(Boolean);
  const citeAuthors = authorShort.length > 2 ? `${authorShort[0]} et al.` : authorShort.join(' & ') || 'Anonymous';
  const year = releaseDate.slice(0, 4);
  const a = meta.anonymize || {};
  const lines = [
    `# ${meta.title || project?.name || 'SP-Survey dataset'}`,
    '',
    meta.description || '_No description given._',
    '',
    '## Citation',
    '',
    `${citeAuthors} (${year}). *${meta.title || 'SP-Survey dataset'}* (Version ${meta.version || '1.0'}) [Data set]. ${meta.doi ? `https://doi.org/${meta.doi}` : 'Collected with SP-Survey, https://sp-survey.org.'}`,
    '',
    'Machine-readable citation: `CITATION.cff`.',
    '',
    `Please also cite the platform the data were collected with: ${platformCitations().apa}`,
    '',
    '## Authors',
    '',
    ...(authors.length ? authors.map((x) => `- ${x}`) : ['- (not given)']),
    '',
    '## Overview',
    '',
    `- Submissions: ${nSubmissions}`,
    `- Participants: ${nParticipants}`,
    `- Collection period: ${dateRange || 'unknown'}`,
    `- Questions: ${questions.length}`,
    `- Stimuli shown: ${stimuli.total}${stimuli.total ? ` (${stimuli.included} included as files)` : ''}`,
    `- License: ${lic.name} (${meta.license}), ${lic.url}`,
    ...(meta.keywords?.length ? [`- Keywords: ${meta.keywords.join(', ')}`] : []),
    '',
    '## Files',
    '',
    '| Path | Contents |',
    '| --- | --- |',
    '| `data/responses_wide.csv` | One row per submission, one column per recorded answer |',
    '| `data/responses_raw.json` | Every submission as stored (after the anonymisation below) |',
    ...(siteConverted ? [] : [
      '| `data/questions/` | Per-question long tables and summaries (rankings, means, agreement) |',
      '| `data/data_dictionary.json` | What every column means, per question |',
      '| `data/data_quality.csv` | Quality flags per submission |',
      '| `data/methods.txt` | Auto-generated methods paragraph |',
      '| `data/figures/` | Journal-style figures (SVG) with suggested captions |',
    ]),
    '| `data/README.txt` | Column-level layout of the data folder |',
    ...(includeSurvey ? ['| `survey/survey.json` | The survey definition as run; import it into SP-Survey to reproduce the study |'] : []),
    '| `stimuli/manifest.csv` | Every stimulus shown: file name, source, times shown, questions, SHA-256 when included |',
    ...(stimuli.included ? ['| `stimuli/files/` | The stimulus image files |'] : []),
    '| `datapackage.json` | Frictionless Data Package descriptor |',
    '| `CITATION.cff` | Citation metadata |',
    '| `LICENSE` | License terms |',
    '',
    '## Anonymisation',
    '',
    a.pseudonymizeIds
      ? '- Participant and submission identifiers were replaced with P0001… / R0001… codes. Completion codes, browser identifiers, user agents, screen sizes and URL parameters (e.g. recruitment IDs) were removed.'
      : '- Participant identifiers are as recorded by the platform (random IDs, not names).',
    a.dateOnly ? '- Timestamps were reduced to the date (YYYY-MM-DD).' : '- Timestamps are as recorded (UTC).',
    a.dropFreeText
      ? (freeTextDropped.length
        ? `- Typed free-text answers were removed: ${freeTextDropped.join(', ')}.`
        : '- No free-text questions were found, so nothing was removed.')
      : '- Free-text answers are included as typed.',
    ...(reuseFilter ? [`- Only submissions that answered yes to "${reuseFilter.title}" are included (${reuseFilter.kept} of ${reuseFilter.total}).`] : []),
    ...(siteConverted ? ['- This survey is a researcher-built page; anything the page itself stored is kept as recorded under `__sp_page_state` / `__sp_requests`. Review it before publishing.'] : []),
    '',
    '## Stimuli',
    '',
    stimuli.included
      ? 'Stimulus files are included under `stimuli/files/`. Check that their source allows redistribution before publishing.'
      : 'Stimulus files are not included. `stimuli/manifest.csv` lists each file name and source so the images can be obtained from their original provider.',
    '',
    '## Collection',
    '',
    'Data were collected online with SP-Survey (https://sp-survey.org), an open platform for image-based perception surveys. See `data/methods.txt` for the design and analysis settings, and the survey definition for the exact wording participants saw, including any consent page.',
    '',
    `Package generated by SP-Survey on ${releaseDate}.`,
    '',
  ];
  return lines.join('\n');
}

function dateRangeOf(responses) {
  const days = (responses || [])
    .map((r) => r.created_at || r.survey_metadata?.completion_time)
    .filter(Boolean)
    .map((d) => toDateOnly(d))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (!days.length) return '';
  return days[0] === days[days.length - 1] ? days[0] : `${days[0]} to ${days[days.length - 1]}`;
}

/** Survey JSON without the platform's private build fields. */
function surveyForPackage(surveyConfig) {
  if (!surveyConfig || typeof surveyConfig !== 'object') return null;
  const out = { ...surveyConfig };
  Object.keys(out).forEach((k) => { if (/^_sp/.test(k) || /^(ownResponseSupabase|supabase|apiKey|secret)/i.test(k)) delete out[k]; });
  return out;
}

/**
 * All files of the package, paths relative to the package folder.
 * `stimulusFiles` are the already-fetched stimuli (see fetchStimulusFiles).
 */
export function buildDatasetPackageFiles({
  meta,
  project,
  surveyConfig,
  questions,
  filteredResponses,
  dateFilteredResponses,
  filters,
  excludeFlagged,
  report = null,
  aiAnalysisFiles = [],
  siteConverted = false,
  stimulusRows = null,
  stimulusFiles = [],
  releaseDate = exportDateStamp(),
}) {
  const gate = meta.onlyAgreedTo ? reuseConsentQuestions(questions).find((q) => q.name === meta.onlyAgreedTo) : null;
  const agreed = (list) => (gate ? (list || []).filter((r) => answeredYes(r, gate.name)) : (list || []));
  const selected = agreed(filteredResponses);
  const reuseFilter = gate ? { title: gate.title, kept: selected.length, total: (filteredResponses || []).length } : null;
  const anonymize = createAnonymizer(meta.anonymize, questions);
  const rows = selected.map(anonymize);
  // Same pseudonyms for the broader (date-only filtered) set used by data_quality.csv.
  const included = new Map(selected.map((r, i) => [r, rows[i]]));
  const broader = agreed(dateFilteredResponses || filteredResponses).map((r) => included.get(r) || anonymize(r));
  const keptQuestions = (questions || []).filter((q) => !anonymize.freeTextQuestions.includes(q.name));
  const wideCsv = buildResponsesWideCsv(rows, keptQuestions, surveyConfig);

  const dataFiles = siteConverted
    ? buildSiteResultsExportFiles({ project, filteredResponses: rows, wideCsv, aiAnalysisFiles })
    : buildResultsExportBundle({
      project, surveyConfig, questions: keptQuestions, filteredResponses: rows, dateFilteredResponses: broader,
      filters, excludeFlagged, wideCsv, report, aiAnalysisFiles, datasetDoi: meta.doi || '',
      figureFiles: figureSvgFiles(figuresForSurvey(keptQuestions, rows), { projectName: meta.title || project?.name || '' }),
    });

  const stimuli = stimulusRows || collectStimuli(keptQuestions, rows, surveyConfig);
  const files = [
    ...dataFiles.map((f) => ({ ...f, path: `data/${f.path}` })),
    { path: 'stimuli/manifest.csv', content: buildStimuliManifestCsv(stimuli) },
    ...stimulusFiles,
  ];
  const survey = meta.includeSurvey !== false ? surveyForPackage(surveyConfig) : null;
  if (survey) files.push({ path: 'survey/survey.json', content: `${JSON.stringify(survey, null, 2)}\n` });

  const nParticipants = new Set(rows.map((r) => r.participant_id).filter(Boolean)).size;
  files.unshift(
    { path: 'README.md', content: buildDatasetReadme(meta, {
      project,
      nSubmissions: rows.length,
      nParticipants,
      dateRange: dateRangeOf(rows),
      questions: keptQuestions,
      siteConverted,
      freeTextDropped: anonymize.freeTextQuestions,
      reuseFilter,
      stimuli: { total: stimuli.length, included: stimuli.filter((s) => s.included).length },
      includeSurvey: !!survey,
      releaseDate,
    }) },
    { path: 'LICENSE', content: buildLicenseText(meta, { year: Number(releaseDate.slice(0, 4)) || undefined }) },
    { path: 'CITATION.cff', content: buildCitationCff(meta, { releaseDate }) },
  );
  files.push({ path: 'datapackage.json', content: buildDatapackageJson(meta, { files, wideCsv, questions: keptQuestions, releaseDate }) });
  return files;
}

export function datasetFolderName(meta, project) {
  const slug = String(meta.title || project?.name || project?.id || 'dataset')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'dataset';
  return `${slug}_v${String(meta.version || '1.0').replace(/[^0-9a-z.]+/gi, '')}_${exportDateStamp()}`;
}

export function downloadDatasetPackage(opts) {
  const folder = datasetFolderName(opts.meta, opts.project);
  const files = buildDatasetPackageFiles(opts).map((f) => ({ path: `${folder}/${f.path}`, content: f.content }));
  downloadZip(`${folder}.zip`, files);
  return files.length;
}
