import fs from 'fs';
import registerImageRankingWidget, { registerImageRatingWidget, registerImageBooleanWidget, registerImageMatrixWidget, registerAllExtendedWidgets } from '../SurveyCustomComponents';
beforeAll(() => { registerImageRankingWidget(); registerImageRatingWidget(); registerImageBooleanWidget(); registerImageMatrixWidget(); registerAllExtendedWidgets(); });
import { createSurveyPreviewModel } from './SurveyPreview';
const ids = ['2014-naik-streetscore','2016-dubey-place','2017-seresinhe-scenic','2024-liang-building','2025-yang-thermal','2025-gu-effective','2025-li-street','2025-quintana-specs','2026-quintana-greenery','2026-peng-city','2026-lopes-street-gsv','2027-wang-hotel-hue','2013-salesses-collaborative','2014-quercia-aesthetic','2017-liu-machine','2019-yao-human','2021-ramirez-measuring','2021-ito-assessing','2021-kruse-places','2022-qiu-subjective','2023-kang-assessing','2023-torkko-how','2025-danish-citizen','2026-kang-decoding','2009-ewing-measuring','1990-nasar-evaluative'];
test.each(ids)('%s', (id) => {
  const cfg = JSON.parse(fs.readFileSync(`public/project_templates/${id}.json`)).config;
  const m = createSurveyPreviewModel(cfg);
  const names = cfg.pages.flatMap((p) => p.elements.map((e) => e.name));
  expect(names.filter((n) => !m.getQuestionByName(n))).toEqual([]);
  cfg.pages.flatMap((p) => p.elements).forEach((e) => {
    const q = m.getQuestionByName(e.name);
    ['rateLabels', 'requireMediaEnded', 'annotationNotePrompt', 'trialCount', 'allowTie', 'tieLabel', 'dimensions', 'mediaFolders', 'conditionVariants'].forEach((k) => {
      if (e[k] !== undefined && !(k === 'rateLabels' && e.type === 'rating')) expect([k, q[k] ?? q.getPropertyValue?.(k)]).toEqual([k, e[k]]);
    });
  });
});
test('rating labels', () => {
  const cfg = JSON.parse(fs.readFileSync('public/project_templates/2017-liu-machine.json')).config;
  const q = createSurveyPreviewModel(cfg).getQuestionByName('site_facade_quality');
  expect(q.visibleRateValues.map((v) => v.text)).toEqual(cfg.pages[2].elements[0].rateLabels);
});
test('condition and url visibility', () => {
  const k = JSON.parse(fs.readFileSync('public/project_templates/2023-kang-assessing.json')).config;
  expect(createSurveyPreviewModel(k, { condition: 'less_safe', urlParams: {} }).getQuestionByName('safety').title).toBe('Which place looks less safe?');
  expect(createSurveyPreviewModel(k, { condition: 'safe', urlParams: {} }).getQuestionByName('safety').title).toBe('Which place looks safe?');
  expect(createSurveyPreviewModel(k, null).getQuestionByName('safety').title).toBe('Which place looks safe?');
  const t = JSON.parse(fs.readFileSync('public/project_templates/2023-torkko-how.json')).config;
  const a = createSurveyPreviewModel(t, { condition: null, urlParams: { site: 'S01' } });
  expect(a.getPageByName('page_in_situ').isVisible).toBe(true);
  expect(a.getPageByName('page_online').isVisible).toBe(false);
  const b = createSurveyPreviewModel(t, null);
  expect(b.getPageByName('page_in_situ').isVisible).toBe(false);
  expect(b.getPageByName('page_online').isVisible).toBe(true);
});
