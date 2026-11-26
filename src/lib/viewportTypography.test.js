import { copyTypography, normalizeTypography, resetTypography, setTypographyField, typographySlot } from './viewportTypography';
import { resolvePublishedFrame } from './viewportLayout';

const base = { pages: [{ name: 'p', elements: [{ type: 'text', name: 'q' }] }], viewportLayout: { desktop: { contentWidth: 1000, typography: { questionTitleSize: 24 } }, mobile: { questions: { q: { questionWidth: 300 } } } } };

test('device and question typography inherit independently and survive serialization', () => {
  let config = setTypographyField(base, 'mobile', null, 'questionTitleSize', 18);
  config = setTypographyField(config, 'mobile', 'q', 'questionTitleSize', 20);
  config = setTypographyField(config, 'mobile', null, 'questionTitleSize', 19);
  config = JSON.parse(JSON.stringify(config));
  expect(typographySlot(config, 'mobile', 'q')).toMatchObject({ own: { questionTitleSize: 20 }, inherited: { questionTitleSize: 19 }, resolved: { questionTitleSize: 20 } });
  expect(typographySlot(config, 'desktop', 'q').resolved.questionTitleSize).toBe(24);
  config = setTypographyField(config, 'mobile', 'q', 'questionTitleSize', null);
  expect(typographySlot(config, 'mobile', 'q').resolved.questionTitleSize).toBe(19);
  expect(config.viewportLayout.mobile.questions.q.questionWidth).toBe(300);
  expect(base.viewportLayout.mobile.typography).toBeUndefined();
});

test('copy and reset replace only typography in the selected scope', () => {
  let config = setTypographyField(base, 'desktop', 'q', 'lineHeight', 1.8);
  config = copyTypography(config, 'desktop', 'q');
  expect(config.viewportLayout.mobile.questions.q).toEqual({ questionWidth: 300, typography: { lineHeight: 1.8 } });
  expect(config.viewportLayout.mobile.typography).toBeUndefined();
  config = copyTypography(config, 'desktop');
  expect(config.viewportLayout.mobile.typography).toEqual({ questionTitleSize: 24 });
  config = resetTypography(config, 'mobile', 'q');
  expect(config.viewportLayout.mobile.questions.q).toEqual({ questionWidth: 300 });
  expect(config.viewportLayout.desktop.contentWidth).toBe(1000);
});

test('font-only overrides never change the historical content or card width', () => {
  const config = setTypographyField({}, 'desktop', 'q', 'questionTitleSize', 22);
  expect(resolvePublishedFrame(config, 1280)).toMatchObject({ contentWidth: null, questionWidth: null });
  expect(resetTypography(config, 'desktop', 'q')).toEqual({ viewportLayout: {} });
});

test('invalid fields and values cannot become CSS, and values are bounded', () => {
  expect(normalizeTypography({ lineHeight: 1.799999, answerSize: 0, questionTitleSize: Infinity, descriptionSize: '20px', unknown: 14 })).toEqual({ answerSize: 12, lineHeight: 1.8 });
  expect(setTypographyField(base, 'mobile', 'q', 'surveyTitleSize', 30)).toBe(base);
  expect(setTypographyField(base, 'mobile', null, 'answerSize', NaN)).toBe(base);
});

test('font families inherit, reset and copy without accepting arbitrary CSS', () => {
  let config = setTypographyField(base, 'mobile', null, 'fontFamily', 'serif');
  expect(typographySlot(config, 'mobile', 'q').resolved.fontFamily).toBe('serif');
  config = setTypographyField(config, 'mobile', 'q', 'fontFamily', 'mono');
  expect(typographySlot(config, 'mobile', 'q').resolved.fontFamily).toBe('mono');
  config = setTypographyField(config, 'mobile', 'q', 'fontFamily', null);
  expect(typographySlot(config, 'mobile', 'q').resolved.fontFamily).toBe('serif');
  expect(setTypographyField(config, 'mobile', null, 'fontFamily', 'url(evil)')).toBe(config);
  config = copyTypography(config, 'mobile');
  expect(typographySlot(config, 'desktop').resolved.fontFamily).toBe('serif');
});
