import { Model } from 'survey-core';
import 'survey-core/survey.i18n';
import { restoreDraftSurveyJson } from './surveyDraft';
import { applySurveyLocale, surveyUiStrings } from './surveyLocale';

test('resuming an English draft uses the saved Chinese UI setting while retaining questions and media', () => {
  const draft = {
    finalSurveyJson: {
      locale: 'en',
      pages: [{ name: 'original', elements: [{ type: 'imagepicker', name: 'pick',
        choices: [{ value: 'a', imageLink: '/original.jpg' }] }] }],
    },
    surveyData: { pick: 'a' },
  };
  const restored = restoreDraftSurveyJson(draft, { locale: 'zh', pages: [] });
  expect(restored.pages).toEqual(draft.finalSurveyJson.pages);
  expect(restored.pages).not.toBe(draft.finalSurveyJson.pages);
  expect(draft.finalSurveyJson.locale).toBe('en');
  const model = new Model(restored);
  applySurveyLocale(model, restored);
  model.data = draft.surveyData;
  expect(model.pageNextText).toBe('下一页');
  expect(model.completeText).toBe('提交问卷');
  expect(surveyUiStrings(model).trialNextRound).toBe('下一轮');
  expect(model.getValue('pick')).toBe('a');
});

test('restoring tolerates legacy configs and language changes back to English', () => {
  const draft = { finalSurveyJson: { locale: 'zh', pages: [] } };
  expect(restoreDraftSurveyJson(draft, null).locale).toBe('zh');
  expect(restoreDraftSurveyJson(draft, {}).locale).toBe('zh');
  expect(restoreDraftSurveyJson(draft, { locale: 'en' }).locale).toBe('en');
  expect(restoreDraftSurveyJson(null, { locale: 'zh' })).toBeNull();
});

test('resuming restores custom progress instead of inheriting the disabled native bar', () => {
  const legacy = { finalSurveyJson: { showProgressBar: 'off', pages: [] } };
  expect(restoreDraftSurveyJson(legacy, { showProgressBar: 'top' }).showProgressBar).toBe('top');
  expect(restoreDraftSurveyJson(legacy, { showProgressBar: 'off' }).showProgressBar).toBe('off');
  const modern = { finalSurveyJson: { showProgressBar: 'off', _spProgressEnabled: false, pages: [] } };
  expect(restoreDraftSurveyJson(modern, { showProgressBar: 'top' })._spProgressEnabled).toBe(false);
  modern.finalSurveyJson._spProgressEnabled = true;
  expect(restoreDraftSurveyJson(modern, { showProgressBar: 'off' })._spProgressEnabled).toBe(true);
});
