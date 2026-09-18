import { NO_PREFERENCE } from './choiceTie';
import { createAnalysisScope } from './analysisScope';
import { defaultMethodForQuestion } from './analysisMethods';
import {
  buildTrueSkillReport,
  compactResultsForModel,
  computeQuestionMetrics,
  computeResultsOverview,
  questionHasAnswer,
} from './resultsWorkbench';

const picker = {
  name: 'ab',
  type: 'imagepicker',
  title: 'Safer street',
};
const slider = {
  name: 'walk',
  type: 'imageslidergroup',
  title: 'Walkability',
  dimensions: [{ id: 'safety', label: 'Safety', left: 'Low', right: 'High' }],
};
const rating = { name: 'score', type: 'rating', title: 'Score' };

function row(id, answers, extras = {}) {
  return {
    id,
    project_id: 'p1',
    participant_id: extras.participant_id || id,
    created_at: extras.created_at || '2026-09-17T10:00:00.000Z',
    responses: answers,
    displayed_images: extras.displayed_images || {},
    survey_metadata: { survey_revision: 'v1', practice_mode: false, ...(extras.meta || {}) },
  };
}

describe('results workbench engine', () => {
  test('false and 0 count as answers; empty arrays do not', () => {
    expect(questionHasAnswer(row('a', { score: 0 }), 'score')).toBe(true);
    expect(questionHasAnswer(row('b', { ok: false }), 'ok')).toBe(true);
    expect(questionHasAnswer(row('c', { tags: [] }), 'tags')).toBe(false);
    expect(questionHasAnswer(row('d', { note: {} }), 'note')).toBe(false);
    expect(questionHasAnswer(row('e', { note: null }), 'note')).toBe(false);
  });

  test('pairwise picker uses TrueSkill and keeps ties out of updates', () => {
    const rows = [
      row('1', { ab: 'street-a.jpg' }, { displayed_images: { ab: ['street-a.jpg', 'street-b.jpg'] } }),
      row('2', { ab: 'street-b.jpg' }, { displayed_images: { ab: ['street-a.jpg', 'street-b.jpg'] } }),
      row('3', { ab: NO_PREFERENCE }, { displayed_images: { ab: ['street-a.jpg', 'street-b.jpg'] } }),
    ];
    expect(defaultMethodForQuestion(picker).id).toBe('trueskill_pairwise');
    const report = buildTrueSkillReport(picker, rows);
    expect(report.method).toBe('trueskill_pairwise');
    expect(report.counts.nTies).toBe(1);
    expect(report.counts.nComparisons).toBe(2);
    expect(report.parameters.tiesUpdateRatings).toBe(false);
    expect(report.rankings.length).toBe(2);
    expect(report.limitations.some((line) => line.includes('significantly'))).toBe(true);
  });

  test('disconnected comparison groups are flagged', () => {
    const rows = [
      row('1', { ab: 'a.jpg' }, { displayed_images: { ab: ['a.jpg', 'b.jpg'] } }),
      row('2', { ab: 'c.jpg' }, { displayed_images: { ab: ['c.jpg', 'd.jpg'] } }),
    ];
    const report = buildTrueSkillReport(picker, rows);
    expect(report.counts.nGroups).toBe(2);
    expect(report.warnings).toContain('disconnected_comparison_groups');
  });

  test('slider metrics stay per dimension and native/skill families share methods', () => {
    const mediaPicker = { name: 'ab2', type: 'mediapicker', title: 'Safer street' };
    const rows = [
      row('1', { walk: { safety: 4 } }),
      row('2', { walk: { safety: 2 } }),
    ];
    const metrics = computeQuestionMetrics(slider, rows);
    expect(metrics.method).toBe('slider_dimensions');
    expect(metrics.averageable).toBe(true);
    expect(defaultMethodForQuestion(mediaPicker).id).toBe(defaultMethodForQuestion(picker).id);
  });

  test('overview counts distinguish responses, people, and trials', () => {
    const rows = [
      row('1', { score: 5, ab: 'a.jpg' }, { displayed_images: { ab: ['a.jpg', 'b.jpg'] } }),
      row('2', { score: 0 }, { participant_id: '1' }),
    ];
    const overview = computeResultsOverview({
      scope: createAnalysisScope({ projectId: 'p1', surveyRevision: 'v1' }),
      rows,
      surveyConfig: { pages: [{ name: 'p', elements: [rating, picker] }] },
    });
    expect(overview.counts.nResponses).toBe(2);
    expect(overview.counts.nParticipants).toBe(1);
    expect(overview.catalog.find((item) => item.name === 'ab').method).toBe('trueskill_pairwise');
    expect(overview.scope.contractSource).toBe('current_draft_fallback');
  });

  test('compact results keep scope, counts, catalog, and a read next', () => {
    const huge = computeResultsOverview({
      scope: createAnalysisScope({ projectId: 'p1' }),
      rows: Array.from({ length: 3 }, (_, i) => row(String(i), { score: i })),
      surveyConfig: {
        pages: [{
          name: 'p',
          elements: Array.from({ length: 40 }, (_, i) => ({ name: `q${i}`, type: 'rating', title: `Q${i}` })),
        }],
      },
    });
    huge.question = computeQuestionMetrics(rating, [row('1', { score: 3 })]);
    const compact = JSON.parse(compactResultsForModel(huge, { maxChars: 1200 }));
    expect(compact.kind).toBe('results');
    expect(compact.scope.projectId).toBe('p1');
    expect(compact.counts.nResponses).toBeGreaterThan(0);
    expect(compact.catalog.length).toBeLessThan(40);
    expect(compact.next.read.tool).toBe('survey_results_summary');
    expect(compact.question.method).toBe('scalar_distribution');
  });
});
