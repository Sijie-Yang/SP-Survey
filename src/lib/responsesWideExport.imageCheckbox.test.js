import { buildResponsesWideCsv } from './responsesWideExport';

describe('responsesWideExport imagecheckbox / mediacheckbox', () => {
  test('emits __shown_images for imagecheckbox and mediacheckbox', () => {
    const questions = [
      {
        name: 'q_tags',
        type: 'imagecheckbox',
        title: 'Tag the image',
        choices: [
          { value: 'safe', text: 'Safe' },
          { value: 'busy', text: 'Busy' },
        ],
      },
      {
        name: 'q_media_tags',
        type: 'mediacheckbox',
        title: 'Tag the media',
        choices: [
          { value: 'loud', text: 'Loud' },
        ],
      },
    ];
    const responses = [
      {
        id: 'r1',
        participant_id: 'p1',
        created_at: '2026-01-01T00:00:00Z',
        responses: {
          q_tags: {
            answer: ['safe', 'busy'],
            shown_images: ['https://cdn.example/a.jpg'],
          },
          q_media_tags: {
            answer: ['loud'],
            shown_images: ['https://cdn.example/clip.mp4'],
          },
        },
      },
    ];

    const csv = buildResponsesWideCsv(responses, questions, {});
    expect(csv.includes('q_tags__shown_images')).toBe(true);
    expect(csv.includes('q_media_tags__shown_images')).toBe(true);
    expect(csv.includes('a.jpg')).toBe(true);
    expect(csv.includes('clip.mp4')).toBe(true);
    // Answer cells are JSON-encoded arrays in the wide export.
    expect(csv.includes('safe')).toBe(true);
    expect(csv.includes('busy')).toBe(true);
    expect(csv.includes('loud')).toBe(true);
  });
});
