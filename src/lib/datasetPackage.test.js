import { syntheticResponses, syntheticSurveyConfig } from './__fixtures__/syntheticResults';
import { flattenQuestions } from './quality';
import {
  buildCitationCff, buildDatasetPackageFiles, collectStimuli, createAnonymizer, fetchStimulusFiles,
  formatAuthorLines, freeTextQuestionNames, parseAuthorLines, readDatasetMeta, reuseConsentQuestions, answeredYes,
} from './datasetPackage';

const config = syntheticSurveyConfig({ images: 12 });
const questions = flattenQuestions(config);
const responses = syntheticResponses(8, { config }).map((r, i) => ({
  ...r,
  id: `uuid-${i}`,
  created_at: `2026-10-0${1 + (i % 3)}T08:15:00.000Z`,
  survey_metadata: { ...r.survey_metadata, completion_code: `C${i}`, user_agent: 'UA', url_params: { PROLIFIC_PID: `pp${i}` } },
  responses: { ...r.responses, comment: `I live at ${i} Main Street` },
}));
const meta = {
  ...readDatasetMeta({ name: 'Street perception' }),
  authors: parseAuthorLines('Sijie Yang; 0000-0002-1825-0097; National University of Singapore\nFilip Biljecki'),
  description: 'Pairwise and rating judgements of 12 street images.',
  keywords: ['urban perception', 'street view'],
};

test('author lines round-trip and ORCIDs are normalised', () => {
  const authors = parseAuthorLines('A B; https://orcid.org/0000-0001-2345-678x\nC D;; Lab');
  expect(authors).toEqual([
    { name: 'A B', orcid: '0000-0001-2345-678X', affiliation: '' },
    { name: 'C D', orcid: '', affiliation: 'Lab' },
  ]);
  expect(formatAuthorLines(authors)).toBe('A B; 0000-0001-2345-678X\nC D; ; Lab');
});

test('free-text questions are the typed ones only', () => {
  expect(freeTextQuestionNames([
    { name: 'c', type: 'comment' }, { name: 'e', type: 'text', inputType: 'email' },
    { name: 'n', type: 'text', inputType: 'number' }, { name: 'r', type: 'rating' },
  ])).toEqual(['c', 'e']);
});

test('anonymisation is consistent and removes identifying fields', () => {
  const anon = createAnonymizer({ pseudonymizeIds: true, dateOnly: true, dropFreeText: true }, questions);
  const a = anon(responses[0]);
  const again = anon({ ...responses[0] });
  expect(a.participant_id).toBe('P0001');
  expect(again.participant_id).toBe('P0001');
  expect(a.id).toBe('R0001');
  expect(a.created_at).toBe('2026-10-01');
  expect(a.responses.comment).toBeUndefined();
  expect(a.responses.safe).toEqual(responses[0].responses.safe);
  expect(a.survey_metadata.completion_code).toBeUndefined();
  expect(a.survey_metadata.url_params).toBeUndefined();
  expect(a.survey_metadata.user_agent).toBeUndefined();
  expect(responses[0].responses.comment).toMatch(/Main Street/);
});

test('the package holds data, survey, manifest and citation files, with nothing identifying left', () => {
  const files = buildDatasetPackageFiles({
    meta, project: { id: 'p1', name: 'Street perception' }, surveyConfig: config, questions,
    filteredResponses: responses, dateFilteredResponses: responses, filters: {}, excludeFlagged: false,
    releaseDate: '2026-10-22',
  });
  const paths = files.map((f) => f.path);
  ['README.md', 'LICENSE', 'CITATION.cff', 'datapackage.json', 'survey/survey.json', 'stimuli/manifest.csv',
    'data/responses_wide.csv', 'data/responses_raw.json', 'data/data_dictionary.json', 'data/methods.txt']
    .forEach((p) => expect(paths).toContain(p));
  expect(paths.some((p) => p.startsWith('data/questions/safe__'))).toBe(true);
  expect(paths.some((p) => p.startsWith('data/questions/comment__'))).toBe(false);

  const all = files.map((f) => (typeof f.content === 'string' ? f.content : '')).join('\n');
  expect(all).not.toMatch(/Main Street/);
  expect(all).not.toMatch(/PROLIFIC_PID|pp3/);
  expect(all).not.toMatch(/uuid-\d/);
  expect(all).not.toMatch(/T08:15/);

  const readme = files.find((f) => f.path === 'README.md').content;
  expect(readme).toMatch(/Submissions: 8/);
  expect(readme).toMatch(/Yang & Biljecki \(2026\)/);
  expect(readme).toMatch(/Typed free-text answers were removed: comment/);

  const cff = files.find((f) => f.path === 'CITATION.cff').content;
  expect(cff).toMatch(/type: dataset/);
  expect(cff).toMatch(/family-names: "Yang"\n {4}given-names: "Sijie"\n {4}orcid: "https:\/\/orcid.org\/0000-0002-1825-0097"/);
  expect(cff).toMatch(/license: CC-BY-4.0/);

  const pkg = JSON.parse(files.find((f) => f.path === 'datapackage.json').content);
  expect(pkg.licenses[0].name).toBe('CC-BY-4.0');
  const wide = pkg.resources.find((r) => r.path === 'data/responses_wide.csv');
  expect(wide.schema.fields.length).toBeGreaterThan(3);
  expect(pkg.resources.every((r) => paths.includes(r.path))).toBe(true);

  const manifest = files.find((f) => f.path === 'stimuli/manifest.csv').content;
  expect(manifest).toMatch(/img_000\d\.jpg/);
});

test('stimuli are collected once each with counts, and fetched files carry a hash', async () => {
  const stimuli = collectStimuli(questions, responses, config);
  expect(stimuli.length).toBeGreaterThan(0);
  expect(stimuli.length).toBeLessThanOrEqual(12);
  expect(stimuli[0].times_shown).toBeGreaterThan(0);
  const fetchImpl = jest.fn(async (url) => (url.includes('img_0001') ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
  const { files, rows } = await fetchStimulusFiles(stimuli, { fetchImpl });
  const failed = rows.filter((r) => !r.included);
  expect(files.length + failed.length).toBe(stimuli.length);
  failed.forEach((r) => expect(r.note).toMatch(/404/));
  expect(files.every((f) => f.path.startsWith('stimuli/files/'))).toBe(true);
});

test('citation without authors still parses as CFF', () => {
  expect(buildCitationCff({ title: 'T', license: 'CC0-1.0', authors: [] }, { releaseDate: '2026-01-01' })).toMatch(/family-names: "Anonymous"/);
});

test('a yes/no reuse question can limit the package to those who agreed', () => {
  const share = { name: 'share', type: 'boolean', title: 'May your anonymised answers be reused?' };
  const qs = [...questions, share, { name: 'gate', type: 'boolean', isRequired: true }];
  expect(reuseConsentQuestions(qs).map((q) => q.name)).toContain('share');
  expect(reuseConsentQuestions(qs).map((q) => q.name)).not.toContain('gate');
  const rows = responses.map((r, i) => ({ ...r, responses: { ...r.responses, share: i % 2 === 0 } }));
  expect(answeredYes(rows[0], 'share')).toBe(true);
  const files = buildDatasetPackageFiles({
    meta: { ...meta, onlyAgreedTo: 'share' }, project: { id: 'p1' }, surveyConfig: config, questions: qs,
    filteredResponses: rows, dateFilteredResponses: rows, filters: {}, excludeFlagged: false, releaseDate: '2026-10-22',
  });
  expect(JSON.parse(files.find((f) => f.path === 'data/responses_raw.json').content)).toHaveLength(4);
  expect(files.find((f) => f.path === 'README.md').content).toMatch(/answered yes to "May your anonymised answers be reused\?" are included \(4 of 8\)/);
});

test('the package carries journal figures with captions', () => {
  const files = buildDatasetPackageFiles({
    meta, project: { id: 'p1', name: 'Street perception' }, surveyConfig: config, questions,
    filteredResponses: responses, dateFilteredResponses: responses, filters: {}, excludeFlagged: false, releaseDate: '2026-10-22',
  });
  const paths = files.map((f) => f.path);
  expect(paths).toContain('data/figures/safe__trueskill.svg');
  expect(paths).toContain('data/figures/captions.md');
  expect(paths.some((p) => p.startsWith('data/figures/comment'))).toBe(false);
  expect(files.find((f) => f.path === 'data/README.txt').content).toMatch(/figures\/\{name\}__\*\.svg/);
});

test('pseudonymised packages drop the recruitment platform id', () => {
  const anon = createAnonymizer({ pseudonymizeIds: true });
  const out = anon({ participant_id: 'p1', responses: {}, survey_metadata: { recruitment: { platform: 'prolific', id: '5f1a' }, condition: 'a' } });
  expect(out.survey_metadata.recruitment).toBeUndefined();
  expect(out.survey_metadata.condition).toBe('a');
});
