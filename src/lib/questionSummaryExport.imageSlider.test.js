import {
  buildQuestionSummaryCsv,
  buildQuestionLongCsv,
  buildQuestionExportFiles,
} from './questionSummaryExport';

describe('imageslidergroup / mediaslidergroup summary = attribute tab × image unit', () => {
  const question = {
    type: 'imageslidergroup',
    name: 'q_sg',
    title: 'Rate scenes',
    scaleMin: 1,
    scaleMax: 7,
    dimensions: [
      { id: 'appeal', left: 'Ugly', right: 'Beautiful', label: 'Visual appeal' },
      { id: 'comfort', left: 'Unsafe', right: 'Safe', label: 'Comfort' },
    ],
  };

  const rows = [
    {
      participant_id: 'p1',
      created_at: '2026-07-12T00:00:00.000Z',
      responses: {
        q_sg: {
          answer: { appeal: 5, comfort: 4 },
          shown_images: ['https://r2.test/a.jpg'],
        },
      },
    },
    {
      participant_id: 'p2',
      created_at: '2026-07-12T00:00:01.000Z',
      responses: {
        q_sg: {
          answer: { appeal: 3, comfort: 4 },
          shown_images: ['https://r2.test/a.jpg'],
        },
      },
    },
    {
      participant_id: 'p3',
      created_at: '2026-07-12T00:00:02.000Z',
      responses: {
        q_sg: {
          answer: { appeal: 6, comfort: 5 },
          shown_images: ['https://r2.test/b.jpg'],
        },
      },
    },
  ];

  test('long keeps shown_images with each dimension cell', () => {
    const long = buildQuestionLongCsv(question, rows, {});
    expect(long).toContain('shown_images');
    expect(long).toContain('a.jpg');
    expect(long).toContain('appeal');
    expect(long).toContain('dimension_id');
  });

  test('summary uses attribute_* columns and unit = image only', () => {
    const csv = buildQuestionSummaryCsv(question, rows);
    expect(csv).toContain('attribute_key');
    expect(csv).toContain(',appeal,');
    expect(csv).toContain(',comfort,');
    expect(csv).toContain(',a.jpg,');
    expect(csv).toContain(',b.jpg,');
    expect(csv).not.toContain('a.jpg__appeal');
    expect(csv).not.toContain('b.jpg__comfort');

    const appealMean = csv
      .split('\n')
      .find((line) => line.includes(',appeal,') && line.includes(',a.jpg,') && line.includes(',mean,'));
    expect(appealMean).toBeTruthy();
    expect(appealMean).toContain(',4,');
  });

  test('export zip emits one summary file per attribute tab', () => {
    const files = buildQuestionExportFiles(question, rows, {});
    const paths = files.map((f) => f.path);
    expect(paths).toContain('questions/q_sg__long.csv');
    expect(paths).toContain('questions/q_sg__summary.csv');
    expect(paths).toContain('questions/q_sg__summary__appeal.csv');
    expect(paths).toContain('questions/q_sg__summary__comfort.csv');

    const appealFile = files.find((f) => f.path.endsWith('__summary__appeal.csv'));
    expect(appealFile.content).toContain('a.jpg');
    expect(appealFile.content).toContain('b.jpg');
    expect(appealFile.content).not.toContain(',comfort,');
  });

  test('mediaslidergroup uses the same schema', () => {
    const mediaQ = { ...question, type: 'mediaslidergroup', name: 'q_ms' };
    const mediaRows = rows.map((r) => ({
      ...r,
      responses: { q_ms: r.responses.q_sg },
    }));
    const csv = buildQuestionSummaryCsv(mediaQ, mediaRows);
    expect(csv).toContain('attribute_key');
    expect(csv).toContain(',a.jpg,');
    expect(csv).not.toContain('a.jpg__appeal');
  });
});
