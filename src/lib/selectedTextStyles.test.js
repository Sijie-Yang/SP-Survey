import { Model } from 'survey-core';
import { applySurveyLocale } from './surveyLocale';
import { bindSelectedTextStyles, setSelectedTextStyle, textStyleKey } from './selectedTextStyles';

const target = { kind: 'question', name: 'q', field: 'title', text: 'First question', start: 0, end: 5 };

test('overlapping text edits preserve unaffected ranges and stay device-specific', () => {
  let config = setSelectedTextStyle({}, 'mobile', target, { fontFamily: 'serif' });
  config = setSelectedTextStyle(config, 'mobile', { ...target, start: 3, end: 8 }, { fontSize: 24 });
  const entry = config.viewportLayout.mobile.textStyles[textStyleKey(target)];
  expect(entry.runs).toEqual([
    { start: 0, end: 3, style: { fontFamily: 'serif' } },
    { start: 3, end: 5, style: { fontFamily: 'serif', fontSize: 24 } },
    { start: 5, end: 8, style: { fontSize: 24 } },
  ]);
  expect(config.viewportLayout.desktop).toBeUndefined();
  config = setSelectedTextStyle(config, 'mobile', { ...target, start: 3, end: 8 }, null);
  expect(config.viewportLayout.mobile.textStyles[textStyleKey(target)].runs).toEqual([{ start: 0, end: 3, style: { fontFamily: 'serif' } }]);
});

test('model rendering preserves Markdown and escapes title markup, including after a text change', () => {
  const model = new Model({ pages: [{ name: 'p', elements: [{ type: 'text', name: 'q', title: 'First question', description: '**Important** note' }] }] });
  applySurveyLocale(model, {});
  let config = setSelectedTextStyle({}, 'mobile', target, { fontSize: 24 });
  const unbind = bindSelectedTextStyles(model, () => config.viewportLayout.mobile.textStyles);
  const question = model.getQuestionByName('q');
  expect(question.locTitle.renderedHtml).toContain('font-size: 24px');
  expect(question.locTitle.renderedHtml).toContain('First</span>');
  question.title = 'Another question';
  expect(question.locTitle.renderedHtml).not.toContain('data-sp-text-run');
  config = setSelectedTextStyle(config, 'mobile', { ...target, text: 'Another question', end: 16, whole: true }, { fontFamily: 'serif' });
  model.locStrsChanged();
  question.title = '<img src=x onerror=alert(1)>';
  expect(question.locTitle.renderedHtml).toContain('&lt;img');
  expect(question.locTitle.renderedHtml).toContain('Georgia');
  const description = { ...target, field: 'description', text: 'Important note', end: 9 };
  config = setSelectedTextStyle(config, 'mobile', description, { fontSize: 25 });
  model.locStrsChanged();
  expect(question.locDescription.renderedHtml).toContain('<strong><span');
  expect(question.locDescription.renderedHtml).toContain('font-size: 25px');
  unbind(); model.dispose();
});

test('changing a whole text box unifies only the edited property', () => {
  let config = setSelectedTextStyle({}, 'desktop', target, { fontFamily: 'mono', fontSize: 24 });
  config = setSelectedTextStyle(config, 'desktop', { ...target, whole: true, end: target.text.length }, { fontFamily: 'serif' });
  expect(config.viewportLayout.desktop.textStyles[textStyleKey(target)]).toMatchObject({ fieldStyle: { fontFamily: 'serif' }, runs: [{ start: 0, end: 5, style: { fontSize: 24 } }] });
});

test('rich text styles round-trip, support explicit off values, and reject unsafe colors', () => {
  const model = new Model({ pages: [{ name: 'p', elements: [{ type: 'text', name: 'q', title: target.text }] }] });
  applySurveyLocale(model, {});
  let config = setSelectedTextStyle({}, 'mobile', target, { bold: true, italic: true, underline: true, color: '#EF1234', highlight: '#fff59d' });
  const unbind = bindSelectedTextStyles(model, () => config.viewportLayout.mobile.textStyles);
  const question = model.getQuestionByName('q');
  const html = question.locTitle.renderedHtml;
  expect(html).toContain('font-weight: 700');
  expect(html).toContain('font-style: italic');
  expect(html).toContain('text-decoration: underline');
  expect(html).toContain('color: rgb(239, 18, 52)');
  expect(html).toContain('background-color: rgb(255, 245, 157)');
  config = JSON.parse(JSON.stringify(config));
  config = setSelectedTextStyle(config, 'mobile', target, { bold: false, italic: false, underline: false, highlight: 'transparent', color: 'red; background:url(evil)' });
  model.locStrsChanged();
  expect(question.locTitle.renderedHtml).toContain('font-weight: 400');
  expect(question.locTitle.renderedHtml).toContain('font-style: normal');
  expect(question.locTitle.renderedHtml).toContain('text-decoration: none');
  expect(question.locTitle.renderedHtml).toContain('background-color: transparent');
  expect(question.locTitle.renderedHtml).not.toContain('evil');
  expect(config.viewportLayout.desktop).toBeUndefined();
  unbind(); model.dispose();
});
