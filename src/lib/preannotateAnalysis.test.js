import {
  PREANNOTATE_QUESTION_NAME,
  preannotationsToAnalysisInputs,
} from './preannotateAnalysis';
import {
  buildQuestionLongCsv,
  buildQuestionExportFiles,
} from './questionSummaryExport';

describe('preannotateAnalysis → same pipeline as imageannotation', () => {
  const items = [
    {
      mediaEntry: { name: 'a.jpg', url: 'https://r2.test/a.jpg', media_id: 'id/a' },
      annotation: {
        media_id: 'id/a',
        name: 'a.jpg',
        image: 'https://r2.test/a.jpg',
        shapes: [
          { tool: 'polygon', label: 'building', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
        ],
        updated_at: '2026-07-12T00:00:00.000Z',
      },
    },
    {
      mediaEntry: { name: 'b.jpg', url: 'https://r2.test/b.jpg' },
      annotation: null,
    },
  ];

  test('maps annotated media into survey-like answers/responses', () => {
    const { answers, responses, annotatedCount, question } = preannotationsToAnalysisInputs(items);
    expect(annotatedCount).toBe(1);
    expect(question.name).toBe(PREANNOTATE_QUESTION_NAME);
    expect(answers).toHaveLength(1);
    expect(answers[0].answer.shapes).toHaveLength(1);
    expect(responses[0].participant_id).toBe('id/a');
    expect(responses[0].responses.preannotate.shown_images).toEqual(['https://r2.test/a.jpg']);
  });

  test('question export long/summary works on mapped rows', () => {
    const { question, responses } = preannotationsToAnalysisInputs(items);
    const long = buildQuestionLongCsv(question, responses, {});
    expect(long).toContain('tool');
    expect(long).toContain('polygon');
    expect(long).toContain('building');
    expect(long).toContain('a.jpg');

    const files = buildQuestionExportFiles(question, responses, {});
    const paths = files.map((f) => f.path);
    expect(paths).toContain('questions/preannotate__long.csv');
    expect(paths).toContain('questions/preannotate__summary__label__building.csv');
    expect(paths).toContain('questions/preannotate__summary__tool__polygon.csv');
  });
});
