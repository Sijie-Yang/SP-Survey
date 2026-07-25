import { buildQuestionLongCsv, buildQuestionSummaryCsv } from './questionSummaryExport';

describe('remaining skill presets — one-row answers + media summary', () => {
  test('pairwise slider: one long row; summary by image', () => {
    const q = {
      name: 'ps1',
      type: 'skillquestion',
      skillId: 'preset_image_preference_slider',
    };
    const rows = [{
      participant_id: 'p1',
      created_at: '2026-01-01T00:00:00Z',
      responses: {
        ps1: {
          answer: {
            preference: 40,
            hardToDecide: false,
            interpretation: 'prefer_B',
            imageA: 'https://cdn.example/a.jpg',
            imageB: 'https://cdn.example/b.jpg',
          },
          shown_images: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
        },
      },
    }];
    const long = buildQuestionLongCsv(q, rows, null);
    expect(long).toContain('preference');
    expect(long).not.toContain('schema_key');
    expect(long.trim().split('\n')).toHaveLength(2);
    const summary = buildQuestionSummaryCsv(q, rows);
    expect(summary).toContain('a.jpg');
    expect(summary).toContain('b.jpg');
    expect(summary).toContain('mean');
  });

  test('emotion color: one long row; summary by image', () => {
    const q = {
      name: 'ec1',
      type: 'skillquestion',
      skillId: 'preset_emotion_color_picker',
    };
    const rows = [{
      participant_id: 'p1',
      created_at: '2026-01-01T00:00:00Z',
      responses: {
        ec1: {
          answer: {
            imageUrl: 'https://cdn.example/scene.jpg',
            color: {
              hex: '#ff0000', hue: 0, intensity: 80, optionId: 'red', label: 'Red', source: 'palette',
            },
          },
          shown_images: ['https://cdn.example/scene.jpg'],
        },
      },
    }];
    const long = buildQuestionLongCsv(q, rows, null);
    expect(long).toContain('hex');
    expect(long).toContain('#ff0000');
    expect(long).not.toContain('schema_key');
    expect(long.trim().split('\n')).toHaveLength(2);
    const summary = buildQuestionSummaryCsv(q, rows);
    expect(summary).toContain('scene.jpg');
    expect(summary).toContain('hue');
  });

  test('continuous video: sample rows; summary by video', () => {
    const q = {
      name: 'cv1',
      type: 'skillquestion',
      skillId: 'preset_video_continuous_rating',
    };
    const rows = [{
      participant_id: 'p1',
      created_at: '2026-01-01T00:00:00Z',
      responses: {
        cv1: {
          answer: {
            videoUrl: 'https://cdn.example/walk.mp4',
            mean: 55,
            sampleCount: 2,
            samples: [{ t: 0, v: 50 }, { t: 1, v: 60 }],
          },
          shown_images: ['https://cdn.example/walk.mp4'],
        },
      },
    }];
    const long = buildQuestionLongCsv(q, rows, null);
    expect(long).toContain('time_s');
    expect(long).not.toContain('schema_key');
    expect(long.trim().split('\n')).toHaveLength(3);
    const summary = buildQuestionSummaryCsv(q, rows);
    expect(summary).toContain('walk.mp4');
    expect(summary).toContain('n_responses');
  });

  test('generic skill: one answer_json row; summary by media', () => {
    const q = {
      name: 'g1',
      type: 'skillquestion',
      skillId: 'custom_my_skill',
    };
    const rows = [{
      participant_id: 'p1',
      created_at: '2026-01-01T00:00:00Z',
      responses: {
        g1: {
          answer: { score: 7, imageUrl: 'https://cdn.example/x.jpg' },
          shown_images: ['https://cdn.example/x.jpg'],
        },
      },
    }];
    const long = buildQuestionLongCsv(q, rows, null);
    expect(long).toContain('answer_json');
    expect(long).not.toContain('schema_key');
    expect(long.trim().split('\n')).toHaveLength(2);
    const summary = buildQuestionSummaryCsv(q, rows);
    expect(summary).toContain('x.jpg');
    expect(summary).toContain('score');
  });
});
