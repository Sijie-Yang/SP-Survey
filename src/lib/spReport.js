/**
 * SP-Report v1: a reporting checklist for perception experiments (studies
 * where people judge stimuli such as images, video or sound). The platform
 * fills what it can work out from the survey and the data; the rest is left
 * as a box for the authors. Pure functions, no model.
 */
import { flattenQuestions, getAttentionCheckQuestions } from './quality.js';

export const SP_REPORT_VERSION = '1';
export const SP_REPORT_URL = 'https://sp-survey.org/docs/sp-report';

/** The ten items, in order. `why` is shown in the docs page. */
export const SP_REPORT_ITEMS = Object.freeze([
  { id: 'stimuli', title: 'Stimuli', ask: 'How many stimuli, where they came from, and the terms that allow their use.', why: 'Perception depends on what was shown; others cannot reuse or compare results without knowing the stimulus set and its licence.' },
  { id: 'sampling', title: 'Participants and recruitment', ask: 'Who took part, how they were recruited, when, and how many.', why: 'Perception varies across people and places; the sample defines whose perception the results describe.' },
  { id: 'paradigm', title: 'Task paradigm', ask: 'The judgement task for each measure (pairwise choice, rating scale, ranking, slider, annotation) and the exact wording.', why: 'Different tasks measure different things; a pairwise "safer" choice is not the same quantity as a 1–7 safety rating.' },
  { id: 'exposure', title: 'Judgements per stimulus', ask: 'How many times each stimulus was judged (minimum, median, maximum).', why: 'Scores from a stimulus seen three times are far less certain than from one seen thirty times.' },
  { id: 'quality', title: 'Quality control', ask: 'Attention checks, speed and straight-lining rules, and how many submissions were excluded.', why: 'Exclusion rules change results and must be fixed before analysis to avoid selective reporting.' },
  { id: 'aggregation', title: 'Aggregation', ask: 'How individual judgements became per-stimulus scores (e.g. TrueSkill parameters, means with 95% CI).', why: 'The same raw choices give different rankings under different models.' },
  { id: 'demographics', title: 'Demographics', ask: 'Which demographic variables were collected and how they were used.', why: 'Lets readers judge representativeness and enables subgroup and persona analyses.' },
  { id: 'consent', title: 'Ethics and consent', ask: 'Ethics approval, informed consent, and whether participants agreed to data reuse or model training.', why: 'Required by journals and needed before data can be shared or used to train models.' },
  { id: 'synthetic', title: 'Synthetic respondents', ask: 'Whether any responses came from AI models ("silicon samples"), and how they were kept apart from human data.', why: 'Model-generated answers must never be mixed with human data without saying so.' },
  { id: 'availability', title: 'Data and materials availability', ask: 'Where the data, survey definition and analysis are deposited, with a DOI.', why: 'Makes the study reproducible and the data citable.' },
]);

const DEMOGRAPHIC_PATTERN = /\b(age|gender|sex|income|education|occupation|ethnic|race|nationality|resid|household|marital|employment)\w*|年龄|性别|收入|学历|教育|职业|民族|国籍|居住/i;
const CONSENT_PATTERN = /consent|agree|同意|知情/i;
const REUSE_PATTERN = /reuse|share|train|model|再利用|公开|训练/i;

const TASK_LABELS = {
  imagepicker: 'pairwise / multiple image choice',
  maxdiff: 'best–worst scaling',
  pairwise_slider: 'pairwise slider preference',
  image_ranking: 'image ranking',
  ranking: 'ranking',
  image_rating: 'per-image rating scale',
  image_slider: 'per-image slider ratings',
  image_matrix: 'per-image rating grid',
  image_boolean: 'per-image yes / no',
  image_checkbox: 'per-image multiple choice',
  image_points: 'per-image point allocation',
  points: 'point allocation',
  slider: 'slider',
  scalar: 'rating scale / numeric entry',
  choice: 'single / multiple choice',
  matrix: 'matrix (Likert grid)',
  boolean: 'yes / no',
  text: 'free text',
  annotation: 'image annotation',
  video_moments: 'video moment marking',
  continuous_video: 'continuous video rating',
  emotion_color: 'emotion–colour task',
  composite_blocks: 'custom interaction',
  skill: 'custom interaction',
};

function titleOf(q) {
  const t = q?.title;
  if (typeof t === 'string') return t;
  return t?.default || t?.en || Object.values(t || {})[0] || q?.name || '';
}

function hostOf(source) {
  const m = /^https?:\/\/([^/]+)/i.exec(String(source || ''));
  return m ? m[1] : 'uploaded / relative paths';
}

function nameList(names, max = 4) {
  return names.length > max ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function dateRange(responses) {
  const ts = (responses || [])
    .map((r) => Date.parse(r.created_at || r.survey_metadata?.completion_time || r.saved_at || ''))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!ts.length) return null;
  const d = (x) => new Date(x).toISOString().slice(0, 10);
  return d(ts[0]) === d(ts[ts.length - 1]) ? d(ts[0]) : `${d(ts[0])} to ${d(ts[ts.length - 1])}`;
}

/**
 * Fill the checklist.
 * @param {object} p
 * @param {object} p.surveyConfig
 * @param {object[]} p.responses        submissions in the export (after exclusions)
 * @param {object[]} [p.allResponses]   submissions before exclusions
 * @param {boolean} [p.excludeFlagged]
 * @param {{source:string,times_shown:number}[]} [p.stimuli]
 * @param {(q:object)=>string} [p.familyOf]  export family for a question
 * @param {boolean} [p.siliconCompared] a silicon run was compared with these data
 * @param {string} [p.doi]              dataset DOI if already deposited
 * @returns {{ id, title, ask, status: 'filled'|'partial'|'todo', text: string }[]}
 */
export function buildSpReport({
  surveyConfig, responses = [], allResponses = null, excludeFlagged = false, stimuli = [],
  familyOf = (q) => q?.type, siliconCompared = false, doi = '',
} = {}) {
  const questions = flattenQuestions(surveyConfig || {}).filter((q) => q?.name);
  const all = allResponses || responses;
  const out = {};
  const set = (id, status, text) => { out[id] = { status, text }; };

  // 1. Stimuli
  if (stimuli.length) {
    const hosts = new Map();
    stimuli.forEach((s) => hosts.set(hostOf(s.source), (hosts.get(hostOf(s.source)) || 0) + 1));
    const hostText = [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h, n]) => `${h} (${n})`).join(', ');
    set('stimuli', 'partial', `${stimuli.length} distinct stimuli were shown, served from ${hostText}; the full list is in the stimulus manifest. [ ] Add their original source and licence.`);
  } else {
    set('stimuli', 'todo', 'No stimuli were recorded in these data. [ ] Describe any stimuli shown, or state that none were used.');
  }

  // 2. Participants
  const participants = new Set(responses.map((r) => r.participant_id).filter(Boolean)).size;
  const range = dateRange(responses);
  set('sampling', 'partial', `${responses.length} submissions from ${participants || responses.length} participants${range ? `, collected ${range}` : ''}, online via SP-Survey. [ ] Add how participants were recruited and any inclusion criteria or payment.`);

  // 3. Paradigm (consent questions are not measures)
  const consentNames = new Set(questions
    .filter((q) => q.type === 'consent' || (q.type === 'boolean' && CONSENT_PATTERN.test(`${q.name} ${titleOf(q)}`)))
    .map((q) => q.name));
  const tasks = new Map();
  questions.forEach((q) => {
    const fam = familyOf(q) || q.type;
    if (['html', 'expression', 'image', 'mediadisplay'].includes(q.type) || consentNames.has(q.name)) return;
    const label = TASK_LABELS[fam] || TASK_LABELS[q.type] || fam;
    if (!tasks.has(label)) tasks.set(label, []);
    tasks.get(label).push(q.name);
  });
  set('paradigm', tasks.size ? 'filled' : 'todo', tasks.size
    ? `${[...tasks.entries()].map(([label, names]) => `${label} (${nameList(names)})`).join('; ')}. Exact wording is in the survey definition.`
    : '[ ] Describe the judgement task.');

  // 4. Exposure
  const counts = stimuli.map((s) => Number(s.times_shown) || 0).filter((n) => n > 0);
  if (counts.length) {
    set('exposure', 'filled', `Across all questions, each stimulus was shown ${Math.min(...counts)}–${Math.max(...counts)} times (median ${median(counts)}); per-question counts are in the stimulus manifest and summary tables.`);
  } else {
    set('exposure', stimuli.length ? 'todo' : 'filled', stimuli.length ? '[ ] Report how often each stimulus was judged.' : 'Not applicable: no stimuli were recorded.');
  }

  // 5. Quality
  const checks = getAttentionCheckQuestions(surveyConfig || {});
  const excluded = Math.max(0, all.length - responses.length);
  set('quality', 'filled', [
    checks.length ? `${checks.length} attention check(s) (${checks.map((q) => q.name).join(', ')}).` : 'No attention checks.',
    'Automatic flags: failed attention check, unusually fast completion, straight-lining, repeated browser.',
    excludeFlagged ? `Flagged submissions were excluded (${excluded} of ${all.length}).` : `Flagged submissions were kept (${all.length} analysed).`,
  ].join(' '));

  // 6. Aggregation
  const fams = new Set(questions.map((q) => familyOf(q)));
  const agg = [];
  if (fams.has('imagepicker') || fams.has('maxdiff') || fams.has('pairwise_slider')) agg.push('choices were converted to per-stimulus TrueSkill scores (μ, σ; defaults μ0 = 25, σ0 = 25/3), ties excluded');
  if (fams.has('image_ranking') || fams.has('ranking')) agg.push('rankings were scored with TrueSkill and Borda counts, agreement by Kendall’s W');
  if (['image_rating', 'image_slider', 'image_matrix', 'slider', 'scalar', 'continuous_video', 'points', 'image_points'].some((f) => fams.has(f))) agg.push('ratings were summarised per stimulus as mean, SD and 95% CI');
  if (['choice', 'matrix', 'boolean', 'image_boolean', 'image_checkbox'].some((f) => fams.has(f))) agg.push('categorical answers as counts and proportions');
  set('aggregation', agg.length ? 'filled' : 'todo', agg.length ? `${agg.join('; ')}. See methods.txt for the algorithm version.` : '[ ] Describe how answers were aggregated.');

  // 7. Demographics
  const demo = questions.filter((q) => DEMOGRAPHIC_PATTERN.test(`${q.name} ${titleOf(q)}`));
  set('demographics', demo.length ? 'partial' : 'filled', demo.length
    ? `Collected: ${nameList(demo.map((q) => q.name), 8)}. [ ] Say how they were used (description, weighting, subgroups).`
    : 'No demographic questions were asked.');

  // 8. Consent
  const consent = questions.filter((q) => q.type === 'consent' || (q.type === 'boolean' && CONSENT_PATTERN.test(`${q.name} ${titleOf(q)}`)));
  const reuse = consent.filter((q) => REUSE_PATTERN.test(`${q.name} ${titleOf(q)}`));
  set('consent', 'partial', [
    consent.length ? `Consent was recorded in the survey (${consent.map((q) => q.name).join(', ')}).` : 'No consent question was found in the survey.',
    reuse.length ? `Participants were asked about reuse (${reuse.map((q) => q.name).join(', ')}).` : '',
    '[ ] Add the ethics approval body and number.',
  ].filter(Boolean).join(' '));

  // 9. Synthetic
  const silicon = responses.filter((r) => r.source === 'silicon' || r.survey_metadata?.silicon_run_id).length;
  set('synthetic', 'filled', silicon
    ? `${silicon} of these submissions are silicon samples (AI personas) and are marked source = silicon.`
    : `All submissions are from human participants; no silicon samples are included.${siliconCompared ? ' A separate silicon-sample run was compared with them (silicon_agreement.csv).' : ''}`);

  // 10. Availability
  set('availability', doi ? 'filled' : 'todo', doi
    ? `Data, survey definition and documentation are deposited at https://doi.org/${doi}.`
    : '[ ] Deposit the data (Results → Export → Citable dataset package) and give the DOI.');

  return SP_REPORT_ITEMS.map((item) => ({ id: item.id, title: item.title, ask: item.ask, ...out[item.id] }));
}

const MARK = { filled: '[x]', partial: '[~]', todo: '[ ]' };

/** Plain-text block for README.txt / methods.txt. */
export function spReportLines(items) {
  return [
    `Reporting checklist (SP-Report v${SP_REPORT_VERSION}, ${SP_REPORT_URL})`,
    '[x] filled from the data   [~] partly filled, finish the bracketed part   [ ] for the authors',
    '',
    ...items.map((it, i) => `${MARK[it.status] || '[ ]'} ${i + 1}. ${it.title}: ${it.text}`),
  ];
}
