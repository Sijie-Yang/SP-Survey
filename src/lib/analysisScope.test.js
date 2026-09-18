import {
  analysisScopeKey,
  createAnalysisScope,
  filterRowsByScope,
  rowMatchesAnalysisScope,
  scopesEqual,
} from './analysisScope';

const human = {
  id: 'r1',
  project_id: 'p1',
  participant_id: 'a',
  created_at: '2026-09-17T08:00:00.000Z',
  survey_metadata: { survey_revision: 'v2', practice_mode: false },
  responses: { q1: 1 },
};
const practice = {
  ...human,
  id: 'r2',
  participant_id: 'b',
  survey_metadata: { survey_revision: 'v2', practice_mode: true },
};
const silicon = {
  ...human,
  id: 'r3',
  source: 'silicon',
  survey_metadata: { survey_revision: 'v2', silicon_run_id: 'run-1' },
};
const untimed = {
  ...human,
  id: 'r4',
  created_at: null,
  survey_metadata: { survey_revision: 'v2', completion_time: null },
};

describe('analysisScope', () => {
  test('formal analysis defaults to human data without practice', () => {
    const scope = createAnalysisScope({ projectId: 'p1' });
    expect(scope.dataSource).toBe('human');
    expect(scope.includePractice).toBe(false);
    expect(filterRowsByScope([human, practice, silicon], scope).map((row) => row.id)).toEqual(['r1']);
  });

  test('practice and silicon stay isolated unless selected', () => {
    expect(filterRowsByScope([human, practice], createAnalysisScope({
      projectId: 'p1',
      dataSource: 'practice',
    })).map((row) => row.id)).toEqual(['r2']);
    expect(filterRowsByScope([human, silicon], createAnalysisScope({
      projectId: 'p1',
      dataSource: 'silicon',
      siliconRunId: 'run-1',
    })).map((row) => row.id)).toEqual(['r3']);
  });

  test('date filters exclude untimed rows by default', () => {
    const scope = createAnalysisScope({
      projectId: 'p1',
      dateFrom: '2026-09-17',
      dateTo: '2026-09-17',
      timezone: 'UTC',
    });
    expect(rowMatchesAnalysisScope(human, scope)).toBe(true);
    expect(rowMatchesAnalysisScope(untimed, scope)).toBe(false);
    expect(rowMatchesAnalysisScope(untimed, { ...scope, untimedPolicy: 'include' })).toBe(true);
  });

  test('scope keys ignore snapshot timestamps', () => {
    const a = createAnalysisScope({ projectId: 'p1', generatedAt: '1' });
    const b = createAnalysisScope({ projectId: 'p1', generatedAt: '2' });
    expect(scopesEqual(a, b)).toBe(true);
    expect(analysisScopeKey(a)).toBe(analysisScopeKey(b));
  });
});
