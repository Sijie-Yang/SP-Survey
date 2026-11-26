import { syntheticResponses, syntheticSurveyConfig } from './__fixtures__/syntheticResults';
import { flattenQuestions } from './quality';
import { figureCaptionsMarkdown, figuresForQuestion, figuresForSurvey, horizontalBarSvg } from './journalFigures';

const config = syntheticSurveyConfig({ images: 8 });
const questions = flattenQuestions(config);
const responses = syntheticResponses(40, { config });
const q = (name) => questions.find((x) => x.name === name);

function parse(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc.documentElement;
}

test('pairwise choice gives a ranked TrueSkill figure with error bars', () => {
  const [fig] = figuresForQuestion(q('safe'), responses, { questionNumber: 2 });
  expect(fig.file).toBe('safe__trueskill');
  expect(fig.caption).toMatch(/^Q2\. Which place looks safer\?/);
  expect(fig.caption).toMatch(/n = 40 responses\. Data collected with SP-Survey/);
  const root = parse(fig.svg);
  expect(root.getAttribute('font-family')).toMatch(/Arial/);
  expect(root.getElementsByTagName('rect')[0].getAttribute('fill')).toBe('#ffffff');
  expect(fig.svg).toMatch(/TrueSkill score/);
  expect((fig.svg.match(/img_\d{4}\.jpg/g) || []).length).toBe(8);
});

test('image ratings give mean ± 95% CI per image, sliders one figure per dimension', () => {
  const [rating] = figuresForQuestion(q('comfort'), responses);
  expect(rating.file).toBe('comfort__means');
  parse(rating.svg);
  const sliders = figuresForQuestion(q('feel'), responses);
  expect(sliders.map((f) => f.file)).toEqual(['feel__means_calm', 'feel__means_open']);
  expect(sliders[0].svg).toMatch(/Mean rating: Calm/);
});

test('choices, scales and matrices give distributions', () => {
  expect(figuresForQuestion(q('gender'), responses)[0].svg).toMatch(/Share of answers/);
  const scale = figuresForQuestion(q('personality_1'), responses)[0];
  const labels = [...scale.svg.matchAll(/text-anchor="end">(\d)<\/text>/g)].map((m) => m[1]);
  expect(labels).toEqual(['1', '2', '3', '4', '5']);
  const matrix = figuresForQuestion(q('usage'), responses)[0];
  expect(matrix.file).toBe('usage__matrix');
  parse(matrix.svg);
});

test('free text has no figure; the survey list is numbered and captioned', () => {
  expect(figuresForQuestion(q('comment'), responses)).toEqual([]);
  const all = figuresForSurvey(questions, responses);
  expect(all.length).toBeGreaterThan(8);
  expect(new Set(all.map((f) => f.file)).size).toBe(all.length);
  expect(figureCaptionsMarkdown(all, { projectName: 'P' })).toMatch(/\*\*safe__trueskill\*\*: Q2\./);
});

test('labels are escaped and long lists are trimmed with a note', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ label: `<a&b> ${i}`, value: i }));
  const svg = horizontalBarSvg({ items, note: 'x' });
  parse(svg);
  expect(svg).toMatch(/&lt;a&amp;b&gt;/);
});
