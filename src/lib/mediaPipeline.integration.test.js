import { pickRandomMediaForQuestion } from './surveyMediaInjection';
import { enrichSurveyResponses } from './enrichSurveyResponses';
import { buildQuestionLongCsv, buildQuestionExportFiles } from './questionSummaryExport';
import { buildResponsesWideCsv } from './responsesWideExport';
import {
  FIXTURE_POOL,
  FIXTURE_TAGS,
  setQuestion,
  categoryQuestion,
} from './__fixtures__/mediaPool';

describe('media pipeline integration: pick → enrich → export', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('set and category metadata stay consistent across long and wide exports', () => {
    const setQ = setQuestion({ imageCount: 2, name: 'q_set' });
    const catQ = categoryQuestion({
      name: 'q_cat',
      mediaPerCategory: 1,
      mediaFolders: ['cats/urban', 'cats/park'],
    });

    const setAssignment = pickRandomMediaForQuestion(
      FIXTURE_POOL,
      setQ,
      new Set(),
      new Set(),
      null,
      FIXTURE_TAGS,
    );
    const catAssignment = pickRandomMediaForQuestion(
      FIXTURE_POOL,
      catQ,
      new Set(),
      new Set(),
      null,
      FIXTURE_TAGS,
    );

    expect(setAssignment.setId).toBe('sets/s1');
    expect(catAssignment.categories).toEqual(['cats/park', 'cats/urban']);

    const displayedImages = {
      q_set: setAssignment.images.map((img) => img.url),
      q_cat: catAssignment.images.map((img) => img.url),
    };
    const displayedMediaGroups = { q_set: setAssignment.setId };
    const displayedMediaCategories = { q_cat: catAssignment.categories };

    const { enrichedResponses, displayed_media_groups, displayed_media_categories } = enrichSurveyResponses({
      responses: { q_set: 4, q_cat: 'image_0' },
      questionTypeMap: { q_set: 'imagerating', q_cat: 'imagepicker' },
      displayedImages,
      displayedMediaGroups,
      displayedMediaCategories,
      preloadedImages: FIXTURE_POOL,
    });

    expect(enrichedResponses.q_set.shown_media_set).toBe('sets/s1');
    expect(enrichedResponses.q_cat.shown_media_categories).toEqual(['cats/park', 'cats/urban']);

    const row = {
      participant_id: 'p1',
      created_at: '2026-07-12T00:00:00.000Z',
      responses: enrichedResponses,
      displayed_images: displayedImages,
      displayed_media_groups,
      displayed_media_categories,
      survey_metadata: { completion_code: 'ABC', attempt_index: 1 },
    };

    const longSet = buildQuestionLongCsv(setQ, [row], {});
    expect(longSet).toContain('shown_media_set');
    expect(longSet).toContain('sets/s1');

    const longCat = buildQuestionLongCsv(catQ, [row], {});
    expect(longCat).toContain('shown_media_categories');
    expect(longCat).toContain('cats/park|cats/urban');

    const wide = buildResponsesWideCsv([row], [setQ, catQ], {});
    expect(wide).toContain('q_set__shown_media_set');
    expect(wide).toContain('sets/s1');
    expect(wide).toContain('q_cat__shown_media_categories');
    expect(wide).toContain('cats/park|cats/urban');

    const files = buildQuestionExportFiles(setQ, [row], {});
    expect(files?.some((f) => f.path.includes('__long.csv'))).toBe(true);
  });

  test('legacy top-level displayed_media_* fallback still exports', () => {
    const setQ = setQuestion({ name: 'q_legacy' });
    const row = {
      participant_id: 'p2',
      responses: {
        q_legacy: {
          answer: 3,
          shown_images: ['https://r2.test/a.jpg'],
        },
      },
      displayed_media_groups: { q_legacy: 'sets/s1' },
      displayed_media_categories: { q_legacy: ['cats/urban'] },
    };
    const long = buildQuestionLongCsv(setQ, [row], {});
    expect(long).toContain('sets/s1');
    const wide = buildResponsesWideCsv([row], [setQ], {});
    expect(wide).toContain('sets/s1');
  });
});
