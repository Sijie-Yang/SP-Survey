import {
  buildQuestionSummaryCsv,
  buildQuestionLongCsv,
  buildQuestionExportFiles,
} from './questionSummaryExport';

describe('imageannotation summary = label + tool dimensions × image unit', () => {
  const question = {
    type: 'imageannotation',
    name: 'q_ann',
    title: 'Annotate',
    annotationLabels: ['building', 'tree'],
    allowedTools: ['point', 'line', 'polygon', 'bbox'],
  };

  const rows = [
    {
      participant_id: 'p1',
      created_at: '2026-07-12T00:00:00.000Z',
      responses: {
        q_ann: {
          answer: {
            shapes: [
              { tool: 'polygon', label: 'building', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }] },
              { tool: 'point', label: 'tree', points: [{ x: 0.5, y: 0.5 }] },
            ],
          },
          shown_images: ['https://r2.test/a.jpg'],
        },
      },
    },
    {
      participant_id: 'p2',
      created_at: '2026-07-12T00:00:01.000Z',
      responses: {
        q_ann: {
          answer: {
            shapes: [
              // legacy tool id still counted as polygon
              { tool: 'region', label: 'building', points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.2, y: 0.3 }] },
            ],
          },
          shown_images: ['https://r2.test/b.jpg'],
        },
      },
    },
  ];

  test('long includes tool and label columns', () => {
    const long = buildQuestionLongCsv(question, rows, {});
    expect(long).toContain('tool');
    expect(long).toContain('label');
    expect(long).toContain('polygon');
    expect(long).toContain('building');
    expect(long).toContain('a.jpg');
  });

  test('summary splits by label and tool with unit = image', () => {
    const csv = buildQuestionSummaryCsv(question, rows);
    expect(csv).toContain('label_count');
    expect(csv).toContain('tool_count');
    expect(csv).toContain(',building,');
    expect(csv).toContain(',polygon,');
    expect(csv).toContain(',a.jpg,');
    expect(csv).toContain(',b.jpg,');
    expect(csv).not.toContain('label__building');
    expect(csv).not.toContain('image__a.jpg');
  });

  test('export zip emits per-label and per-tool summary files', () => {
    const files = buildQuestionExportFiles(question, rows, {});
    const paths = files.map((f) => f.path);
    expect(paths).toContain('questions/q_ann__long.csv');
    expect(paths).toContain('questions/q_ann__summary.csv');
    expect(paths).toContain('questions/q_ann__summary__label__building.csv');
    expect(paths).toContain('questions/q_ann__summary__label__tree.csv');
    expect(paths).toContain('questions/q_ann__summary__tool__polygon.csv');
    expect(paths).toContain('questions/q_ann__summary__tool__point.csv');
  });
});
