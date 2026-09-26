/**
 * Local-file results list / export / light summary for the loopback agent API.
 * Shape matches Platform MCP survey_list_responses / survey_export_responses / survey_results_summary.
 */

const path = require('path');

const LIST_DEFAULT_LIMIT = 100;
const EXPORT_MAX = 5000;
const DISPLAY_ONLY_TYPES = new Set(['expression', 'image', 'html', 'mediadisplay']);
const EXPORT_FORMATS = new Set(['json', 'wide_csv', 'both', 'long_csv', 'summary_csv', 'analysis_bundle']);

function flattenQuestions(surveyConfig) {
  const out = [];
  for (const page of surveyConfig?.pages || []) {
    for (const element of page.elements || []) {
      if (element?.name && !DISPLAY_ONLY_TYPES.has(element.type)) out.push(element);
    }
  }
  return out;
}

function hasAnswer(qData) {
  if (qData == null || qData === '') return false;
  if (typeof qData === 'object' && !Array.isArray(qData)) {
    if (Array.isArray(qData.trials) && qData.trials.length) {
      return qData.trials.some((trial) => trial?.answer != null && trial.answer !== '');
    }
    if ('answer' in qData) return qData.answer != null && qData.answer !== '';
  }
  return true;
}

function answerQuestionCount(responses) {
  if (!responses || typeof responses !== 'object') return 0;
  return Object.keys(responses).filter((key) => hasAnswer(responses[key])).length;
}

function unwrapAnswer(qData) {
  if (qData && typeof qData === 'object' && !Array.isArray(qData) && 'answer' in qData) {
    return qData.answer;
  }
  return qData;
}

function parseResultsQuery(raw = {}) {
  const dataSource = ['live', 'practice', 'silicon'].includes(raw.dataSource) ? raw.dataSource : 'live';
  return {
    view: ['overview', 'question'].includes(raw.view) ? raw.view : (raw.questionName ? 'question' : 'overview'),
    includePractice: raw.includePractice === true || raw.includePractice === 'true',
    includeAnswers: raw.includeAnswers === true || raw.includeAnswers === 'true',
    excludeFlagged: raw.excludeFlagged === true || raw.excludeFlagged === 'true',
    dataSource,
    siliconRunId: raw.siliconRunId || undefined,
    dateFrom: raw.dateFrom || undefined,
    dateTo: raw.dateTo || undefined,
    sessionId: raw.sessionId || undefined,
    surveyRevision: raw.surveyRevision || undefined,
    questionName: raw.questionName || undefined,
    catalogOffset: Math.max(Number(raw.catalogOffset) || 0, 0),
    catalogLimit: Math.min(Math.max(Number(raw.catalogLimit) || 12, 1), 50),
    limit: Math.min(Math.max(Number(raw.limit) || LIST_DEFAULT_LIMIT, 1), EXPORT_MAX),
    offset: Math.max(Number(raw.offset) || 0, 0),
  };
}

function rowTimestamp(row) {
  return row.created_at || row.survey_metadata?.completion_time || null;
}

function filterRows(rows, filters) {
  let out = Array.isArray(rows) ? [...rows] : [];
  if (filters.surveyRevision) {
    out = out.filter((row) => (
      (row.survey_metadata?.survey_revision || 'historical_unknown') === filters.surveyRevision
    ));
  }
  if (filters.dataSource === 'practice') {
    out = out.filter((row) => row.survey_metadata?.practice_mode);
  } else if (!filters.includePractice) {
    out = out.filter((row) => !row.survey_metadata?.practice_mode);
  }
  if (filters.sessionId) {
    out = out.filter((row) => row.survey_metadata?.session_id === filters.sessionId);
  }
  if (filters.dateFrom || filters.dateTo) {
    out = out.filter((row) => {
      const ts = rowTimestamp(row);
      if (!ts) return true;
      const start = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : -Infinity;
      let end = Infinity;
      if (filters.dateTo) {
        const nextDay = new Date(`${filters.dateTo}T00:00:00`);
        nextDay.setDate(nextDay.getDate() + 1);
        end = nextDay.getTime();
      }
      return new Date(ts).getTime() >= start && new Date(ts).getTime() < end;
    });
  }
  return out;
}

function metaSummary(meta = {}) {
  return {
    completion_code: meta.completion_code || null,
    session_id: meta.session_id || null,
    attempt_index: meta.attempt_index ?? null,
    practice_mode: Boolean(meta.practice_mode),
    practice_question: meta.practice_question || null,
    survey_revision: meta.survey_revision || null,
    timing_total_seconds: meta.timing?.total_seconds ?? null,
    browser_id: meta.browser_id || null,
  };
}

function toFullRow(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    participant_id: row.participant_id,
    created_at: row.created_at,
    responses: row.responses || {},
    displayed_images: row.displayed_images || null,
    survey_metadata: row.survey_metadata || {},
  };
}

function csvEscape(value) {
  const text = value == null ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  if (/[=+\-@\t]/.test(text.charAt(0))) return `"'${text.replace(/"/g, '""')}"`;
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildWideCsv(rows, questions) {
  const headers = ['id', 'participant_id', 'created_at', ...questions.map((question) => question.name)];
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach((row) => {
    lines.push([
      row.id,
      row.participant_id,
      row.created_at,
      ...questions.map((question) => unwrapAnswer(row.responses?.[question.name])),
    ].map(csvEscape).join(','));
  });
  return lines.join('\n');
}

function buildLongCsv(question, rows) {
  const lines = [['participant_id', 'created_at', 'question', 'answer'].map(csvEscape).join(',')];
  rows.forEach((row) => {
    const value = unwrapAnswer(row.responses?.[question.name]);
    if (!hasAnswer(row.responses?.[question.name])) return;
    lines.push([row.participant_id, row.created_at, question.name, value].map(csvEscape).join(','));
  });
  return lines.join('\n');
}

function buildSummaryCsv(question, rows) {
  const counts = new Map();
  let nAnswered = 0;
  rows.forEach((row) => {
    const raw = row.responses?.[question.name];
    if (!hasAnswer(raw)) return;
    nAnswered += 1;
    const value = unwrapAnswer(raw);
    const key = typeof value === 'object' ? JSON.stringify(value) : String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const lines = [['question', 'type', 'value', 'n'].map(csvEscape).join(',')];
  if (!counts.size) {
    lines.push([question.name, question.type, '', 0].map(csvEscape).join(','));
  } else {
    [...counts.entries()].forEach(([value, n]) => {
      lines.push([question.name, question.type, value, n].map(csvEscape).join(','));
    });
  }
  return { csv: lines.join('\n'), nAnswered };
}

async function loadFileResponses(fs, responsesPath, projectId) {
  if (!responsesPath || !await fs.pathExists(responsesPath)) return [];
  const files = (await fs.readdir(responsesPath)).filter((file) => file.endsWith('.json'));
  const rows = [];
  for (const file of files) {
    try {
      const row = JSON.parse(await fs.readFile(path.join(responsesPath, file), 'utf8'));
      if (String(row.project_id || '') !== String(projectId)) continue;
      rows.push({
        id: row.id || file.replace(/\.json$/, ''),
        project_id: row.project_id,
        participant_id: row.participant_id,
        created_at: row.created_at || row.survey_metadata?.completion_time || null,
        responses: row.responses || {},
        displayed_images: row.displayed_images || null,
        survey_metadata: row.survey_metadata || {},
      });
    } catch {
      // skip unreadable files
    }
  }
  rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return rows;
}

async function loadSiliconResponses(fs, projectsPath, projectId, runId) {
  if (!runId) {
    const error = new Error('siliconRunId is required when dataSource is silicon.');
    error.status = 400;
    error.code = 'SILICON_RUN_REQUIRED';
    throw error;
  }
  const file = path.join(projectsPath, `${projectId}.silicon.json`);
  if (!await fs.pathExists(file)) {
    const error = new Error('Silicon run was not found for this project.');
    error.status = 404;
    error.code = 'SILICON_RUN_NOT_FOUND';
    throw error;
  }
  const store = JSON.parse(await fs.readFile(file, 'utf8'));
  const run = (store.runs || []).find((item) => item.id === runId);
  if (!run) {
    const error = new Error('Silicon run was not found for this project.');
    error.status = 404;
    error.code = 'SILICON_RUN_NOT_FOUND';
    throw error;
  }
  return (store.responses?.[runId] || []).map((row, index) => ({
    ...row,
    id: row.id || `${runId}_${index}`,
    project_id: projectId,
    source: 'silicon',
    survey_metadata: {
      ...(row.survey_metadata || {}),
      silicon_run_id: runId,
    },
  }));
}

async function loadScopedResponses(fs, { responsesPath, projectsPath, projectId, opts }) {
  if (opts.dataSource === 'silicon') {
    return loadSiliconResponses(fs, projectsPath, projectId, opts.siliconRunId);
  }
  return loadFileResponses(fs, responsesPath, projectId);
}

function requireKnownRevision(rows, revision) {
  if (revision && !rows.some((row) => (row.survey_metadata?.survey_revision || 'historical_unknown') === revision)) {
    const error = new Error('Requested survey revision was not found in these responses.');
    error.status = 400;
    error.code = 'UNKNOWN_SURVEY_REVISION';
    throw error;
  }
}

async function listResponses(fs, ctx, projectId, filters = {}) {
  const opts = parseResultsQuery(filters);
  const all = await loadScopedResponses(fs, { ...ctx, projectId, opts });
  requireKnownRevision(all, opts.surveyRevision);
  const filtered = filterRows(all, opts);
  const slice = filtered.slice(opts.offset, opts.offset + opts.limit);
  return {
    success: true,
    projectId,
    total: filtered.length,
    offset: opts.offset,
    limit: opts.limit,
    hasMore: opts.offset + slice.length < filtered.length,
    filters: {
      includePractice: opts.includePractice,
      dataSource: opts.dataSource,
      surveyRevision: opts.surveyRevision || null,
    },
    responses: slice.map((row) => {
      const base = {
        id: row.id,
        project_id: row.project_id,
        participant_id: row.participant_id,
        created_at: row.created_at,
        survey_metadata: metaSummary(row.survey_metadata || {}),
        answer_question_count: answerQuestionCount(row.responses),
      };
      if (opts.includeAnswers) {
        base.responses = row.responses || {};
        base.displayed_images = row.displayed_images || null;
      }
      return base;
    }),
  };
}

async function exportResponses(fs, ctx, projectId, filters = {}) {
  const opts = parseResultsQuery({
    ...filters,
    limit: filters.limit != null ? filters.limit : EXPORT_MAX,
  });
  const format = String(filters.format || 'json').toLowerCase();
  if (!EXPORT_FORMATS.has(format)) {
    const error = new Error('format must be json, wide_csv, both, long_csv, summary_csv, or analysis_bundle');
    error.status = 400;
    throw error;
  }
  const all = await loadScopedResponses(fs, { ...ctx, projectId, opts });
  requireKnownRevision(all, opts.surveyRevision);
  const surveyConfig = ctx.surveyConfig || {};
  const filtered = filterRows(all, opts);
  if (filtered.length > EXPORT_MAX) {
    const error = new Error(`Too many responses (${filtered.length}). Narrow filters (max ${EXPORT_MAX}).`);
    error.status = 400;
    error.code = 'EXPORT_TOO_LARGE';
    throw error;
  }
  const allQuestions = flattenQuestions(surveyConfig);
  const questions = filters.questionName
    ? allQuestions.filter((question) => question.name === filters.questionName)
    : allQuestions;
  if (filters.questionName && !questions.length) {
    const error = new Error(`Question not found: ${filters.questionName}`);
    error.status = 404;
    throw error;
  }
  const result = {
    kind: 'results',
    success: true,
    projectId,
    format,
    n: filtered.length,
    surveyRevision: opts.surveyRevision || null,
    availableRevisions: [...new Set(all.map((row) => row.survey_metadata?.survey_revision || 'historical_unknown'))],
    download: { format, available: true, filename: null },
    note: 'Typed Skill exports use the frozen question contract. File bodies are for download, not for model context.',
  };
  if (format === 'json' || format === 'both') {
    result.responses = filtered.map(toFullRow);
  }
  if (format === 'wide_csv' || format === 'both') {
    result.wideCsv = buildWideCsv(filtered, questions);
    result.wideCsvFilename = `responses_wide_${projectId}_${new Date().toISOString().slice(0, 10)}.csv`;
  }
  if (['long_csv', 'summary_csv', 'analysis_bundle'].includes(format)) {
    const analyses = questions.map((question) => {
      const summary = buildSummaryCsv(question, filtered);
      return {
        question,
        longCsv: buildLongCsv(question, filtered),
        summaryCsv: summary.csv,
        nAnswered: summary.nAnswered,
      };
    });
    if (format === 'long_csv') {
      if (analyses.length === 1) {
        result.longCsv = analyses[0].longCsv;
        result.longCsvFilename = `${analyses[0].question.name}__long.csv`;
      } else {
        result.longCsvFiles = analyses.map(({ question, longCsv }) => ({
          questionName: question.name,
          filename: `${question.name}__long.csv`,
          content: longCsv,
        }));
        result.note = 'Question types have different native long schemas, so multi-question long_csv returns one file per question. Pass questionName for a single CSV.';
      }
    } else if (format === 'summary_csv') {
      if (analyses.length === 1) {
        result.summaryCsv = analyses[0].summaryCsv;
        result.summaryCsvFilename = `${analyses[0].question.name}__summary.csv`;
      } else {
        result.summaryCsvFiles = analyses.map(({ question, summaryCsv }) => ({
          questionName: question.name,
          filename: `${question.name}__summary.csv`,
          content: summaryCsv,
        }));
        result.note = 'Multi-question summary_csv returns one native-format file per question. Pass questionName for a single CSV.';
      }
    } else {
      const files = [
        { path: 'responses_wide.csv', content: buildWideCsv(filtered, questions) },
        ...analyses.flatMap(({ question, longCsv, summaryCsv }) => ([
          { path: `${question.name}__long.csv`, content: longCsv },
          { path: `${question.name}__summary.csv`, content: summaryCsv },
        ])),
      ];
      const manifest = {
        projectId,
        n: filtered.length,
        questions: questions.map((question) => question.name),
        exportedAt: new Date().toISOString(),
      };
      files.unshift({ path: 'manifest.json', content: JSON.stringify(manifest, null, 2) });
      result.analysisBundle = { manifest, files };
    }
  }
  return result;
}

async function summarizeResponses(fs, ctx, projectId, filters = {}) {
  const opts = parseResultsQuery({ ...filters, limit: EXPORT_MAX });
  const all = await loadScopedResponses(fs, { ...ctx, projectId, opts });
  requireKnownRevision(all, opts.surveyRevision);
  if (all.length > EXPORT_MAX) {
    const error = new Error(`Too many responses (${all.length}). Narrow by date or questionName (max ${EXPORT_MAX}); statistics were not truncated or sampled.`);
    error.status = 400;
    error.code = 'RESULTS_TOO_LARGE';
    throw error;
  }
  const surveyConfig = ctx.surveyConfig || {};
  const filtered = filterRows(all, opts);
  const questions = flattenQuestions(surveyConfig);
  const catalog = questions.map((question) => {
    const nAnswered = filtered.filter((row) => hasAnswer(row.responses?.[question.name])).length;
    return {
      name: question.name,
      type: question.type,
      n_answered: nAnswered,
      nAnswered,
    };
  });
  const paged = catalog.slice(opts.catalogOffset, opts.catalogOffset + opts.catalogLimit);
  const payload = {
    success: true,
    view: opts.view,
    projectId,
    projectName: ctx.projectName || projectId,
    surveyRevision: opts.surveyRevision || null,
    availableRevisions: [...new Set(all.map((row) => row.survey_metadata?.survey_revision || 'historical_unknown'))],
    n_total: all.length,
    n_practice: all.filter((row) => row.survey_metadata?.practice_mode).length,
    n_in_export: filtered.length,
    n_flagged: 0,
    flag_counts: {},
    catalogOffset: opts.catalogOffset,
    catalogLimit: opts.catalogLimit,
    questions: paged,
    catalog: paged,
    note: 'Local-file metrics. Do not invent statistics. Use view=question for full rows.',
  };
  if (opts.view === 'question' || opts.questionName) {
    const question = questions.find((item) => item.name === opts.questionName) || questions[0];
    if (question) {
      const summary = buildSummaryCsv(question, filtered);
      payload.question = {
        questionName: question.name,
        type: question.type,
        nAnswered: summary.nAnswered,
        metrics: summary.csv,
      };
    }
  }
  return payload;
}

module.exports = {
  EXPORT_MAX,
  flattenQuestions,
  parseResultsQuery,
  listResponses,
  exportResponses,
  summarizeResponses,
};
