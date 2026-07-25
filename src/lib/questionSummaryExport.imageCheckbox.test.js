import {
  buildQuestionSummaryCsv,
  buildQuestionLongCsv,
} from './questionSummaryExport';
import { skillFieldNativeQuestion } from './skillNativeAdapter.mjs';

describe('imagecheckbox / mediacheckbox export', () => {
  const question = {
    type: 'imagecheckbox',
    name: 'q_tags',
    title: 'Which apply?',
    choices: [
      { value: 'green', text: 'Greenery' },
      { value: 'safe', text: 'Safety' },
      { value: 'busy', text: 'Busy' },
    ],
  };

  const rows = [
    {
      participant_id: 'p1',
      created_at: '2026-07-12T00:00:00.000Z',
      responses: {
        q_tags: {
          answer: ['green', 'safe'],
          shown_images: ['https://r2.test/a.jpg'],
        },
      },
    },
    {
      participant_id: 'p2',
      created_at: '2026-07-12T00:00:01.000Z',
      responses: {
        q_tags: {
          answer: ['green'],
          shown_images: ['https://r2.test/a.jpg'],
        },
      },
    },
    {
      participant_id: 'p3',
      created_at: '2026-07-12T00:00:02.000Z',
      responses: {
        q_tags: {
          answer: ['busy', 'safe'],
          shown_images: ['https://r2.test/b.jpg'],
        },
      },
    },
  ];

  test('long emits one row per selected tag with shown_images', () => {
    const long = buildQuestionLongCsv(question, rows, {});
    expect(long).toContain('shown_images');
    expect(long).toContain('a.jpg');
    expect(long).toContain('green');
    expect(long).toContain('Greenery');
    const dataLines = long.split('\n').filter((line) => line && !/participant_id/.test(line));
    // p1:2 + p2:1 + p3:2
    expect(dataLines).toHaveLength(5);
  });

  test('summary is stimulus × tag select_count / select_rate', () => {
    const csv = buildQuestionSummaryCsv(question, rows);
    expect(csv).toContain('select_count');
    expect(csv).toContain('select_rate');
    expect(csv).toContain(',a.jpg,');
    expect(csv).toContain(',b.jpg,');
    expect(csv).toContain(',green,');
    // a.jpg: green selected by 2/2
    const greenA = csv
      .split('\n')
      .find((line) => line.includes(',a.jpg,') && line.includes(',green,') && line.includes(',select_rate,'));
    expect(greenA).toBeTruthy();
    expect(greenA).toMatch(/,1(\.0+)?,/);
  });

  test('mediacheckbox uses the same family', () => {
    const mediaQ = { ...question, type: 'mediacheckbox', name: 'q_mtags' };
    const mediaRows = rows.map((r) => ({
      ...r,
      responses: { q_mtags: r.responses.q_tags },
    }));
    const csv = buildQuestionSummaryCsv(mediaQ, mediaRows);
    expect(csv).toContain('select_rate');
    expect(csv).toContain('a.jpg');
  });

  test('skill multiChoice + media adapts to imagecheckbox and matches native export', () => {
    const image = 'https://r2.test/a.jpg';
    const native = {
      name: 'native',
      type: 'imagecheckbox',
      choices: [
        { value: 'green', text: 'green' },
        { value: 'safe', text: 'safe' },
        { value: 'busy', text: 'busy' },
      ],
    };
    const skillQ = {
      name: 'skill',
      type: 'skillquestion',
      imageCount: 1,
      skillResultSchema: [{ key: 'value', type: 'multiChoice', options: ['green', 'safe', 'busy'] }],
    };
    expect(skillFieldNativeQuestion(skillQ, skillQ.skillResultSchema[0])?.type).toBe('imagecheckbox');

    const skillRows = [{
      participant_id: 'p1',
      created_at: '2026-07-12T00:00:00.000Z',
      responses: {
        skill: {
          answer: { value: ['green', 'safe'], imageUrl: image },
          shown_images: [image],
        },
      },
    }];
    const nativeRows = [{
      participant_id: 'p1',
      created_at: '2026-07-12T00:00:00.000Z',
      responses: {
        native: {
          answer: ['green', 'safe'],
          shown_images: [image],
        },
      },
    }];
    const normalize = (csv) => String(csv).replaceAll('skill__value', 'native');
    expect(normalize(buildQuestionLongCsv(skillQ, skillRows, null)))
      .toBe(buildQuestionLongCsv(native, nativeRows, null));
    expect(normalize(buildQuestionSummaryCsv(skillQ, skillRows)))
      .toBe(buildQuestionSummaryCsv(native, nativeRows));
  });
});
