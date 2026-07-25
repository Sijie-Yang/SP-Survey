import { buildQuestionLongCsv, buildQuestionSummaryCsv } from './questionSummaryExport';

const question = {
  name: 'fc1',
  type: 'skillquestion',
  skillId: 'preset_image_preference_forced',
  title: 'Forced choice',
};

const responses = [
  {
    participant_id: 'p1',
    created_at: '2026-01-01T00:00:00Z',
    responses: {
      fc1: {
        answer: { choice: 'A', chosenIndex: 0 },
        shown_images: ['https://cdn.example/alpha.jpg', 'https://cdn.example/beta.jpg'],
      },
    },
  },
  {
    participant_id: 'p2',
    created_at: '2026-01-01T00:01:00Z',
    responses: {
      fc1: {
        answer: { choice: 'B', chosenIndex: 1 },
        shown_images: ['https://cdn.example/alpha.jpg', 'https://cdn.example/beta.jpg'],
      },
    },
  },
];

describe('Forced-Choice A/B export (imagepicker-shaped)', () => {
  test('long CSV has value = chosen media key', () => {
    const csv = buildQuestionLongCsv(question, responses, null);
    expect(csv).toContain('value');
    expect(csv).toContain('alpha.jpg');
    expect(csv).toContain('beta.jpg');
    expect(csv).not.toContain('schema_key');
  });

  test('summary CSV includes TrueSkill metrics', () => {
    const csv = buildQuestionSummaryCsv(question, responses);
    expect(csv).toContain('mu');
    expect(csv).toContain('mu_std5');
    expect(csv).toContain('wins');
    expect(csv).toContain('games');
    expect(csv).toContain('alpha.jpg');
    expect(csv).toContain('beta.jpg');
  });
});
