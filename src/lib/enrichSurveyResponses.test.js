import {
  enrichSurveyResponses,
  mapImageChoiceAnswerToNames,
} from './enrichSurveyResponses';

describe('enrichSurveyResponses', () => {
  test('maps image_N answers and preserves set/category metadata', () => {
    const preloaded = [
      { name: 'a.jpg', url: 'https://r2.test/a.jpg', media_id: 'user/proj/sets/s1/a.jpg', key: 'user/proj/sets/s1/a.jpg' },
      { name: 'b.jpg', url: 'https://r2.test/b.jpg', media_id: 'user/proj/sets/s1/b.jpg', key: 'user/proj/sets/s1/b.jpg' },
    ];
    const result = enrichSurveyResponses({
      responses: { q1: 'image_0', q2: ['image_1', 'image_0'] },
      questionTypeMap: { q1: 'imagepicker', q2: 'imagepicker' },
      displayedImages: {
        q1: ['https://r2.test/a.jpg', 'https://r2.test/b.jpg'],
        q2: ['https://r2.test/a.jpg', 'https://r2.test/b.jpg'],
      },
      displayedMediaGroups: { q1: 'sets/s1' },
      displayedMediaCategories: { q2: ['cats/park', 'cats/urban'] },
      preloadedImages: preloaded,
    });

    expect(result.enrichedResponses.q1.answer).toBe('https://r2.test/a.jpg');
    expect(result.enrichedResponses.q1.shown_media_set).toBe('sets/s1');
    expect(result.enrichedResponses.q1.shown_media_group).toBe('sets/s1');
    expect(result.enrichedResponses.q1.shown_media_ids).toEqual([
      'user/proj/sets/s1/a.jpg',
      'user/proj/sets/s1/b.jpg',
    ]);
    expect(result.enrichedResponses.q2.answer).toEqual([
      'https://r2.test/b.jpg',
      'https://r2.test/a.jpg',
    ]);
    expect(result.enrichedResponses.q2.shown_media_categories).toEqual(['cats/park', 'cats/urban']);
    expect(result.displayed_media_groups).toEqual({ q1: 'sets/s1' });
    expect(result.displayed_media_categories).toEqual({ q2: ['cats/park', 'cats/urban'] });
  });

  test('mapImageChoiceAnswerToNames leaves non-image tokens alone', () => {
    expect(mapImageChoiceAnswerToNames('other', ['a.jpg'])).toBe('other');
    expect(mapImageChoiceAnswerToNames(3, ['a.jpg'])).toBe(3);
  });
});
