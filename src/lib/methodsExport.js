import { flattenQuestions, getAttentionCheckQuestions, summarizeQuality } from './quality';
import { computeQuestionIrr, irrLevelForQuestion } from './reliability';
import { computeQuestionTrueSkill } from './trueskill';

function questionTypeLabel(type) {
  const labels = {
    imagepicker: 'pairwise image choice',
    rating: 'Likert rating scale',
    imagerating: 'image rating scale',
    mediarating: 'media rating scale',
    mediaranking: 'media ranking',
    radiogroup: 'single-choice question',
    matrix: 'matrix question',
    number: 'numeric input',
    consent: 'informed consent gate',
    slidergroup: 'semantic differential slider group',
    pointallocation: 'point allocation task',
    skillquestion: 'interactive perception task',
  };
  return labels[type] || type;
}

function formatDateRange(responses) {
  const dates = responses
    .map((r) => r.created_at || r.survey_metadata?.completion_time)
    .filter(Boolean)
    .map((d) => new Date(d))
    .sort((a, b) => a - b);
  if (!dates.length) return 'N/A';
  const fmt = (d) => d.toISOString().slice(0, 10);
  return dates.length === 1 ? fmt(dates[0]) : `${fmt(dates[0])} to ${fmt(dates[dates.length - 1])}`;
}

/**
 * Generate an English methods paragraph + optional BibTeX for the current project.
 */
export function generateMethodsText({
  project,
  surveyConfig,
  responses,
  templateMeta = null,
  excludeFlagged = true,
}) {
  const allQuestions = flattenQuestions(surveyConfig);
  const qualitySummary = summarizeQuality(responses, surveyConfig);
  const flaggedIds = new Set(
    Object.entries(qualitySummary.perResponse)
      .filter(([, flags]) => flags.length)
      .map(([id]) => id),
  );
  const effective = excludeFlagged
    ? responses.filter((r) => !flaggedIds.has(r.id ?? r.participant_id))
    : responses;

  const attentionQs = getAttentionCheckQuestions(surveyConfig);
  const pairwiseQs = allQuestions.filter((q) => q.type === 'imagepicker');
  const maxDiffQs = allQuestions.filter(
    (q) => q.type === 'skillquestion'
      && (q.skillId === 'preset_best_worst_choice'
        || q.skillId === 'best_worst_choice'
        || String(q.skillId || '').endsWith('best_worst_choice')),
  );
  const forcedChoiceQs = allQuestions.filter(
    (q) => q.type === 'skillquestion'
      && (q.skillId === 'preset_image_preference_forced'
        || q.skillId === 'image_preference_forced'
        || String(q.skillId || '').endsWith('image_preference_forced')),
  );
  const sliderPairQs = allQuestions.filter(
    (q) => q.type === 'skillquestion'
      && (q.skillId === 'preset_image_preference_slider'
        || String(q.skillId || '').endsWith('image_preference_slider')),
  );

  const lines = [];
  lines.push('METHODS (auto-generated — review and edit before submission)');
  lines.push('');
  lines.push(
    `We collected perceptual survey data using the SP Survey Platform `
    + `(${window.location.origin}). `
    + `Data were collected between ${formatDateRange(responses)}.`,
  );

  if (templateMeta?.name) {
    lines.push(
      `The survey design was adapted from ${templateMeta.author || 'prior work'} `
      + `(${templateMeta.year || 'n.d.'}) — "${templateMeta.name}".`,
    );
  }

  lines.push(
    `The instrument included ${allQuestions.length} question(s): `
    + `${[...new Set(allQuestions.map((q) => questionTypeLabel(q.type)))].join(', ')}.`,
  );

  if (pairwiseQs.length) {
    const modes = [...new Set(pairwiseQs.map((q) => q.pairingMode || 'random'))];
    lines.push(
      `Image choice questions (${pairwiseQs.length} question(s)) used `
      + `${modes.join('/')} pairing where configured. `
      + `Each selected image was treated as winning over non-selected shown alternatives; `
      + `scores were estimated with TrueSkill (μ − 3σ conservative rating).`,
    );
  }

  if (maxDiffQs.length) {
    const modes = [...new Set(maxDiffQs.map((q) => q.pairingMode || 'random'))];
    lines.push(
      `Best–Worst (MaxDiff) questions (${maxDiffQs.length} question(s)) used `
      + `${modes.join('/')} sampling where configured. `
      + `Within each trial, the best option beat all other shown options and each non-worst option beat the worst; `
      + `TrueSkill ratings were estimated alongside classical BWS scores.`,
    );
  }

  if (forcedChoiceQs.length) {
    lines.push(
      `Forced-choice A/B preference tasks (${forcedChoiceQs.length} question(s)) presented two images; `
      + `participants selected A or B without a continuous intensity scale.`,
    );
  }

  if (sliderPairQs.length) {
    lines.push(
      `Continuous A/B preference sliders (${sliderPairQs.length} question(s)) collected preference strength `
      + `on a −100 to +100 scale between two randomly paired images.`,
    );
  }

  lines.push(
    `A total of ${responses.length} response(s) were recorded; `
    + `${effective.length} were retained for analysis`
    + (excludeFlagged && qualitySummary.flagged
      ? ` after excluding ${qualitySummary.flagged} flagged submission(s)`
      : '')
    + '.',
  );

  if (attentionQs.length) {
    lines.push(
      `${attentionQs.length} embedded attention-check question(s) were included; `
      + `responses failing any check were flagged (not blocked at submission).`,
    );
  }

  const irrLines = allQuestions
    .map((q) => {
      const { alpha, interpretation } = computeQuestionIrr(effective, q);
      if (alpha == null) return null;
      const metric = irrLevelForQuestion(q) === 'interval'
        ? `Krippendorff's α = ${alpha.toFixed(3)}`
        : `Krippendorff's α (nominal) = ${alpha.toFixed(3)}`;
      return `"${q.title || q.name}": ${metric} — ${interpretation}`;
    })
    .filter(Boolean);
  if (irrLines.length) {
    lines.push('');
    lines.push('Inter-rater reliability:');
    irrLines.forEach((l) => lines.push(`  • ${l}`));
  }

  const tsLines = pairwiseQs
    .map((q) => {
      const { rankings } = computeQuestionTrueSkill(effective, q.name);
      if (!rankings.length) return null;
      return `"${q.title || q.name}": ${rankings.length} images rated across `
        + `${computeQuestionTrueSkill(effective, q.name).matches.length} pairwise comparisons`;
    })
    .filter(Boolean);
  if (tsLines.length) {
    lines.push('');
    lines.push('Pairwise scoring:');
    tsLines.forEach((l) => lines.push(`  • ${l}`));
  }

  let bibtex = '';
  if (templateMeta?.author && templateMeta?.name) {
    const citeKey = (templateMeta.id || 'template').replace(/[^a-z0-9]/gi, '_');
    bibtex = [
      `@misc{${citeKey},`,
      `  author = {${templateMeta.author}},`,
      `  title = {${templateMeta.name}},`,
      `  year = {${templateMeta.year || ''}},`,
      templateMeta.website || templateMeta.paper_url
        ? `  url = {${templateMeta.website || templateMeta.paper_url}},`
        : null,
      `  note = {Survey template on SP Survey Platform}`,
      '}',
    ].filter(Boolean).join('\n');
  }

  return { methodsText: lines.join('\n'), bibtex, effectiveCount: effective.length };
}

export function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
