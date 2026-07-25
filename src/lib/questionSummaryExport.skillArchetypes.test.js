import { buildQuestionLongCsv, buildQuestionSummaryCsv } from './questionSummaryExport';

describe('custom skill archetypes — long + summary', () => {
  const question = {
    name: 'street1',
    type: 'skillquestion',
    skillId: 'skill_custom_points',
    skillResultSchema: [
      { key: 'marks', label: 'Marks', type: 'points' },
      { key: 'budget', label: 'Budget', type: 'allocation' },
      { key: 'order', label: 'Order', type: 'rankedList' },
      { key: 'score', label: 'Score', type: 'number' },
    ],
  };

  const rows = [{
    participant_id: 'p1',
    created_at: '2026-01-01T00:00:00Z',
    responses: {
      street1: {
        answer: {
          imageUrl: 'https://cdn.example/scene.jpg',
          marks: [
            { x: 0.2, y: 0.3, label: 'door' },
            { x: 0.7, y: 0.5, label: 'tree' },
          ],
          budget: { trees: 40, seats: 60 },
          order: ['A', 'B', 'C'],
          score: 72,
        },
        shown_images: ['https://cdn.example/scene.jpg'],
      },
    },
  }];

  test('long CSV expands points / allocation / rankedList and keeps answer_json', () => {
    const long = buildQuestionLongCsv(question, rows, null);
    expect(long).toContain('answer_json');
    expect(long).toContain('field_type');
    expect(long).toContain('points');
    expect(long).toContain('allocation');
    expect(long).toContain('rankedList');
    expect(long).toContain('door');
    expect(long).toContain('trees');
    expect(long).toContain('scene.jpg');
    // header + answer_json row + 2 points + 2 allocation + 3 ranks
    expect(long.trim().split('\n').length).toBeGreaterThanOrEqual(8);
  });

  test('summary CSV aggregates by media and archetype metrics', () => {
    const summary = buildQuestionSummaryCsv(question, rows);
    expect(summary).toContain('scene.jpg');
    expect(summary).toContain('label_count');
    expect(summary).toContain('score');
    expect(summary).toContain('avg_rank');
  });

  test('polygon and bbox expand like annotation vertices', () => {
    const q = {
      name: 'ann1',
      type: 'skillquestion',
      skillResultSchema: [
        { key: 'region', label: 'Region', type: 'polygon' },
        { key: 'box', label: 'Box', type: 'bbox' },
      ],
    };
    const annRows = [{
      participant_id: 'p1',
      created_at: '2026-01-01T00:00:00Z',
      responses: {
        ann1: {
          answer: {
            imageUrl: 'https://cdn.example/facade.jpg',
            region: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
            box: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.5 }],
          },
          shown_images: ['https://cdn.example/facade.jpg'],
        },
      },
    }];
    const long = buildQuestionLongCsv(q, annRows, null);
    expect(long).toContain('polygon');
    expect(long).toContain('bbox');
    expect(long).toContain('facade.jpg');
  });

  test('path field exports exactly like native imageannotation line shapes', () => {
    const q = {
      name: 'route1',
      type: 'skillquestion',
      skillResultSchema: [{ key: 'route', label: 'Route', type: 'path' }],
    };
    const pathRows = [{
      participant_id: 'p1',
      created_at: '2026-01-01T00:00:00Z',
      responses: {
        route1: {
          answer: {
            imageUrl: 'https://cdn.example/map.jpg',
            route: [
              { x: 0, y: 0, t: 0 },
              { x: 1, y: 0, t: 1 },
              { x: 1, y: 1, t: 2 },
            ],
          },
          shown_images: ['https://cdn.example/map.jpg'],
        },
      },
    }];
    const long = buildQuestionLongCsv(q, pathRows, null);
    expect(long).toContain('imageannotation');
    expect(long).toContain('line');
    expect(long.trim().split('\n').length).toBe(2); // header + one native annotation shape
    const summary = buildQuestionSummaryCsv(q, pathRows);
    expect(summary).toContain('tool_count');
  });

  test('multiChoice / matrix / mediaChoice / pairwise / bestWorst / timeRanges expand', () => {
    const q = {
      name: 'gap1',
      type: 'skillquestion',
      skillResultSchema: [
        { key: 'tags', type: 'multiChoice' },
        { key: 'grid', type: 'matrix' },
        { key: 'pick', type: 'mediaChoice' },
        { key: 'pref', type: 'pairwise' },
        { key: 'bw', type: 'bestWorst' },
        { key: 'moments', type: 'timeRanges' },
        { key: 'series', type: 'timeSeries' },
        { key: 'rankMedia', type: 'mediaRankedList' },
      ],
    };
    const gapRows = [{
      participant_id: 'p1',
      created_at: '2026-01-01T00:00:00Z',
      responses: {
        gap1: {
          answer: {
            imageUrl: 'https://cdn.example/v.mp4',
            tags: ['a', 'b'],
            grid: { comfort: 'agree' },
            pick: 'scene_a.jpg',
            pref: { preference: 25, imageA: 'a.jpg', imageB: 'b.jpg' },
            bw: { best: 'a.jpg', worst: 'c.jpg' },
            moments: [{ start: 1, end: 3, label: 'peak' }],
            series: [{ t: 0, v: 40 }, { t: 1, value: 55 }],
            rankMedia: ['a.jpg', 'b.jpg'],
          },
          shown_images: ['https://cdn.example/v.mp4', 'a.jpg', 'b.jpg', 'c.jpg'],
        },
      },
    }];
    const long = buildQuestionLongCsv(q, gapRows, null);
    expect(long).toContain('multiChoice');
    expect(long).toContain('matrix');
    expect(long).toContain('mediaChoice');
    expect(long).toContain('pairwise');
    expect(long).toContain('bestWorst');
    expect(long).toContain('timeRanges');
    expect(long).toContain('timeSeries');
    expect(long).toContain('mediaRankedList');
    const summary = buildQuestionSummaryCsv(q, gapRows);
    expect(summary).toContain('choice_count');
    expect(summary).toContain('cell_count');
    expect(summary).toContain('segment_count');
    expect(summary).toContain('best_count');
    expect(summary).toContain('avg_rank');
  });
});
