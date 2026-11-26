/**
 * Journal-ready Methods sections, written from the survey definition and the
 * data by fixed templates (no language model). Three house styles for the
 * journals most perception studies go to, plus a neutral one:
 *
 *   epb   Environment and Planning B (SAGE): SAGE Harvard citations "(Herbrich et al. 2007)",
 *         British spelling, unnumbered headings.
 *   ceus  Computers, Environment and Urban Systems (Elsevier): "(Herbrich et al., 2007)",
 *         numbered headings, a software/code availability statement.
 *
 * The platform is cited as software until its paper is published (see
 * platformCitation.js), then as the paper.
 *   lup   Landscape and Urban Planning (Elsevier): as CEUS plus the ethics and data
 *         statements the journal asks for.
 *
 * Whatever the platform cannot know (recruitment, payment, ethics number) is
 * left as a [bracketed] placeholder. The researcher edits the result.
 */
import { PLATFORM_PAPER, PLATFORM_SOFTWARE_AUTHORS, PLATFORM_URL, PLATFORM_VERSION, platformDois, platformInText } from './platformCitation.js';
import { ANALYSIS_ALGORITHM_VERSION } from './analysisVersion.js';
import { flattenQuestions, getAttentionCheckQuestions } from './quality.js';

// Sampling mode as the platform runs it: anything other than 'random' is balanced.
const samplingModeOf = (q) => (q?.pairingMode && q.pairingMode !== 'random' ? 'balanced' : 'random');

export const JOURNAL_STYLES = Object.freeze({
  epb: { id: 'epb', label: 'Environment and Planning B (SAGE)', short: 'EPB', publisher: 'sage', british: true, numbered: false, statements: ['data'] },
  ceus: { id: 'ceus', label: 'Computers, Environment and Urban Systems (Elsevier)', short: 'CEUS', publisher: 'elsevier', british: false, numbered: true, statements: ['data', 'code'] },
  lup: { id: 'lup', label: 'Landscape and Urban Planning (Elsevier)', short: 'LUP', publisher: 'elsevier', british: false, numbered: true, statements: ['ethics', 'data', 'code'] },
  generic: { id: 'generic', label: 'Generic (APA-style citations)', short: 'Generic', publisher: 'apa', british: false, numbered: false, statements: ['data'] },
});

const TYPE_WORDS = {
  radiogroup: 'single-choice', checkbox: 'multiple-choice', dropdown: 'drop-down', matrix: 'Likert-grid', comment: 'open-text',
  text: 'short-text', number: 'numeric', boolean: 'yes/no', ranking: 'ranking', pointallocation: 'point-allocation',
  imagecheckbox: 'image multiple-choice', imageranking: 'image-ranking', imagematrix: 'image rating-grid', imageboolean: 'image yes/no',
  imageannotation: 'image-annotation', imagepointallocation: 'image point-allocation', skillquestion: 'custom interactive',
};
const CONSENT_PATTERN = /consent|agree|同意|知情/i;
const DISPLAY_TYPES = new Set(['html', 'expression', 'image', 'mediadisplay']);
const PAIRWISE_TYPES = new Set(['imagepicker', 'mediapicker']);
const RATING_TYPES = new Set(['imagerating', 'mediarating', 'rating']);
const SLIDER_TYPES = new Set(['imageslidergroup', 'mediaslidergroup', 'slidergroup']);

const BRITISH = [
  [/\banalyz/g, 'analys'], [/\bAnalyz/g, 'Analys'], [/\brandomiz/g, 'randomis'], [/\bRandomiz/g, 'Randomis'],
  [/\bsummariz/g, 'summaris'], [/\bminimiz/g, 'minimis'], [/\bbehavior/g, 'behaviour'], [/\bcolor/g, 'colour'],
  [/\bcenter/g, 'centre'], [/\bprogram\b/g, 'programme'], [/\borganiz/g, 'organis'], [/\bcategoriz/g, 'categoris'],
  [/\bnormaliz/g, 'normalis'], [/\bstandardiz/g, 'standardis'],
];

/** British spelling outside quoted question titles and URLs. */
export function britishSpelling(text) {
  return String(text).split(/("[^"\n]*"|https?:\/\/\S+)/).map((part, i) => (i % 2 ? part : BRITISH.reduce((t, [re, to]) => t.replace(re, to), part))).join('');
}

function titleOf(q) {
  const t = q?.title;
  if (typeof t === 'string') return t;
  return t?.default || t?.en || Object.values(t || {})[0] || q?.name || '';
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function listText(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function groupBy(list, keyOf) {
  const m = new Map();
  list.forEach((x) => {
    const k = keyOf(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  });
  return [...m.values()];
}

function quoted(items, max = 4) {
  const titles = items.map((x) => `"${x.title}"`);
  return titles.length > max ? `${titles.slice(0, 3).join(', ')} and ${titles.length - 3} others` : listText(titles);
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function numberWord(n) {
  return NUMBER_WORDS[n] || String(n);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dateRange(responses) {
  const ts = (responses || []).map((r) => Date.parse(r.created_at || r.survey_metadata?.completion_time || '')).filter(Number.isFinite).sort((a, b) => a - b);
  if (!ts.length) return null;
  const fmt = (x) => new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const a = fmt(ts[0]);
  const b = fmt(ts[ts.length - 1]);
  return a === b ? `on ${a}` : `between ${a} and ${b}`;
}

function completionMinutes(responses) {
  const mins = (responses || []).map((r) => {
    const start = Date.parse(r.survey_metadata?.start_time || r.survey_metadata?.started_at || '');
    const end = Date.parse(r.survey_metadata?.completion_time || r.created_at || '');
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60000 : null;
  }).filter((m) => m != null && m < 600).sort((a, b) => a - b);
  if (mins.length < 3) return null;
  const mid = Math.floor(mins.length / 2);
  return mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2;
}

/** Facts the paragraphs are written from. */
export function methodsFacts({ surveyConfig, responses = [], allResponses = null, excludeFlagged = true, stimuli = [], templateMeta = null }) {
  const questions = flattenQuestions(surveyConfig || {}).filter((q) => q?.name);
  const all = allResponses || responses;
  const measures = questions.filter((q) => !DISPLAY_TYPES.has(q.type) && q.type !== 'consent' && !(q.type === 'boolean' && CONSENT_PATTERN.test(`${q.name} ${titleOf(q)}`)));
  const pairwise = measures.filter((q) => PAIRWISE_TYPES.has(q.type));
  const ratings = measures.filter((q) => RATING_TYPES.has(q.type));
  const sliders = measures.filter((q) => SLIDER_TYPES.has(q.type));
  const imageQuestions = measures.filter((q) => /^(image|media)/.test(q.type));
  const counts = stimuli.map((s) => Number(s.times_shown) || 0).filter((n) => n > 0).sort((a, b) => a - b);
  // "Balanced" is only claimed when it really ran: every response got its number from the server.
  // (Before any response exists, the text describes the configured plan.)
  const balancedRan = !all.length || all.every((r) => r?.survey_metadata?.balanced_draw?.claim === 'server');
  return {
    title: surveyConfig?.title || '',
    nQuestions: measures.length,
    pairwise: pairwise.map((q) => ({ name: q.name, title: titleOf(q), trials: Number(q.trialCount) || null, images: Number(q.imageCount) || 2, tie: !!q.allowTie, pairing: balancedRan ? samplingModeOf(q) : 'random' })),
    ratings: ratings.map((q) => ({ name: q.name, title: titleOf(q), min: q.rateMin ?? 1, max: q.rateMax ?? 5, minLabel: q.minRateDescription || '', maxLabel: q.maxRateDescription || '', trials: Number(q.trialCount) || null, image: q.type !== 'rating' })),
    sliders: sliders.map((q) => ({ name: q.name, title: titleOf(q), dims: (q.dimensions || []).map((d) => d.label || d.id), min: q.scaleMin ?? 0, max: q.scaleMax ?? 100 })),
    otherTypes: [...new Set(measures.filter((q) => !pairwise.includes(q) && !ratings.includes(q) && !sliders.includes(q)).map((q) => q.type))],
    imageQuestions: imageQuestions.length,
    consent: questions.some((q) => q.type === 'consent' || (q.type === 'boolean' && CONSENT_PATTERN.test(`${q.name} ${titleOf(q)}`))),
    attentionChecks: getAttentionCheckQuestions(surveyConfig || {}).length,
    conditions: Array.isArray(surveyConfig?.conditions) && surveyConfig.conditions.length > 1 ? surveyConfig.conditions.map((c) => c.label || c.id) : [],
    nStimuli: stimuli.length,
    exposure: counts.length ? { min: counts[0], max: counts[counts.length - 1], median: counts[Math.floor(counts.length / 2)] } : null,
    nRecorded: all.length,
    nRetained: responses.length,
    nExcluded: Math.max(0, all.length - responses.length),
    excludeFlagged,
    nParticipants: new Set(responses.map((r) => r.participant_id).filter(Boolean)).size || responses.length,
    dates: dateRange(all),
    medianMinutes: completionMinutes(responses),
    silicon: responses.filter((r) => r.source === 'silicon' || r.survey_metadata?.silicon_run_id).length,
    template: templateMeta?.name ? { name: templateMeta.name, author: templateMeta.author || '', year: templateMeta.year || '' } : null,
  };
}

function platformCite(style) {
  const { author, year } = platformInText();
  if (!author) return `(${year})`;
  if (style.publisher === 'sage') return `(${author} ${year})`;
  return `(${author}, ${year})`;
}

function trueskillCite(style) {
  if (style.publisher === 'sage') return '(Herbrich et al. 2007)';
  return '(Herbrich et al., 2007)';
}

function heading(style, n, text, level = 2) {
  if (!style.numbered) return `${'#'.repeat(level)} ${text}`;
  return `${'#'.repeat(level)} ${n} ${text}`;
}

/**
 * Markdown Methods section in the given style.
 * Returns { style, markdown, references }.
 */
export function renderJournalMethods(facts, styleId = 'generic', { doi = '' } = {}) {
  const style = JOURNAL_STYLES[styleId] || JOURNAL_STYLES.generic;
  const f = facts;
  const s = (n) => (style.numbered ? `2.${n}.` : '');
  const parts = [];
  parts.push(style.numbered ? '# 2. Methods' : '# Methods');
  parts.push('<!-- Generated by SP-Survey from the survey definition and the data. Edit before submission; text in [brackets] needs your input. -->');

  // Instrument
  parts.push(heading(style, s(1), 'Survey instrument'));
  const instrument = [];
  instrument.push(`The survey${f.title ? ` ("${f.title}")` : ''} was built and administered with SP-Survey ${platformCite(style)}, an open-source platform for visual perception surveys (version ${PLATFORM_VERSION}; ${PLATFORM_URL}).`);
  if (f.template) instrument.push(`Its design follows ${f.template.author || 'a published study'}${f.template.year ? ` (${f.template.year})` : ''}, adapted from the platform's "${f.template.name}" template.`);
  instrument.push(`It contained ${plural(f.nQuestions, 'question')}${f.consent ? ', preceded by an informed-consent page' : ''}.`);
  for (const g of groupBy(f.pairwise, (p) => [p.images, p.trials, p.pairing, p.tie].join('|'))) {
    const p = g[0];
    const what = g.length === 1 ? `In the ${quoted(g)} task` : `In ${numberWord(g.length)} pairwise-choice tasks (${quoted(g)})`;
    instrument.push(`${what}, participants were shown ${p.images === 2 ? 'two images side by side' : `${p.images} images at a time`} and chose the one that better matched the question${p.trials ? ` over ${plural(p.trials, 'trial')}${g.length > 1 ? ' each' : ''}` : ''}; image pairs were drawn ${p.pairing === 'balanced' ? 'so that every image was shown the same number of times across participants' : 'at random'} for each participant${p.tie ? ', and a "no preference" option was available' : ''}.`);
  }
  for (const g of groupBy(f.ratings, (r) => [r.image, r.min, r.max, r.minLabel, r.maxLabel, r.trials].join('|'))) {
    const r = g[0];
    const scale = `a ${r.max - r.min + 1}-point scale from ${r.min}${r.minLabel ? ` (${r.minLabel})` : ''} to ${r.max}${r.maxLabel ? ` (${r.maxLabel})` : ''}`;
    if (r.image) {
      const what = g.length === 1 ? `In the ${quoted(g)} task` : `In ${numberWord(g.length)} image-rating tasks (${quoted(g)})`;
      instrument.push(`${what}, participants rated each image shown on ${scale}${r.trials ? `, ${plural(r.trials, 'image')} per participant${g.length > 1 ? ' and task' : ''}` : ''}.`);
    } else {
      instrument.push(g.length === 1
        ? `The ${quoted(g)} item was answered on ${scale}.`
        : `${capitalize(numberWord(g.length))} further items (${quoted(g)}) were answered on ${scale}.`);
    }
  }
  if (f.otherTypes.length) {
    const labels = [...new Set(f.otherTypes.map((t) => TYPE_WORDS[t] || t))];
    instrument.push(`Further questions used ${listText(labels)} formats; the full wording is given in the supplementary survey definition.`);
  }
  if (f.nStimuli) {
    instrument.push(`In total, ${plural(f.nStimuli, 'distinct image')} ${f.nStimuli === 1 ? 'was' : 'were'} shown${f.exposure ? `, each judged ${f.exposure.min === f.exposure.max ? f.exposure.min : `${f.exposure.min}–${f.exposure.max}`} times (median ${f.exposure.median})` : ''}. [Describe where the images come from, how they were selected, and their licence.]`);
  } else if (f.imageQuestions) {
    instrument.push('[Describe the images shown, how they were selected, and their licence.]');
  }
  if (f.conditions.length) instrument.push(`Participants were randomly assigned to one of ${f.conditions.length} conditions (${listText(f.conditions)}), balanced across the sample.`);
  parts.push(instrument.join(' '));

  // Participants
  parts.push(heading(style, s(2), 'Participants and data collection'));
  const sample = [];
  sample.push(`Data were collected online${f.dates ? ` ${f.dates}` : ''}. [Describe recruitment, inclusion criteria and any compensation.]`);
  sample.push(`In total, ${f.nRecorded} ${f.nRecorded === 1 ? 'submission was' : 'submissions were'} recorded${f.medianMinutes ? `; the median completion time was ${f.medianMinutes < 10 ? f.medianMinutes.toFixed(1) : Math.round(f.medianMinutes)} minutes` : ''}.`);
  const quality = [];
  if (f.attentionChecks) quality.push(`${plural(f.attentionChecks, 'attention-check question')}`);
  quality.push('automatic checks for implausibly fast completion, straight-lining and repeated participation from the same browser');
  sample.push(`Response quality was screened with ${listText(quality)}.`);
  sample.push(f.excludeFlagged && f.nExcluded
    ? `Of these, ${f.nExcluded} flagged ${f.nExcluded === 1 ? 'submission was' : 'submissions were'} excluded, leaving ${f.nRetained} from ${plural(f.nParticipants, 'participant')} for analysis.`
    : `All ${f.nRetained} submissions from ${plural(f.nParticipants, 'participant')} were analysed.`);
  if (f.silicon) sample.push(`Of the analysed submissions, ${f.silicon} were synthetic responses from AI personas ("silicon samples") and are reported separately.`);
  parts.push(sample.join(' '));

  // Analysis
  parts.push(heading(style, s(3), 'Data analysis'));
  const analysis = [];
  if (f.pairwise.length) {
    analysis.push(`Pairwise choices were converted into a score for each image with the TrueSkill rating system ${trueskillCite(style)}, in which every choice updates the estimated perceived quality (μ) and its uncertainty (σ) of both images (initial μ = 25, σ = 25/3)${f.pairwise.some((p) => p.tie) ? '; "no preference" answers were excluded from scoring' : ''}.`);
  }
  if (f.ratings.length || f.sliders.length) analysis.push('Ratings were summarized per image as the mean, standard deviation and 95% confidence interval.');
  analysis.push(`All scores were computed by the platform (analysis algorithm ${ANALYSIS_ALGORITHM_VERSION}); the per-image tables, the raw responses and the survey definition are provided so that every number can be reproduced.`);
  analysis.push('[Describe any further statistical models, e.g. regressions of image scores on visual features.]');
  parts.push(analysis.join(' '));

  // Statements
  const dois = platformDois();
  let n = 4;
  if (style.statements.includes('ethics')) {
    parts.push(heading(style, s(n), 'Ethics'));
    parts.push(`The study was approved by [ethics committee, approval number].${f.consent ? ' All participants gave informed consent in the survey before taking part.' : ' [State how informed consent was obtained.]'}`);
    n += 1;
  }
  const statements = [];
  if (style.statements.includes('data')) {
    statements.push(`**Data availability.** ${doi ? `The anonymised responses, per-image scores, stimulus list and survey definition are openly available at https://doi.org/${doi}.` : 'The anonymised responses, per-image scores, stimulus list and survey definition are available at [repository and DOI].'}`);
  }
  if (style.statements.includes('code')) {
    statements.push(`**Software and code availability.** SP-Survey is open source (${PLATFORM_URL}${dois.software ? `; https://doi.org/${dois.software}` : ''}); the analysis code that produced the scores is part of the platform, version ${PLATFORM_VERSION}.`);
  }
  if (style.publisher === 'elsevier') {
    statements.push('**Declaration of generative AI use.** [The draft of this section was assembled by SP-Survey from fixed templates, not by a generative AI model. State here any generative AI tools you used in writing, per the journal\'s policy.]');
  }
  if (statements.length) parts.push(statements.join('\n\n'));

  const references = [];
  const authors = PLATFORM_PAPER.authors;
  const swAuthor = PLATFORM_SOFTWARE_AUTHORS.map((a) => a.name || `${a.given} ${a.family}`).join(', ');
  if (style.publisher === 'sage') {
    references.push(`Herbrich R, Minka T and Graepel T (2007) TrueSkill™: A Bayesian skill rating system. In: Advances in Neural Information Processing Systems 19. Cambridge, MA: MIT Press, pp. 569–576.`);
    if (dois.paper) references.push(`${authors.map((a) => `${a.family} ${a.given.split(/[\s-]+/).map((g) => g[0]).join('')}`).join(', ')} (${PLATFORM_PAPER.year}) ${PLATFORM_PAPER.title}. ${PLATFORM_PAPER.journal}. DOI: ${dois.paper}.`);
    else references.push(`SP-Survey (${PLATFORM_PAPER.year}) Version ${PLATFORM_VERSION} [Computer software]. ${swAuthor}. Available at: ${dois.software ? `https://doi.org/${dois.software}` : PLATFORM_URL}.`);
  } else {
    references.push('Herbrich, R., Minka, T., & Graepel, T. (2007). TrueSkill™: A Bayesian skill rating system. In Advances in Neural Information Processing Systems 19 (pp. 569–576). MIT Press.');
    const names = authors.map((a) => `${a.family}, ${a.given.split(/[\s-]+/).map((g) => `${g[0]}.`).join(' ')}`);
    if (dois.paper) references.push(`${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]} (${PLATFORM_PAPER.year}). ${PLATFORM_PAPER.title}. ${PLATFORM_PAPER.journal}. https://doi.org/${dois.paper}`);
    else references.push(`SP-Survey (Version ${PLATFORM_VERSION}) [Computer software]. (${PLATFORM_PAPER.year}). ${swAuthor}. ${dois.software ? `https://doi.org/${dois.software}` : PLATFORM_URL}`);
  }
  if (f.pairwise.length === 0) references.shift();
  parts.push('## References');
  parts.push(references.map((r) => `- ${r}`).join('\n'));

  let markdown = `${parts.join('\n\n')}\n`;
  if (style.british) markdown = britishSpelling(markdown);
  return { style, markdown, references };
}

/** One Markdown file per journal style, for the analysis pack. */
export function journalMethodsFiles(facts, opts = {}) {
  return ['epb', 'ceus', 'lup'].map((id) => ({
    path: `methods_for_journals/${JOURNAL_STYLES[id].short}.md`,
    content: renderJournalMethods(facts, id, opts).markdown,
  }));
}
