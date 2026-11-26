import { Model } from 'survey-core';
import 'survey-core/survey.i18n';
import {
  applySurveyLocale,
  completionMessageForLocale,
  resolveSurveyJsLocale,
  resolveSurveyUiLanguage,
  resolveUrlSurveyLocale,
  surveyUiStrings,
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

  test('traditional Chinese, Japanese, and Finnish use their SurveyJS chrome', () => {
    expect(resolveSurveyUiLanguage({ locale: 'zh-TW' })).toBe('zh-TW');
    expect(resolveSurveyUiLanguage({ locale: 'zh-tw' })).toBe('zh-TW');
    expect(resolveSurveyJsLocale({ locale: 'zh-TW' })).toBe('zh-tw');
    expect(resolveSurveyJsLocale({ locale: 'ja' })).toBe('ja');
    expect(resolveSurveyJsLocale({ locale: 'fi' })).toBe('fi');

    const traditional = new Model({ locale: 'zh-TW', elements: [{ type: 'text', name: 'answer', title: 'Researcher-written title' }] });
    applySurveyLocale(traditional, { locale: 'zh-TW' });
    expect(traditional.pageNextText).toBe('下一頁');
    expect(traditional.completeText).toBe('提交問卷');
    expect(traditional.getQuestionByName('answer').title).toBe('Researcher-written title');

    const japanese = new Model({ locale: 'ja' });
    applySurveyLocale(japanese, { locale: 'ja' });
    expect(japanese.pageNextText).toBe('次へ');
    expect(japanese.completeText).toBe('完了');

    const finnish = new Model({ locale: 'fi' });
    applySurveyLocale(finnish, { locale: 'fi' });
    expect(finnish.pageNextText).toBe('Seuraava');
    expect(finnish.completeText).toBe('Valmis');
    expect(surveyUiStrings({ locale: 'ja' }).trialNextRound).toBe('次の回');
    expect(surveyUiStrings({ locale: 'fi' }).landHeroTitle).toBe('Katunäkymien havaintokysely');
    expect(surveyUiStrings({ locale: 'zh-TW' }).trialNextRound).toBe('下一輪');
    expect(surveyUiStrings({ locale: 'zh' }).trialNextRound).toBe('下一轮');
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

  test('completionMessage follows the participant locale', () => {
    expect(completionMessageForLocale('Thank you for taking part.', { locale: 'zh' })).toBe('');
    expect(completionMessageForLocale('谢谢参与', { locale: 'zh' })).toBe('谢谢参与');
    expect(completionMessageForLocale('Thank you for taking part.', { locale: 'en' })).toBe('Thank you for taking part.');
    expect(completionMessageForLocale('谢谢参与', { locale: 'en' })).toBe('');
  });
});
