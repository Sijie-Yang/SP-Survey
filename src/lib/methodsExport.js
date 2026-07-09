import { flattenQuestions, getAttentionCheckQuestions, summarizeQuality } from './quality';
import { computeQuestionIrr, irrLevelForQuestion } from './reliability';
import { computeQuestionTrueSkill } from './trueskill';

function questionTypeLabel(type) {
  const labels = {
    imagepicker: 'pairwise image choice',
    rating: 'Likert rating scale',
    imagerating: 'image rating scale',
    radiogroup: 'single-choice question',
    matrix: 'matrix question',
    slidergroup: 'semantic differential slider group',
    pointallocation: 'point allocation task',
    skillquestion: 'custom interactive task',
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
