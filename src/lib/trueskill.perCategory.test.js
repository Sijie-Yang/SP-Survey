import { buildQuestionSummaryRows } from './questionSummaryExport';
import {
  computeForcedChoiceTrueSkill,
  computeMaxDiffTrueSkill,
  computeQuestionTrueSkill,
  computeTrueSkillFromMatches,
  matchesFromOrderedRanking,
  attachMatchCategory,
} from './trueskill';

const single = {
  name: 'q',
  type: 'imagepicker',
  mediaAssignmentMode: 'category',
  mediaCategoryMode: 'single',
};

function responseWithTrials(trials, extra = {}) {
  return {
    participant_id: 'p1',
    responses: {
      q: {
        ...extra,
        trials,
      },
    },
  };
}

function pickerTrials() {
  const park = { answer: 'park-a.jpg', shown_images: ['park-a.jpg', 'park-b.jpg'], shown_media_categories: ['park'] };
  const urban = { answer: 'urban-c.jpg', shown_images: ['urban-c.jpg', 'urban-d.jpg'], shown_media_categories: ['urban'] };
  return [...Array.from({ length: 6 }, () => ({ ...park })), urban];
}

function winner(result, category, key) {
  return result.categories
    .find((board) => board.category === category)
    .rankings
    .find((row) => row.imageKey === key);
}

describe('TrueSkill one-category-per-trial', () => {
  test('picker, forced choice, and MaxDiff keep rank and muStd5 inside each category', () => {
    const responses = [responseWithTrials(pickerTrials())];
    const pooled = computeQuestionTrueSkill(responses, 'q', { ...single, mediaCategoryMode: 'all' });
    const split = computeQuestionTrueSkill(responses, 'q', single);
    expect(split.splitByCategory).toBe(true);
    expect(split.categories.map((board) => board.category)).toEqual(['park', 'urban']);
    expect(winner(split, 'park', 'park-a.jpg').rank).toBe(1);
    expect(winner(split, 'park', 'park-a.jpg').muStd5).toBeCloseTo(5);
    expect(winner(split, 'urban', 'urban-c.jpg').rank).toBe(1);
    expect(winner(split, 'urban', 'urban-c.jpg').muStd5).toBeCloseTo(5);
    expect(winner(split, 'park', 'park-a.jpg').mu).toBeCloseTo(
      pooled.rankings.find((row) => row.imageKey === 'park-a.jpg').mu,
    );
    const pooledUrban = pooled.rankings.find((row) => row.imageKey === 'urban-c.jpg');
    expect(pooledUrban.rank).toBeGreaterThan(1);
    expect(pooledUrban.muStd5).toBeLessThan(5);
    expect(pooled.splitByCategory).toBe(false);

    const forced = [responseWithTrials([
      { answer: { choice: 'A', chosenIndex: 0 }, shown_images: ['park-a.jpg', 'park-b.jpg'], shown_media_categories: ['park'] },
      { answer: { choice: 'A', chosenIndex: 0 }, shown_images: ['park-a.jpg', 'park-b.jpg'], shown_media_categories: ['park'] },
      { answer: { choice: 'B', chosenIndex: 1 }, shown_images: ['urban-c.jpg', 'urban-d.jpg'], shown_media_categories: ['urban'] },
    ])];
    const forcedFit = computeForcedChoiceTrueSkill(forced, 'q', { ...single, type: 'skillquestion', skillId: 'preset_image_preference_forced' });
    expect(winner(forcedFit, 'park', 'park-a.jpg').muStd5).toBeCloseTo(5);
    expect(winner(forcedFit, 'urban', 'urban-d.jpg').rank).toBe(1);

    const maxdiff = [responseWithTrials([
      { answer: { bestIndex: 0, worstIndex: 2 }, shown_images: ['park-a.jpg', 'park-b.jpg', 'park-c.jpg'], shown_media_categories: ['park'] },
      { answer: { bestIndex: 0, worstIndex: 2 }, shown_images: ['park-a.jpg', 'park-b.jpg', 'park-c.jpg'], shown_media_categories: ['park'] },
      { answer: { bestIndex: 1, worstIndex: 0 }, shown_images: ['urban-c.jpg', 'urban-d.jpg', 'urban-e.jpg'], shown_media_categories: ['urban'] },
    ])];
    const maxdiffFit = computeMaxDiffTrueSkill(maxdiff, 'q', { ...single, type: 'skillquestion', skillId: 'preset_best_worst_choice' });
    expect(maxdiffFit.categories).toHaveLength(2);
    expect(winner(maxdiffFit, 'park', 'park-a.jpg').rank).toBe(1);
    expect(winner(maxdiffFit, 'park', 'park-a.jpg').muStd5).toBeCloseTo(5);
    expect(winner(maxdiffFit, 'urban', 'urban-d.jpg').muStd5).toBeCloseTo(5);
    expect(winner(maxdiffFit, 'urban', 'urban-d.jpg').rank).toBe(1);
  });

  test('a question-level category does not pull later trials into the first category', () => {
    const responses = [responseWithTrials([
      { answer: 'park-a.jpg', shown_images: ['park-a.jpg', 'park-b.jpg'], shown_media_categories: ['park'] },
      { answer: 'park-a.jpg', shown_images: ['park-a.jpg', 'park-b.jpg'] },
      { answer: 'urban-c.jpg', shown_images: ['urban-c.jpg', 'urban-d.jpg'], shown_media_categories: ['urban'] },
    ], { shown_media_categories: ['park'] })];
    const split = computeQuestionTrueSkill(responses, 'q', single);
    expect(split.categories.map((board) => board.label)).toEqual(['park', 'urban', 'Uncategorized']);
    expect(winner(split, 'urban', 'urban-c.jpg').rank).toBe(1);
    expect(split.categories.find((board) => board.label === 'Uncategorized').rankings.map((row) => row.imageKey).sort())
      .toEqual(['park-a.jpg', 'park-b.jpg']);
  });

  test('ranking matches use the same per-category scale', () => {
    const matches = [
      ...attachMatchCategory(matchesFromOrderedRanking(['park-a.jpg', 'park-b.jpg']), ['park']),
      ...attachMatchCategory(matchesFromOrderedRanking(['park-a.jpg', 'park-b.jpg']), ['park']),
      ...attachMatchCategory(matchesFromOrderedRanking(['urban-c.jpg', 'urban-d.jpg']), ['urban']),
    ];
    const split = computeTrueSkillFromMatches(matches, { splitByCategory: true });
    const pooled = computeTrueSkillFromMatches(matches);
    expect(winner(split, 'urban', 'urban-c.jpg').muStd5).toBeCloseTo(5);
    expect(pooled.rankings.find((row) => row.imageKey === 'urban-c.jpg').muStd5).toBeLessThan(5);
  });

  test('summary export tags TrueSkill rank and muStd5 with the category', () => {
    const responses = [responseWithTrials(pickerTrials())];
    const rows = buildQuestionSummaryRows(single, responses);
    const leaders = rows.filter((row) => row.metric === 'rank' && Number(row.value) === 1);
    expect(leaders.map((row) => row.attribute_key).sort()).toEqual(['park', 'urban']);
    expect(leaders.map((row) => row.unit_key).sort()).toEqual(['park-a.jpg', 'urban-c.jpg']);
    const scaled = rows.filter((row) => row.metric === 'mu_std5' && ['park-a.jpg', 'urban-c.jpg'].includes(row.unit_key));
    expect(scaled).toHaveLength(2);
    scaled.forEach((row) => expect(Number(row.value)).toBeCloseTo(5));

    const pooledRows = buildQuestionSummaryRows({ ...single, mediaCategoryMode: 'all' }, responses);
    const pooledLeaders = pooledRows.filter((row) => row.metric === 'rank' && Number(row.value) === 1);
    expect(pooledLeaders).toHaveLength(1);
    expect(pooledLeaders[0].attribute_key).toBe('');
    expect(pooledLeaders[0].unit_key).toBe('park-a.jpg');
  });
});
