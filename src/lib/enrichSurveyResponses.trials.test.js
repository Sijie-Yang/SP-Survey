import { enrichSurveyResponses } from './enrichSurveyResponses';

describe('enrichSurveyResponses multi-trial', () => {
  test('expands trials array with per-trial shown_images', () => {
    const { enrichedResponses } = enrichSurveyResponses({
      responses: {
        sim: {
          trials: [
            { value: 5, shown_images: ['a.jpg', 'b.jpg'] },
            { value: 2, shown_images: ['c.jpg', 'd.jpg'] },
          ],
        },
      },
      questionTypeMap: { sim: 'imagerating' },
      preloadedImages: [
        { url: 'a.jpg', name: 'a.jpg', media_id: 'a' },
        { url: 'b.jpg', name: 'b.jpg', media_id: 'b' },
        { url: 'c.jpg', name: 'c.jpg', media_id: 'c' },
        { url: 'd.jpg', name: 'd.jpg', media_id: 'd' },
      ],
    });
    expect(enrichedResponses.sim.trials).toHaveLength(2);
    expect(enrichedResponses.sim.trials[0].answer).toBe(5);
    expect(enrichedResponses.sim.trials[1].shown_images).toEqual(['c.jpg', 'd.jpg']);
    expect(enrichedResponses.sim.answer).toEqual([5, 2]);
  });
});
