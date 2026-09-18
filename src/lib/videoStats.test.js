import {
  aggregateSegmentTimelineByVideo,
  summarizeVideoMomentsByVideo,
} from './videoStats';

describe('video key moments by video', () => {
  const answers = [
    {
      answer: {
        videoName: 'walk_a.mp4',
        videoUrl: 'https://cdn.example/walk_a.mp4',
        duration: 30,
        segments: [{ start: 2, end: 5 }, { start: 10, end: 12 }],
      },
      shown_images: ['https://cdn.example/walk_a.mp4'],
    },
    {
      answer: {
        videoName: 'walk_a.mp4',
        videoUrl: 'https://cdn.example/walk_a.mp4',
        duration: 30,
        segments: [{ start: 3, end: 6 }],
      },
      shown_images: ['https://cdn.example/walk_a.mp4'],
    },
    {
      answer: {
        videoName: 'walk_b.mp4',
        videoUrl: 'https://cdn.example/walk_b.mp4',
        duration: 40,
        segments: [{ start: 1, end: 4 }],
      },
      shown_images: ['https://cdn.example/walk_b.mp4'],
    },
  ];

  test('groups timelines by video', () => {
    const groups = aggregateSegmentTimelineByVideo(answers);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.videoKey).sort()).toEqual(['walk_a.mp4', 'walk_b.mp4']);
    const a = groups.find((g) => g.videoKey === 'walk_a.mp4');
    expect(a.answers).toHaveLength(2);
    expect(a.agg.totalSegments).toBe(3);
    expect(a.agg.n).toBe(2);
  });

  test('summary stats are per video', () => {
    const rows = summarizeVideoMomentsByVideo(answers);
    const a = rows.find((r) => r.videoKey === 'walk_a.mp4');
    const b = rows.find((r) => r.videoKey === 'walk_b.mp4');
    expect(a.nResponses).toBe(2);
    expect(a.totalSegments).toBe(3);
    expect(a.meanSegments).toBe(1.5);
    expect(b.nResponses).toBe(1);
    expect(b.totalSegments).toBe(1);
  });
});
