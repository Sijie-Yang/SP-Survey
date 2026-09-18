import { runSurveyPreflight } from './surveyPreflight';
import { getRememberedInjectedMedia, rememberInjectedMedia } from './surveyMediaInjection';
const media = (i, folder = '') => ({ name: `${i}.jpg`, key: `u/p/${i}.jpg`, media_id: `u/p/${i}.jpg`, url: `https://media.test/${i}.jpg`, folder });
const q = { name: 'choice', type: 'imagepicker', randomImageSelection: true, imageCount: 2, trialCount: 2 };
const config = (...questions) => ({ pages: [{ name: 'p', elements: questions }] });
test('uses actual assignment/export paths, reports forced reuse and never alters project or preview media', async () => {
  const project = { preloadedImages: [media(1), media(2)] };
  const initial = JSON.stringify(project);
  rememberInjectedMedia('choice', { items: [media(9)] });
  const report = await runSurveyPreflight(config(q), project, { participants: 2 });
  expect(report.questions[0]).toMatchObject({ missing: 0, reused: 4, exportRows: 4 });
  expect(report.responses.every((r) => r.survey_metadata.simulation)).toBe(true);
  expect(JSON.stringify(project)).toBe(initial);
  expect(getRememberedInjectedMedia('choice').items[0].url).toContain('/9.jpg');
});
test('set exhaustion and category shortages appear as failures', async () => {
  const project = { preloadedImages: [media(1, 'set'), media(2, 'set')], imageDatasetConfig: { mediaFolderTags: { set: 'set' } } };
  const report = await runSurveyPreflight(config({ ...q, mediaAssignmentMode: 'set' }), project, { participants: 1 });
  expect(report.questions[0].missing).toBe(1);
  const categories = await runSurveyPreflight(config({ ...q, mediaAssignmentMode: 'category', mediaPerCategory: 2, trialCount: 1 }), { preloadedImages: [media(1, 'park')], imageDatasetConfig: { mediaFolderTags: { park: 'category' } } }, { participants: 1 });
  expect(categories.questions[0].missing).toBe(1);
});
test('native numeric, matrix and allocation examples enter export tables', async () => {
  const report = await runSurveyPreflight(config({ name: 'n', type: 'number', min: 0 }, { name: 'm', type: 'matrix', rows: ['r'], columns: ['c'] }, { name: 'a', type: 'pointallocation', choices: ['x', 'y'], budget: 10 }), {}, { participants: 1 });
  expect(report.questions.every((d) => d.exportRows > 0)).toBe(true);
  expect(report.questions[0].example).toBe(0);
  expect(report.questions[2].example).toEqual({ x: 10, y: 0 });
});
test('curated selections and negative-only numeric settings produce the configured examples', async () => {
  const report = await runSurveyPreflight(config({ ...q, imageSelectionMode: 'manual', randomImageSelection: false, selectedImageUrls: [media(1).url, media(2).url] }, { name: 'n', type: 'number', max: -3 }), { preloadedImages: [media(1), media(2)] }, { participants: 1 });
  expect(report.questions[0]).toMatchObject({ missing: 0, exportRows: 2 });
  expect(report.responses[0].responses.choice.trials[0].shown_images).toEqual([media(1).url, media(2).url]);
  expect(report.questions[1].example).toBe(-3);
});
test('conditional/custom tasks explicitly require manual verification; large runs are capped', async () => {
  const report = await runSurveyPreflight(config({ name: 'custom', type: 'skillquestion', visibleIf: '{n} > 0' }), {}, { participants: 1 });
  expect(report.questions[0].warnings.join(' ')).toContain('Conditional logic');
  expect(report.questions[0].warnings.join(' ')).toContain('manually');
  await expect(runSurveyPreflight(config({ ...q, trialCount: 1000 }, { ...q, name: 'q2', trialCount: 200 }), {}, { participants: 50 })).rejects.toThrow('10,000');
});
