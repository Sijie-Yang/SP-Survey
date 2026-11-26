import fs from 'fs';
import path from 'path';
import { validateSurveyConfig } from './designProtocol/validate';
import { normalizeRecommendation } from './analysisRecommendation';
import { evaluateResponseQuality } from './quality';

const DIR = path.join(__dirname, '..', '..', 'public', 'project_templates');
const PAPER_TEMPLATES = [
  '2014-naik-streetscore', '2016-dubey-place', '2017-seresinhe-scenic', '2024-liang-building', '2025-yang-thermal',
  '2025-gu-effective', '2025-li-street', '2025-quintana-specs', '2026-quintana-greenery', '2026-peng-city',
  '2026-lopes-street-gsv', '2027-wang-hotel-hue',
  '1990-nasar-evaluative', '2009-ewing-measuring', '2013-salesses-collaborative', '2014-quercia-aesthetic',
  '2017-liu-machine', '2019-yao-human', '2021-ramirez-measuring', '2021-ito-assessing', '2021-kruse-places',
  '2022-qiu-subjective', '2023-kang-assessing', '2023-torkko-how', '2025-danish-citizen', '2026-kang-decoding',
];
const load = (id) => JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
const flat = (cfg) => cfg.pages.flatMap((p) => p.elements || []);
const existing = PAPER_TEMPLATES.filter((id) => fs.existsSync(path.join(DIR, `${id}.json`)));

describe.each(existing)('%s', (id) => {
  const tpl = load(id);
  test('validates, recommendation names real questions, names unique', () => {
    const result = validateSurveyConfig(tpl.config);
    expect(result.errors || []).toEqual([]);
    const names = flat(tpl.config).map((q) => q.name);
    expect(new Set(names).size).toBe(names.length);
    const { items } = normalizeRecommendation(tpl.config);
    expect(items.length).toBeGreaterThan(0);
    items.forEach((it) => it.questions.forEach((q) => expect(names).toContain(q)));
    expect(tpl.id).toBe(id);
  });
});

test('every paper template is listed in index.json', () => {
  const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  const ids = index.templates.map((t) => String(t).replace(/\.json$/, ''));
  existing.forEach((id) => expect(ids).toContain(id));
});

test('same-position quality flag is opt-in', () => {
  const cfg = load('2026-peng-city').config;
  const row = { participant_id: 'p', responses: Object.fromEntries(['prefer', 'monotonous', 'quiet', 'extensive', 'vivid', 'oppressive']
    .map((n, i) => [n, { answer: `L${i}`, shown_images: [`L${i}`, `R${i}`] }])) };
  expect(evaluateResponseQuality(row, cfg)).toContain('same_position');
  const { qualityChecks, ...plain } = cfg;
  expect(evaluateResponseQuality(row, plain)).not.toContain('same_position');
});
