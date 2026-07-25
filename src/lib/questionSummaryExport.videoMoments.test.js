import { buildQuestionLongCsv, buildQuestionSummaryCsv } from './questionSummaryExport';

const question = {
  name: 'vm1',
  type: 'skillquestion',
  skillId: 'preset_video_moment_tag',
  title: 'Key moments',
};

const responses = [
  {
    participant_id: 'p1',
    created_at: '2026-01-01T00:00:00Z',
    responses: {
      vm1: {
        answer: {
          videoName: 'clip_a.mp4',
          videoUrl: 'https://cdn.example/clip_a.mp4',
          duration: 20,
          segments: [{ start: 1, end: 3 }, { start: 8, end: 10 }],
        },
        shown_images: ['https://cdn.example/clip_a.mp4'],
      },
    },
  },
  {
    participant_id: 'p2',
    created_at: '2026-01-01T00:01:00Z',
    responses: {
      vm1: {
        answer: {
          videoName: 'clip_b.mp4',
          videoUrl: 'https://cdn.example/clip_b.mp4',
          duration: 25,
          segments: [{ start: 2, end: 4 }],
        },
        shown_images: ['https://cdn.example/clip_b.mp4'],
      },
    },
  },
];

describe('Video Key Moments export by video', () => {
  test('long CSV is one row per segment with video in shown_images', () => {
    const csv = buildQuestionLongCsv(question, responses, null);
    expect(csv).toContain('segment_index');
    expect(csv).toContain('start');
    expect(csv).toContain('end');
    expect(csv).not.toContain('schema_key');
    const dataLines = csv.trim().split('\n').slice(1);
    expect(dataLines).toHaveLength(3);
    expect(csv).toContain('clip_a.mp4');
    expect(csv).toContain('clip_b.mp4');
  });

  test('summary CSV breaks out metrics per video unit', () => {
    const csv = buildQuestionSummaryCsv(question, responses);
    expect(csv).toContain('clip_a.mp4');
    expect(csv).toContain('clip_b.mp4');
    expect(csv).toContain('mean_segments');
    expect(csv).toContain('total_segments');
    expect(csv).toContain('n_responses');
    expect(csv).toContain('peak_time');
  });
});
