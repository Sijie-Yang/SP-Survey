import { buildQuestionLongCsv, buildQuestionSummaryCsv } from './questionSummaryExport';

const question = {
  name: 'bw1',
  type: 'skillquestion',
  skillId: 'preset_best_worst_choice',
  title: 'Best worst',
  skillConfig: { mediaCount: 4 },
};

const shown = [
  'https://cdn.example/a.jpg',
  'https://cdn.example/b.jpg',
  'https://cdn.example/c.jpg',
  'https://cdn.example/d.jpg',
];

const responses = [
  {
    participant_id: 'p1',
    created_at: '2026-01-01T00:00:00Z',
    responses: {
      bw1: {
        answer: { bestIndex: 0, worstIndex: 3, complete: true },
        shown_images: shown,
      },
    },
  },
  {
    participant_id: 'p2',
    created_at: '2026-01-01T00:01:00Z',
    responses: {
      bw1: {
        answer: { bestIndex: 0, worstIndex: 2, complete: true },
        shown_images: shown,
      },
    },
  },
];

describe('Best–Worst MaxDiff export (imagechoice-shaped)', () => {
  test('long CSV is one row per trial with best + worst keys', () => {
    const csv = buildQuestionLongCsv(question, responses, null);
    expect(csv).toContain('best');
    expect(csv).toContain('worst');
    expect(csv).not.toContain('schema_key');
    expect(csv).not.toContain('bestIndex');
    const dataLines = csv.trim().split('\n').slice(1);
    expect(dataLines).toHaveLength(2);
    expect(dataLines[0]).toContain('a.jpg');
    expect(dataLines[0]).toContain('d.jpg');
  });

  test('summary CSV ranks images with TrueSkill + BWS metrics', () => {
    const csv = buildQuestionSummaryCsv(question, responses);
    expect(csv).toContain('mu');
    expect(csv).toContain('mu_std5');
    expect(csv).toContain('bws');
    expect(csv).toContain('best');
    expect(csv).toContain('worst');
    expect(csv).toContain('appearances');
    // a.jpg won both trials → should appear with high rank metrics
    expect(csv).toContain('a.jpg');
    const rankRows = csv.split('\n').filter((l) => l.includes(',rank,'));
    expect(rankRows.length).toBeGreaterThanOrEqual(2);
    // First rank unit should be a.jpg (μ-sorted)
    expect(rankRows[0]).toContain('a.jpg');
  });
});
