// The "Balanced" sampling mode, end to end: survey → queues → participant number → images.
import {
  balanceGroupsForSurvey, filterPoolForQuestion, getImageKey, normalizePairingMode, pickMediaForQuestion,
  pickTrialMediaSetsForQuestion, trackMediaAssignment, usesBalancedDraw,
} from './surveyMediaInjection';
import { createBalancePlan } from './balancedDraw';
import { makePool } from './__fixtures__/mediaPool';
import { getTrialCount } from './trialNavigation';

const files = (folder, n) => Array.from({ length: n }, (_, i) => ({ name: `${folder}_${String(i).padStart(3, '0')}.jpg`, folder }));
const question = (over = {}) => ({
  type: 'imagepicker', name: 'safe', randomImageSelection: true, imageCount: 2, trialCount: 5,
  pairingMode: 'balanced', mediaFolders: ['streets'], ...over,
});
const survey = (...elements) => ({ pages: [{ elements }] });

/** One participant, the way the live survey assigns media. */
function runParticipant(config, pool, tags, number, { seed = 'proj' } = {}) {
  const groups = balanceGroupsForSurvey(config, pool, tags);
  const plan = number == null ? null : createBalancePlan(groups, { number, seed });
  const usedImages = new Set();
  const usedSets = new Set();
  const shown = {};
  config.pages[0].elements.forEach((element) => {
    const scoped = filterPoolForQuestion(pool, element);
    const trials = getTrialCount(element);
    if (trials > 1) {
      const { trialMediaSets, trialAssignments } = pickTrialMediaSetsForQuestion(scoped, element, trials, usedImages, usedSets, plan, tags);
      shown[element.name] = { trials: trialMediaSets, assignments: trialAssignments };
    } else {
      const assignment = pickMediaForQuestion(scoped, element, usedImages, usedSets, plan, tags);
      trackMediaAssignment(assignment, element, usedImages, usedSets);
      shown[element.name] = { trials: [assignment.images], assignments: [assignment] };
    }
  });
  return shown;
}

const tally = (counts, images) => images.forEach((img) => counts.set(getImageKey(img), (counts.get(getImageKey(img)) || 0) + 1));

describe('balanced sampling mode', () => {
  test("'adaptive' and the older names now mean balanced; everything else is random", () => {
    expect(['balanced', 'adaptive', 'uncertain', 'high_sigma'].map(normalizePairingMode)).toEqual(['balanced', 'balanced', 'balanced', 'balanced']);
    expect([undefined, 'random', 'nonsense'].map(normalizePairingMode)).toEqual(['random', 'random', 'random']);
    expect(usesBalancedDraw(question())).toBe(true);
    expect(usesBalancedDraw(question({ pairingMode: 'random' }))).toBe(false);
    expect(usesBalancedDraw(question({ mediaAssignmentMode: 'category' }))).toBe(false);
  });

  test('pairs from a library: 40 images, 5 pairs per person, 20 people → every image shown exactly 5 times', () => {
    const pool = makePool([...files('streets', 40), ...files('parks', 12)]);
    const config = survey(question());
    const counts = new Map();
    for (let k = 0; k < 20; k += 1) {
      const { safe } = runParticipant(config, pool, {}, k);
      expect(safe.trials).toHaveLength(5);
      const mine = safe.trials.flat();
      expect(mine).toHaveLength(10);
      expect(new Set(mine.map(getImageKey)).size).toBe(10);
      expect(mine.every((img) => img.folder === 'streets')).toBe(true);
      tally(counts, mine);
    }
    expect(counts.size).toBe(40);
    expect(new Set(counts.values())).toEqual(new Set([5]));
  });

  test('plain random draws of the same survey are visibly uneven (what Balanced used to do)', () => {
    const pool = makePool(files('streets', 40));
    const config = survey(question());
    const counts = new Map(pool.map((img) => [getImageKey(img), 0]));
    for (let k = 0; k < 20; k += 1) tally(counts, runParticipant(config, pool, {}, null).safe.trials.flat());
    const values = [...counts.values()];
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(1);
  });

  test('many questions: each one is balanced on its own library', () => {
    const pool = makePool([...files('streets', 30), ...files('parks', 12)]);
    const config = survey(
      question({ name: 'safe', mediaFolders: ['streets'], imageCount: 2, trialCount: 3 }),
      question({ name: 'green', type: 'imagerating', mediaFolders: ['parks'], imageCount: 1, trialCount: 4 }),
      question({ name: 'free', type: 'imagerating', mediaFolders: ['parks'], imageCount: 1, trialCount: 2, pairingMode: 'random', excludePreviouslyUsedImages: false }),
    );
    expect(balanceGroupsForSurvey(config, pool, {}).map((g) => [g.questions, g.keys.length, g.perPerson])).toEqual([[['safe'], 30, 6], [['green'], 12, 4]]);
    const streets = new Map();
    const parks = new Map();
    for (let k = 0; k < 15; k += 1) {
      const shown = runParticipant(config, pool, {}, k);
      tally(streets, shown.safe.trials.flat());
      tally(parks, shown.green.trials.flat());
    }
    expect(new Set(streets.values())).toEqual(new Set([3])); // 15 people × 6 images / 30
    expect(new Set(parks.values())).toEqual(new Set([5])); // 15 people × 4 images / 12
  });

  test('two balanced questions on the same library: nobody sees an image twice and the library stays balanced', () => {
    const pool = makePool(files('streets', 24));
    const config = survey(
      question({ name: 'safe', trialCount: 3 }),
      question({ name: 'beautiful', trialCount: 3 }),
    );
    expect(balanceGroupsForSurvey(config, pool, {})).toHaveLength(1);
    const counts = new Map();
    for (let k = 0; k < 10; k += 1) {
      const shown = runParticipant(config, pool, {}, k);
      const mine = [...shown.safe.trials.flat(), ...shown.beautiful.trials.flat()];
      expect(new Set(mine.map(getImageKey)).size).toBe(12);
      tally(counts, mine);
    }
    expect(new Set(counts.values())).toEqual(new Set([5])); // 10 people × 12 images / 24
  });

  test('fixed sets (one folder = one pair): every pair is shown equally often', () => {
    const entries = [];
    const tags = {};
    for (let i = 0; i < 9; i += 1) {
      const folder = `pairs/p${i}`;
      tags[folder] = 'set';
      entries.push({ name: 'before.jpg', folder }, { name: 'after.jpg', folder });
    }
    const pool = makePool(entries);
    const config = survey(question({ name: 'better', mediaAssignmentMode: 'set', mediaFolders: undefined, imageCount: 2, trialCount: 3 }));
    const counts = new Map();
    for (let k = 0; k < 12; k += 1) {
      const { better } = runParticipant(config, pool, tags, k);
      const sets = better.assignments.map((a) => a.setId);
      expect(new Set(sets).size).toBe(3);
      better.trials.forEach((images) => expect(images).toHaveLength(2));
      sets.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    }
    expect(counts.size).toBe(9);
    expect(new Set(counts.values())).toEqual(new Set([4])); // 12 people × 3 pairs / 9
  });

  test('the same participant number gets the same images again (a reload does not reshuffle)', () => {
    const pool = makePool(files('streets', 40));
    const config = survey(question());
    const names = (shown) => shown.safe.trials.map((t) => t.map((img) => img.name));
    expect(names(runParticipant(config, pool, {}, 7))).toEqual(names(runParticipant(config, pool, {}, 7)));
    expect(names(runParticipant(config, pool, {}, 7))).not.toEqual(names(runParticipant(config, pool, {}, 8)));
  });

  test('an image the person already saw in another question is swapped for an unseen one', () => {
    const pool = makePool(files('streets', 12));
    const first = question({ name: 'warmup', pairingMode: 'random', imageCount: 4, trialCount: 1 });
    const config = survey(first, question({ name: 'safe', trialCount: 3 }));
    for (let k = 0; k < 6; k += 1) {
      const shown = runParticipant(config, pool, {}, k);
      const mine = [...shown.warmup.trials.flat(), ...shown.safe.trials.flat()].map(getImageKey);
      expect(new Set(mine).size).toBe(10);
    }
  });

  test('questions that cannot be balanced are left out: one image in the library, manual choice, media slots', () => {
    const pool = makePool(files('streets', 1));
    expect(balanceGroupsForSurvey(survey(question()), pool, {})).toEqual([]);
    const many = makePool(files('streets', 10));
    expect(balanceGroupsForSurvey(survey(question({ imageSelectionMode: 'manual', selectedImageUrls: ['x'] })), many, {})).toEqual([]);
    expect(balanceGroupsForSurvey(survey(question({ randomImageSelection: false })), many, {})).toEqual([]);
    expect(balanceGroupsForSurvey(null, many, {})).toEqual([]);
  });

  test('needing more images than the library has falls back to random for the extra draws', () => {
    const pool = makePool(files('streets', 6));
    const config = survey(question({ trialCount: 5, excludePreviouslyUsedImages: false }));
    const { safe } = runParticipant(config, pool, {}, 0);
    expect(safe.trials).toHaveLength(5);
    safe.trials.forEach((images) => expect(images).toHaveLength(2));
  });
});
