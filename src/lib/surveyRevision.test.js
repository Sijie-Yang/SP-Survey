import { TextEncoder } from 'util';
global.TextEncoder = TextEncoder;
import { surveyResponseContract, surveyRevision } from './surveyRevision';

test('response contract excludes configuration secrets and tracks question changes', async () => {
  const config = {locale: 'zh', supabaseKey: 'not-for-storage', pages: [{elements: [{name: 'q', type: 'rating', rateMax: 5}]}]};
  expect(JSON.stringify(surveyResponseContract(config))).not.toContain('not-for-storage');
  const first = await surveyRevision(config);
  expect((await surveyRevision({...config})).id).toBe(first.id);
  config.pages[0].elements[0].rateMax = 7;
  expect((await surveyRevision(config)).id).not.toBe(first.id);
});

test('category trial mode is retained in the response contract and changes the revision', async () => {
  const config = { pages: [{ elements: [{ name: 'q', type: 'imagepicker', mediaAssignmentMode: 'category', mediaCategoryMode: 'all' }] }] };
  const original = await surveyRevision(config);
  config.pages[0].elements[0].mediaCategoryMode = 'single';
  expect(JSON.stringify(surveyResponseContract(config))).toContain('single');
  expect((await surveyRevision(config)).id).not.toBe(original.id);
});
