import { Model } from 'survey-core';
import 'survey-core/survey.i18n';
import {
  applySurveyLocale,
  resolveSurveyJsLocale,
  resolveSurveyUiLanguage,
  resolveUrlSurveyLocale,
} from './surveyLocale';

describe('surveyLocale', () => {
  test('defaults to English', () => {
    expect(resolveSurveyUiLanguage(null)).toBe('en');
    expect(resolveSurveyUiLanguage({})).toBe('en');
    expect(resolveSurveyUiLanguage({ locale: 'en' })).toBe('en');
    expect(resolveSurveyJsLocale({})).toBe('en');
  });

  test('accepts zh and SurveyJS zh-cn', () => {
    expect(resolveSurveyUiLanguage({ locale: 'zh' })).toBe('zh');
    expect(resolveSurveyUiLanguage({ locale: 'zh-cn' })).toBe('zh');
    expect(resolveSurveyUiLanguage({ locale: 'zh-CN' })).toBe('zh');
    expect(resolveSurveyJsLocale({ locale: 'zh' })).toBe('zh-cn');
  });

  test('applySurveyLocale writes SurveyJS locale', () => {
    const model = { locale: 'en' };
    applySurveyLocale(model, { locale: 'zh' });
    expect(model.locale).toBe('zh-cn');
  });

  test('URL locale override wins over a saved English draft', () => {
    expect(resolveUrlSurveyLocale('?locale=zh')).toBe('zh');
    expect(resolveUrlSurveyLocale('?project=demo')).toBe(null);
    const model = new Model({
      locale: 'en',
      elements: [{ type: 'text', name: 'answer', title: 'Title' }],
    });
    const previous = window.location.search;
    window.history.replaceState({}, '', `${window.location.pathname}?locale=zh`);
    applySurveyLocale(model, { locale: 'en' });
    expect(model.pageNextText).toBe('下一页');
    window.history.replaceState({}, '', `${window.location.pathname}${previous}`);
  });

  test('saved Builder Chinese locale translates real SurveyJS navigation', () => {
    const savedConfig = JSON.parse(JSON.stringify({
      locale: 'zh',
      elements: [{ type: 'text', name: 'answer', title: 'Researcher-written title' }],
    }));
    const model = new Model(savedConfig);
    applySurveyLocale(model, savedConfig);
    expect(model.pageNextText).toBe('下一页');
    expect(model.completeText).toBe('提交问卷');
    expect(model.getQuestionByName('answer').title).toBe('Researcher-written title');
    applySurveyLocale(model, { locale: 'en' });
    expect(model.pageNextText).toBe('Next');
    expect(model.completeText).toBe('Complete');
  });
});
