import {
  buildQuestionSummaryCsv,
  buildQuestionLongCsv,
  buildQuestionExportFiles,
} from './questionSummaryExport';

describe('imagepointallocation / mediapointallocation summary = attribute tab × image unit', () => {
  const question = {
    type: 'imagepointallocation',
    name: 'q_pa',
    title: 'Allocate points',
    budget: 100,
    choices: [
      { value: 'greenery', text: 'Greenery' },
      { value: 'safety', text: 'Safety' },
    ],
  };

  const rows = [
    {
      participant_id: 'p1',
      created_at: '2026-07-12T00:00:00.000Z',
      responses: {
        q_pa: {
          answer: { greenery: 60, safety: 40 },
          shown_images: ['https://r2.test/a.jpg'],
        },
      },
    },
    {
      participant_id: 'p2',
      created_at: '2026-07-12T00:00:01.000Z',
      responses: {
        q_pa: {
          answer: { greenery: 40, safety: 60 },
          shown_images: ['https://r2.test/a.jpg'],
        },
      },
    },
    {
      participant_id: 'p3',
      created_at: '2026-07-12T00:00:02.000Z',
      responses: {
        q_pa: {
          answer: { greenery: 70, safety: 30 },
          shown_images: ['https://r2.test/b.jpg'],
        },
      },
    },
  ];

  test('long keeps shown_images with each choice cell', () => {
    const long = buildQuestionLongCsv(question, rows, {});
    expect(long).toContain('shown_images');
    expect(long).toContain('a.jpg');
    expect(long).toContain('greenery');
    expect(long).toContain('choice_key');
  });

  test('summary uses attribute_* columns and unit = image only', () => {
    const csv = buildQuestionSummaryCsv(question, rows);
    expect(csv).toContain('attribute_key');
    expect(csv).toContain(',greenery,');
    expect(csv).toContain(',safety,');
    expect(csv).toContain(',a.jpg,');
    expect(csv).toContain(',b.jpg,');
    expect(csv).not.toContain('a.jpg__greenery');
    expect(csv).not.toContain('b.jpg__safety');

    const greeneryMean = csv
      .split('\n')
      .find((line) => line.includes(',greenery,') && line.includes(',a.jpg,') && line.includes(',mean,'));
    expect(greeneryMean).toBeTruthy();
    expect(greeneryMean).toContain(',50,');
  });

  test('export zip emits one summary file per attribute tab', () => {
    const files = buildQuestionExportFiles(question, rows, {});
    const paths = files.map((f) => f.path);
    expect(paths).toContain('questions/q_pa__long.csv');
    expect(paths).toContain('questions/q_pa__summary.csv');
    expect(paths).toContain('questions/q_pa__summary__greenery.csv');
    expect(paths).toContain('questions/q_pa__summary__safety.csv');

    const greeneryFile = files.find((f) => f.path.endsWith('__summary__greenery.csv'));
    expect(greeneryFile.content).toContain('a.jpg');
    expect(greeneryFile.content).toContain('b.jpg');
    expect(greeneryFile.content).not.toContain(',safety,');
  });

  test('mediapointallocation uses the same schema', () => {
    const mediaQ = { ...question, type: 'mediapointallocation', name: 'q_mp' };
    const mediaRows = rows.map((r) => ({
      ...r,
      responses: { q_mp: r.responses.q_pa },
    }));
    const csv = buildQuestionSummaryCsv(mediaQ, mediaRows);
    expect(csv).toContain('attribute_key');
    expect(csv).toContain(',a.jpg,');
    expect(csv).not.toContain('a.jpg__greenery');
  });
});
