import {
  buildQuestionSummaryCsv,
  buildQuestionLongCsv,
  buildQuestionExportFiles,
} from './questionSummaryExport';

describe('imagematrix / mediamatrix summary = attribute tab × image unit', () => {
  const question = {
    type: 'imagematrix',
    name: 'q_mx',
    title: 'Rate scenes',
    rows: [
      { value: 'appeal', text: 'Visual appeal' },
      { value: 'comfort', text: 'Comfort' },
    ],
    columns: [
      { value: '1', text: '1' },
      { value: '2', text: '2' },
      { value: '3', text: '3' },
    ],
  };

  const rows = [
    {
      participant_id: 'p1',
      created_at: '2026-07-12T00:00:00.000Z',
      responses: {
        q_mx: {
          answer: { appeal: '3', comfort: '2' },
          shown_images: ['https://r2.test/a.jpg'],
        },
      },
    },
    {
      participant_id: 'p2',
      created_at: '2026-07-12T00:00:01.000Z',
      responses: {
        q_mx: {
          answer: { appeal: '1', comfort: '2' },
          shown_images: ['https://r2.test/a.jpg'],
        },
      },
    },
    {
      participant_id: 'p3',
      created_at: '2026-07-12T00:00:02.000Z',
      responses: {
        q_mx: {
          answer: { appeal: '3', comfort: '3' },
          shown_images: ['https://r2.test/b.jpg'],
        },
      },
    },
  ];

  test('long keeps shown_images with each attribute cell', () => {
    const long = buildQuestionLongCsv(question, rows, {});
    expect(long).toContain('shown_images');
    expect(long).toContain('a.jpg');
    expect(long).toContain('appeal');
  });

  test('summary uses attribute_* columns and unit = image only', () => {
    const csv = buildQuestionSummaryCsv(question, rows);
    expect(csv).toContain('attribute_key');
    expect(csv).toContain(',appeal,');
    expect(csv).toContain(',comfort,');
    expect(csv).toContain(',a.jpg,');
    expect(csv).toContain(',b.jpg,');
    // no concatenated image__attr unit keys
    expect(csv).not.toContain('a.jpg__appeal');
    expect(csv).not.toContain('b.jpg__comfort');

    const appealMean = csv
      .split('\n')
      .find((line) => line.includes(',appeal,') && line.includes(',a.jpg,') && line.includes(',mean,'));
    expect(appealMean).toBeTruthy();
    expect(appealMean).toContain(',2,');
  });

  test('export zip emits one summary file per attribute tab', () => {
    const files = buildQuestionExportFiles(question, rows, {});
    const paths = files.map((f) => f.path);
    expect(paths).toContain('questions/q_mx__long.csv');
    expect(paths).toContain('questions/q_mx__summary.csv');
    expect(paths).toContain('questions/q_mx__summary__appeal.csv');
    expect(paths).toContain('questions/q_mx__summary__comfort.csv');

    const appealFile = files.find((f) => f.path.endsWith('__summary__appeal.csv'));
    expect(appealFile.content).toContain('a.jpg');
    expect(appealFile.content).toContain('b.jpg');
    expect(appealFile.content).not.toContain(',comfort,');
  });

  test('mediamatrix uses the same schema', () => {
    const mediaQ = { ...question, type: 'mediamatrix', name: 'q_mm' };
    const mediaRows = rows.map((r) => ({
      ...r,
      responses: { q_mm: r.responses.q_mx },
    }));
    const csv = buildQuestionSummaryCsv(mediaQ, mediaRows);
    expect(csv).toContain('attribute_key');
    expect(csv).toContain(',a.jpg,');
    expect(csv).not.toContain('a.jpg__appeal');
  });
});
