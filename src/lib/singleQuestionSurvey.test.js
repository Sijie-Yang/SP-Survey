import { buildSingleQuestionSurvey } from './singleQuestionSurvey';
import { makePool } from './__fixtures__/mediaPool';
import { MEDIA_SLOT_PRESETS } from './mediaSlots';
const question = { type: 'imagepicker', name: 'q', imageCount: 2, randomImageSelection: true };
const pool = makePool(['a', 'b'].flatMap(folder => [1, 2, 3, 4].map(i => ({ name: `${i}.jpg`, folder }))));
function build(overrides = {}, extra = {}) {
  return buildSingleQuestionSurvey({ question: { ...question, ...overrides }, projectImages: pool, randomMedia: true, ...extra });
}

test('random trials obey folder scope and avoid repeats within this run', () => {
  const preview = build({ trialCount: 2, mediaFolders: ['b'] });
  expect(preview.trialMediaSets.map(items => items.length)).toEqual([2, 2]);
  expect(preview.trialMediaSets.flat().every(item => item.folder === 'b')).toBe(true);
  expect(new Set(preview.shownImagesByTrial.flat()).size).toBe(4);
});
test('each new preview gets fresh usage tracking; fixed selections stay fixed across rounds', () => {
  const fixed = [pool[1].url, pool[0].url];
  expect(build({ trialCount: 2, imageSelectionMode: 'manual', selectedImageUrls: fixed }).shownImagesByTrial).toEqual([fixed, fixed]);
  expect(build({ trialCount: 2, mediaFolders: ['a'] }).shownImagesByTrial.flat()).toHaveLength(4);
  expect(build({ trialCount: 2, mediaFolders: ['a'] }).shownImagesByTrial.flat()).toHaveLength(4);
});
test('manual choices are not silently replaced with random files when selectedImageUrls is empty', () => {
  const choices = [{ value: 'fixed', imageLink: '/fixed.jpg' }];
  expect(build({ imageSelectionMode: 'manual', choices }).element.choices).toEqual(choices);
});
test('set mode chooses intact distinct tagged folders in successive trials', () => {
  const setPool = pool.filter(item => /[12]\.jpg$/.test(item.url));
  const result = build({ mediaAssignmentMode: 'set', trialCount: 2 }, { projectImages: setPool, folderTags: { a: 'set', b: 'set' } });
  expect(result.trialMediaSets.map(items => new Set(items.map(item => item.folder)).size)).toEqual([1, 1]);
  expect(new Set(result.element.trialMediaContexts.map(ctx => ctx.shown_media_set)).size).toBe(2);
});
test('category mode draws one per category and carries context into each round', () => {
  const result = build({ mediaAssignmentMode: 'category', mediaPerCategory: 1, trialCount: 2 }, { folderTags: { a: 'category', b: 'category' } });
  result.trialMediaSets.forEach(items => expect(items.map(item => item.folder).sort()).toEqual(['a', 'b']));
  expect(new Set(result.shownImagesByTrial.flat()).size).toBe(4);
  result.element.trialMediaContexts.forEach(ctx => expect(ctx.shown_media_categories).toHaveLength(2));
});

test('single category selection runs per trial in participant preview with accurate category context', () => {
  const result = build({ mediaAssignmentMode: 'category', mediaCategoryMode: 'single', mediaPerCategory: 2, trialCount: 2 }, { folderTags: { a: 'category', b: 'category' } });
  expect(result.trialMediaSets).toHaveLength(2);
  result.trialMediaSets.forEach((items, index) => {
    expect(items).toHaveLength(2);
    const folder = items[0].folder;
    expect(items.every((item) => item.folder === folder)).toBe(true);
    expect(result.element.trialMediaContexts[index].shown_media_categories).toEqual([folder]);
  });
  expect(new Set(result.shownImagesByTrial.flat()).size).toBe(4);
});
test('single and multi-trial slot assignment preserve a fixed video and rotate random audio', () => {
  const slotPool = makePool([{ name: 'fixed.mp4', type: 'video' }, { name: 'one.mp3', type: 'audio' }, { name: 'two.mp3', type: 'audio' }]);
  const mediaSlots = MEDIA_SLOT_PRESETS.fixedVideoRandomAudio.map(slot => slot.id === 'stimulus_video' ? { ...slot, mediaRef: { key: slotPool[0].key } } : slot);
  const single = build({ type: 'mediapicker', mediaSlots }, { projectImages: slotPool });
  expect(single.shownImages).toContain(slotPool[0].url);
  expect(single.element.mediaSlotsResolved).toHaveLength(2);
  const multi = build({ type: 'mediapicker', mediaSlots, trialCount: 2 }, { projectImages: slotPool });
  multi.shownImagesByTrial.forEach(items => expect(items).toContain(slotPool[0].url));
  expect(new Set(multi.shownImagesByTrial.flat()).size).toBe(3);
});
