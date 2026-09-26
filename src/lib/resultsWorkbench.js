import { ANALYSIS_ALGORITHM_VERSION } from './analysisVersion.js';
import {
  analysisScopeFingerprint,
  createAnalysisScope,
  describeContractSource,
  filterRowsByScope,
  resolveScopeRevision,
} from './analysisScope.js';
import {
  analysisFamilyForQuestion,
  defaultMethodForQuestion,
  methodCatalogPublic,
  methodsForQuestion,
} from './analysisMethods.js';
import { summarizeQuality } from './quality.js';
import { buildQuestionSummaryRows } from './questionSummaryExport.js';
import { answerIsPresent, expandQuestionAnswerUnits } from './responseAnswerUnits.js';
import { responseRecordKey } from './responseIdentity.js';
import { isNoPreference } from './choiceTie.js';
import {
  computeForcedChoiceTrueSkill,
  computeMaxDiffTrueSkill,
  computeQuestionTrueSkill,
  extractForcedChoiceMatches,
  extractMaxDiffMatches,
  extractPairwiseMatches,
  filenameKey,
} from './trueskill.js';
import { mediaIdentityKey } from './mediaIdentity.js';

const DISPLAY_ONLY = new Set(['expression', 'image', 'html', 'mediadisplay']);

export function flattenAnswerableQuestions(surveyConfig) {
  return (surveyConfig?.pages || [])
    .flatMap((page, pageIndex) => (page.elements || []).map((question, index) => ({
      ...question,
      pageName: page.name,
      pageTitle: page.title || page.name,
      pageIndex,
      catalogIndex: index,
    })))
    .filter((question) => question?.name && !DISPLAY_ONLY.has(question.type));
}

export function questionHasAnswer(row, questionName) {
  const units = expandQuestionAnswerUnits(row, questionName, { requireAnswer: true });
  if (units.length) return true;
  return answerIsPresent(row?.responses?.[questionName]);
}

function uniqueParticipants(rows) {
  return new Set((rows || []).map((row) => row.participant_id).filter(Boolean)).size;
}

function trialCount(rows, questions) {
  let n = 0;
  for (const question of questions || []) {
    for (const row of rows || []) {
      n += expandQuestionAnswerUnits(row, question.name, { requireAnswer: true }).length;
    }
  }
  return n;
}

function unionFind(keys) {
  const parent = new Map(keys.map((key) => [key, key]));
  const find = (key) => {
    if (parent.get(key) !== key) parent.set(key, find(parent.get(key)));
    return parent.get(key);
  };
  const union = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };
  return { find, union, parent };
}

function comparisonGroups(matches) {
  const keys = [...new Set((matches || []).flatMap((match) => [match.winner, match.loser]).filter(Boolean))];
  const uf = unionFind(keys);
  for (const match of matches || []) {
    if (match.winner && match.loser) uf.union(match.winner, match.loser);
  }
  const groups = new Map();
  for (const key of keys) {
    const root = uf.find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(key);
  }
  return [...groups.values()];
}

function stimulusStats(rows, questionName) {
  const shown = new Map();
  let ties = 0;
  let units = 0;
  for (const row of rows || []) {
    for (const unit of expandQuestionAnswerUnits(row, questionName, { requireAnswer: true })) {
      units += 1;
      if (isNoPreference(unit.answer)) ties += 1;
      for (const item of unit.shown_images || []) {
        const key = filenameKey(typeof item === 'string' ? item : item?.url || item?.name || '');
        if (!key) continue;
        shown.set(key, (shown.get(key) || 0) + 1);
      }
    }
  }
  return { shown, ties, units };
}

function annotateTrueSkillRankings(rankings, stats) {
  return (rankings || []).map((row) => ({
    ...row,
    shown: stats.shown.get(row.imageKey) || 0,
    comparisons: row.games || 0,
  }));
}

export function buildTrueSkillReport(question, rows) {
  const family = analysisFamilyForQuestion(question);
  const method = defaultMethodForQuestion(question);
  let matches = [];
  let computed = { matches: [], rankings: [], splitByCategory: false, categories: [] };
  if (method.id === 'trueskill_forced_choice' || String(question?.skillId || '').includes('forced')) {
    matches = extractForcedChoiceMatches(rows, question.name);
    computed = computeForcedChoiceTrueSkill(rows, question.name, question);
  } else if (method.id === 'trueskill_maxdiff' || family === 'maxdiff') {
    matches = extractMaxDiffMatches(rows, question.name);
    computed = computeMaxDiffTrueSkill(rows, question.name, question);
  } else {
    matches = extractPairwiseMatches(rows, question.name);
    computed = computeQuestionTrueSkill(rows, question.name, question);
  }
  const stats = stimulusStats(rows, question.name);
  const split = computed.splitByCategory && computed.categories?.length > 0;
  const warnings = [];
  if (!matches.length) warnings.push('insufficient_comparisons');
  if (stats.ties) warnings.push('ties_excluded_from_updates');
  let groups;
  let categories = [];
  let rankings;
  if (split) {
    categories = computed.categories.map((board) => {
      const boardGroups = comparisonGroups(board.matches);
      return {
        category: board.category,
        label: board.label,
        rankings: annotateTrueSkillRankings(board.rankings, stats),
        counts: {
          nComparisons: (board.matches || []).length,
          nGroups: boardGroups.length,
        },
        groups: boardGroups.map((keys, index) => ({
          id: `${board.label}:${index + 1}`,
          category: board.category,
          mediaKeys: keys,
          connected: true,
        })),
      };
    });
    groups = categories.flatMap((board) => board.groups.map((group) => group.mediaKeys));
    rankings = categories.flatMap((board) => board.rankings);
    if (categories.some((board) => board.counts.nGroups > 1)) warnings.push('disconnected_comparison_groups');
  } else {
    groups = comparisonGroups(computed.matches || matches);
    rankings = annotateTrueSkillRankings(computed.rankings, stats);
    if (groups.length > 1) warnings.push('disconnected_comparison_groups');
  }
  const nGroups = split
    ? categories.reduce((sum, board) => sum + board.counts.nGroups, 0)
    : groups.length;
  return {
    applicable: rankings.length > 0 || matches.length > 0 || stats.units > 0,
    method: method.id,
    algorithmVersion: ANALYSIS_ALGORITHM_VERSION,
    sortRule: split
      ? 'within each category, conservative = μ − 3σ, then μ'
      : 'conservative = μ − 3σ, then μ',
    splitByCategory: split,
    parameters: {
      defaultMu: 25,
      defaultSigma: 25 / 3,
      tiesUpdateRatings: false,
      multiwayExpanded: true,
      splitByCategory: split,
    },
    counts: {
      nResponses: rows.length,
      nParticipants: uniqueParticipants(rows),
      nTrials: stats.units,
      nComparisons: (computed.matches || matches).length,
      nTies: stats.ties,
      nGroups,
      nCategories: split ? categories.length : 1,
    },
    groups: split
      ? categories.flatMap((board) => board.groups)
      : groups.map((keys, index) => ({
        id: `g${index + 1}`,
        mediaKeys: keys,
        connected: true,
      })),
    categories,
    rankings,
    warnings,
    limitations: [
      'Rank order is not a significance test. Do not write “significantly better” from rank alone.',
      'σ is model uncertainty, not the participant rating standard deviation.',
      split
        ? 'muStd5 is a 0–5 min-max of μ inside each category; it is not comparable across categories or studies.'
        : 'muStd5 is a 0–5 min-max of μ in this sample only; it is not a cross-study absolute score.',
      'Expanded pairs from one ranking or multi-select are dependent; they are not extra participants.',
      'No-preference / ties are counted separately and do not update win/loss ratings.',
      split
        ? 'One category per trial is ranked on its own. Do not read these boards as one pooled order.'
        : null,
      !split && groups.length > 1 ? 'Disconnected groups cannot support a single cross-group ranking.' : null,
      split && categories.some((board) => board.counts.nGroups > 1)
        ? 'A category with disconnected comparison groups cannot support one ranking inside that category.'
        : null,
    ].filter(Boolean),
  };
}

function filterSummaryRows(rows, { dimensionId, mediaKey } = {}) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    if (dimensionId && row.attribute_key !== dimensionId && row.attribute_label !== dimensionId) return false;
    if (mediaKey) {
      const key = mediaIdentityKey(row.unit_key || row.unit_label || '');
      if (key !== mediaKey && row.unit_key !== mediaKey && row.unit_label !== mediaKey) return false;
    }
    return true;
  });
}

export function computeQuestionMetrics(question, rows, scope = {}) {
  const method = defaultMethodForQuestion(question);
  const summaryRows = filterSummaryRows(buildQuestionSummaryRows(question, rows) || [], scope);
  const nAnswered = rows.filter((row) => questionHasAnswer(row, question.name)).length;
  const comparison = method.id.startsWith('trueskill')
    ? buildTrueSkillReport(question, rows)
    : null;
  return {
    questionName: question.name,
    questionTitle: typeof question.title === 'string' ? question.title : question.name,
    type: question.type || 'unknown',
    family: analysisFamilyForQuestion(question),
    methods: methodsForQuestion(question).map((item) => item.id),
    method: method.id,
    algorithmVersion: ANALYSIS_ALGORITHM_VERSION,
    averageable: method.averageable === true,
    nAnswered,
    nResponses: rows.length,
    nParticipants: uniqueParticipants(rows),
    metrics: summaryRows,
    comparison,
    warnings: comparison?.warnings || [],
    limitations: [
      method.notes,
      ...(comparison?.limitations || []),
    ].filter(Boolean),
    evidence: {
      questionName: question.name,
      dimensionId: scope.dimensionId || null,
      method: method.id,
    },
  };
}

export function computeResultsOverview({
  scope,
  rows,
  surveyConfig,
  qualitySummary = null,
} = {}) {
  const normalized = createAnalysisScope(scope);
  const revision = resolveScopeRevision(rows, normalized);
  const scopedRows = filterRowsByScope(rows, { ...normalized, surveyRevision: revision || normalized.surveyRevision });
  const quality = qualitySummary || summarizeQuality(scopedRows, surveyConfig || {});
  const flaggedKeys = new Set(
    Object.entries(quality.perResponse || {})
      .filter(([, flags]) => flags?.length)
      .map(([key]) => key),
  );
  const analysisRows = filterRowsByScope(scopedRows, {
    ...normalized,
    surveyRevision: revision || normalized.surveyRevision,
    excludeFlagged: normalized.excludeFlagged,
  }, { flaggedKeys });
  const questions = flattenAnswerableQuestions(surveyConfig);
  const contract = describeContractSource(scopedRows, revision);
  const snapshotId = analysisScopeFingerprint(
    { ...normalized, surveyRevision: revision },
    analysisRows.map((row) => responseRecordKey(row)),
  );
  const catalog = questions.map((question, index) => {
    const method = defaultMethodForQuestion(question);
    return {
      name: question.name,
      title: typeof question.title === 'string' ? question.title : question.name,
      type: question.type || 'unknown',
      number: index + 1,
      pageName: question.pageName,
      family: analysisFamilyForQuestion(question),
      method: method.id,
      nAnswered: analysisRows.filter((row) => questionHasAnswer(row, question.name)).length,
    };
  });
  return {
    kind: 'results',
    view: 'overview',
    success: true,
    scope: {
      ...normalized,
      surveyRevision: revision || normalized.surveyRevision,
      contractSource: contract.contractSource,
      snapshotId,
      generatedAt: new Date().toISOString(),
    },
    counts: {
      nLoaded: rows.length,
      nResponses: analysisRows.length,
      nParticipants: uniqueParticipants(analysisRows),
      nTrials: trialCount(analysisRows, questions),
      nPractice: scopedRows.filter((row) => row.survey_metadata?.practice_mode).length,
      nFlagged: flaggedKeys.size,
      nIncluded: analysisRows.length,
      nUntimed: scopedRows.filter((row) => !row.created_at && !row.survey_metadata?.completion_time).length,
      nMissingContract: contract.missingContractCount,
    },
    quality: {
      clean: quality.clean,
      flagged: quality.flagged,
      flagCounts: quality.flagCounts || {},
    },
    catalog,
    availableMethods: methodCatalogPublic(),
    warnings: [
      contract.contractSource === 'current_draft_fallback'
        ? 'Historical responses have no frozen question contract; current settings are a fallback.'
        : null,
      contract.contractSource === 'mixed_frozen'
        ? 'Some historical responses lack a frozen question contract.'
        : null,
      normalized.dataSource === 'silicon' ? 'Silicon answers are isolated from human analysis.' : null,
    ].filter(Boolean),
  };
}

export function computeResultsQuestion({
  scope,
  rows,
  surveyConfig,
  qualitySummary = null,
} = {}) {
  const overview = computeResultsOverview({ scope, rows, surveyConfig, qualitySummary });
  const questionName = overview.scope.questionName;
  const question = flattenAnswerableQuestions(surveyConfig).find((item) => item.name === questionName);
  if (!question) {
    return {
      ...overview,
      view: 'question',
      error: questionName ? `Question not found: ${questionName}` : 'questionName is required',
      complete: false,
    };
  }
  const analysisRows = filterRowsByScope(rows, overview.scope, {
    flaggedKeys: new Set(
      Object.entries((qualitySummary || summarizeQuality(rows, surveyConfig || {})).perResponse || {})
        .filter(([, flags]) => flags?.length)
        .map(([key]) => key),
    ),
  });
  return {
    ...overview,
    view: 'question',
    question: computeQuestionMetrics(question, analysisRows, overview.scope),
  };
}

function catalogSlice(catalog = [], offset = 0, limit = 20) {
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  return {
    items: catalog.slice(start, start + size),
    offset: start,
    limit: size,
    total: catalog.length,
    hasMore: start + size < catalog.length,
  };
}

export function compactResultsForModel(value, { maxChars = 8000 } = {}) {
  if (!value || typeof value !== 'object') return null;
  const isResults = value.kind === 'results' || (value.scope?.projectId && (value.catalog || value.question || value.analysisBundle));
  if (!isResults) return null;
  const catalog = value.catalog || [];
  const page = catalogSlice(catalog, value.catalogOffset || 0, value.catalogLimit || 12);
  const question = value.question
    ? {
      questionName: value.question.questionName,
      type: value.question.type,
      family: value.question.family,
      method: value.question.method,
      algorithmVersion: value.question.algorithmVersion,
      nAnswered: value.question.nAnswered,
      nParticipants: value.question.nParticipants,
      averageable: value.question.averageable,
      warnings: value.question.warnings,
      limitations: value.question.limitations,
      metrics: (value.question.metrics || []).slice(0, 40),
      comparison: value.question.comparison
        ? {
          ...value.question.comparison,
          rankings: (value.question.comparison.rankings || []).slice(0, 20),
          categories: (value.question.comparison.categories || []).map((board) => ({
            ...board,
            rankings: (board.rankings || []).slice(0, 12),
          })),
        }
        : null,
      evidence: value.question.evidence,
    }
    : undefined;
  const compact = {
    kind: 'results',
    view: value.view || 'overview',
    truncated: true,
    complete: false,
    success: value.success !== false,
    scope: value.scope,
    counts: value.counts,
    quality: value.quality,
    warnings: value.warnings,
    catalog: page.items,
    catalogPage: { offset: page.offset, limit: page.limit, total: page.total, hasMore: page.hasMore },
    question,
    download: value.download || (value.format ? {
      format: value.format,
      filename: value.wideCsvFilename || value.summaryCsvFilename || value.longCsvFilename || null,
      n: value.n,
      available: true,
    } : undefined),
    next: {
      read: page.hasMore
        ? {
          tool: 'survey_results_summary',
          args: { ...value.scope, view: 'overview', catalogOffset: page.offset + page.limit },
          note: 'Read the next catalog page. Counts stay the same.',
        }
        : value.question
          ? {
            tool: 'survey_results_summary',
            args: {
              ...value.scope,
              view: 'question',
              questionName: value.question.questionName,
              dimensionId: value.scope?.dimensionId || undefined,
            },
            note: 'Reload this question if a metric page was truncated.',
          }
          : {
            tool: 'survey_results_summary',
            args: { ...value.scope, view: 'question', questionName: '<questionName>' },
            note: 'Read one question for full metrics. Do not invent statistics.',
          },
    },
  };
  let text = JSON.stringify(compact);
  if (text.length > maxChars && compact.question?.metrics) {
    compact.question.metrics = compact.question.metrics.slice(0, 12);
    text = JSON.stringify(compact);
  }
  if (text.length > maxChars && compact.question?.comparison?.rankings) {
    compact.question.comparison.rankings = compact.question.comparison.rankings.slice(0, 8);
    if (compact.question.comparison.categories) {
      compact.question.comparison.categories = compact.question.comparison.categories.map((board) => ({
        ...board,
        rankings: (board.rankings || []).slice(0, 4),
      }));
    }
    text = JSON.stringify(compact);
  }
  return text;
}

export function buildAnalysisFindings(overview, questionMetrics = []) {
  const findings = [];
  for (const question of questionMetrics) {
    if (!question?.nAnswered) continue;
    if (question.comparison?.splitByCategory && question.comparison.categories?.length) {
      for (const board of question.comparison.categories) {
        const top = board.rankings?.[0];
        if (!top) continue;
        findings.push({
          id: `${question.questionName}:top:${board.category || board.label}`,
          questionName: question.questionName,
          method: question.method,
          text: `${question.questionTitle} (${board.label}) ranking is led by ${top.imageKey} (μ=${Number(top.mu).toFixed(2)}, σ=${Number(top.sigma).toFixed(2)}). Rank is within this category.`,
          evidence: { ...question.evidence, category: board.category || null },
        });
      }
      continue;
    }
    if (question.comparison?.rankings?.length) {
      const top = question.comparison.rankings[0];
      findings.push({
        id: `${question.questionName}:top`,
        questionName: question.questionName,
        method: question.method,
        text: `${question.questionTitle} ranking is led by ${top.imageKey} (μ=${Number(top.mu).toFixed(2)}, σ=${Number(top.sigma).toFixed(2)}).`,
        evidence: question.evidence,
      });
      continue;
    }
    const mean = (question.metrics || []).find((row) => row.metric === 'mean' || row.metric === 'avg');
    if (mean && question.averageable) {
      findings.push({
        id: `${question.questionName}:mean`,
        questionName: question.questionName,
        method: question.method,
        text: `${question.questionTitle}: ${mean.attribute_label || 'value'} mean ${mean.value} (n=${mean.n || question.nAnswered}).`,
        evidence: { ...question.evidence, dimensionId: mean.attribute_key || null },
      });
    }
  }
  return findings;
}
