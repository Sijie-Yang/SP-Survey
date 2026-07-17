import { expandQuestionAnswerUnits } from './responseAnswerUnits';

describe('expandQuestionAnswerUnits', () => {
  test('expands multi-trial enriched answers with per-trial media', () => {
    const row = {
      participant_id: 'p1',
      responses: {
        q: {
          type: 'imagerating',
          trials: [
            { trial_index: 0, answer: 5, shown_images: ['a.jpg'] },
            { trial_index: 1, answer: 2, shown_images: ['b.jpg'] },
          ],
          answer: [5, 2],
          shown_images: ['a.jpg'],
        },
      },
    };
    const units = expandQuestionAnswerUnits(row, 'q');
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({ answer: 5, shown_images: ['a.jpg'], trial_index: 0, participant_id: 'p1' });
    expect(units[1]).toMatchObject({ answer: 2, shown_images: ['b.jpg'], trial_index: 1 });
  });

  test('single answer stays one unit', () => {
    const row = {
      participant_id: 'p2',
      responses: { q: { type: 'rating', answer: 4, shown_images: [] } },
    };
    expect(expandQuestionAnswerUnits(row, 'q')).toEqual([{
      answer: 4,
      shown_images: [],
      shown_media: [],
      shown_media_ids: [],
      trial_index: 0,
      participant_id: 'p2',
    }]);
  });

  test('skips empty trial slots', () => {
    const row = {
      responses: {
        q: {
          trials: [
            { value: 'x', shown_images: ['a.jpg'] },
            { value: null, shown_images: ['b.jpg'] },
          ],
        },
      },
    };
    expect(expandQuestionAnswerUnits(row, 'q')).toHaveLength(1);
    expect(expandQuestionAnswerUnits(row, 'q')[0].answer).toBe('x');
  });

  test('recovers answer array paired with __trials media', () => {
    const row = {
      participant_id: 'p3',
      displayed_images: {
        q: ['a.jpg'],
        'q__trials': [['a.jpg'], ['b.jpg'], ['c.jpg']],
      },
      responses: {
        q: {
          type: 'imagerating',
          answer: [5, 3, 1],
          shown_images: ['a.jpg'],
        },
      },
    };
    const units = expandQuestionAnswerUnits(row, 'q');
    expect(units).toHaveLength(3);
    expect(units.map((u) => u.answer)).toEqual([5, 3, 1]);
    expect(units[2].shown_images).toEqual(['c.jpg']);
  });
});
