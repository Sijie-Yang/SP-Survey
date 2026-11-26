import {
  applySiteAnswer,
  buildSiteQuestions,
  checkSiteHtml,
  missingRequired,
  prepareSiteDocument,
  validateSiteAnswer,
  withoutSiteHtml,
} from './spSite';

const media = (n, prefix = 'a') => Array.from({ length: n }, (_, i) => ({ url: `https://media.sp-survey.org/${prefix}${i}.jpg`, name: `${prefix}${i}.jpg`, type: 'image' }));

// Shape of a survey after the platform drew media (as SurveyApp / preview produce it).
const injected = {
  title: 'Study',
  locale: 'zh',
  pages: [
    { name: 'p0', elements: [{ type: 'boolean', name: 'consent', title: { default: 'I agree', zh: '我同意' }, isRequired: true }] },
    {
      name: 'p1',
      elements: [
        { type: 'imagepicker', name: 'duel', title: 'Safer?', trialCount: 2, isRequired: true, trialMediaSets: [media(2, 't0_'), media(2, 't1_')], choices: [] },
        {
          type: 'imageslidergroup', name: 'scales', title: 'Rate', scaleMin: 1, scaleMax: 7,
          dimensions: [{ id: 'safety', label: 'Safety', left: 'Unsafe', right: 'Safe' }],
          imageUrls: [media(1)[0].url], imageNames: ['a0.jpg'],
        },
        { type: 'text', inputType: 'number', name: 'age', min: 18, max: 99 },
        { type: 'html', name: 'p1_placeholder', html: '<div></div>' },
      ],
    },
  ],
};

describe('buildSiteQuestions', () => {
  const questions = buildSiteQuestions(injected);
  const byName = Object.fromEntries(questions.map((q) => [q.name, q]));

  test('lists answerable questions with localized wording and skips runtime placeholders', () => {
    expect(questions.map((q) => q.name)).toEqual(['consent', 'duel', 'scales', 'age']);
    expect(byName.consent).toMatchObject({ kind: 'boolean', title: '我同意', required: true });
    expect(byName.age).toMatchObject({ type: 'number', kind: 'number', min: 18, max: 99 });
  });

  test('gives each trial its own drawn media and choice values', () => {
    expect(byName.duel.trials).toHaveLength(2);
    expect(byName.duel.trials[1].media.map((m) => m.name)).toEqual(['t1_0.jpg', 't1_1.jpg']);
    expect(byName.duel.trials[1].choices).toEqual([
      { value: 'image_0', text: 'image_0', imageUrl: media(2, 't1_')[0].url },
      { value: 'image_1', text: 'image_1', imageUrl: media(2, 't1_')[1].url },
    ]);
  });

  test('passes slider bounds and the drawn image', () => {
    expect(byName.scales.media[0].url).toBe(media(1)[0].url);
    expect(byName.scales.dimensions[0]).toMatchObject({ id: 'safety', min: 1, max: 7, step: 1 });
  });
});

describe('answers', () => {
  const questions = buildSiteQuestions(injected);
  const q = (name) => questions.find((x) => x.name === name);

  test('validates values per native type', () => {
    expect(validateSiteAnswer(q('consent'), 'yes').ok).toBe(false);
    expect(validateSiteAnswer(q('age'), '30')).toEqual({ ok: true, value: 30 });
    expect(validateSiteAnswer(q('age'), 12).ok).toBe(false);
    expect(validateSiteAnswer(q('scales'), { safety: 9 }).ok).toBe(false);
    expect(validateSiteAnswer(q('scales'), { safety: 5 })).toEqual({ ok: true, value: { safety: 5 } });
    expect(validateSiteAnswer(q('scales'), { other: 5 }).ok).toBe(false);
  });

  test('records trials with what was shown and rejects URLs as choices', () => {
    const duel = q('duel');
    expect(applySiteAnswer(duel, undefined, 'image_0').ok).toBe(false);
    expect(applySiteAnswer(duel, undefined, media(2, 't0_')[0].url, { trial: 0 }).ok).toBe(false);
    const first = applySiteAnswer(duel, undefined, 'image_1', { trial: 0 });
    expect(first.ok).toBe(true);
    const second = applySiteAnswer(duel, first.stored, 'image_0', { trial: 1 });
    expect(second.stored.trials).toEqual([
      { value: 'image_1', shown_images: media(2, 't0_').map((m) => m.url), shown_media_ids: ['t0_0.jpg', 't0_1.jpg'] },
      { value: 'image_0', shown_images: media(2, 't1_').map((m) => m.url), shown_media_ids: ['t1_0.jpg', 't1_1.jpg'] },
    ]);
  });

  test('completion lists unanswered required questions', () => {
    const duel = q('duel');
    const one = applySiteAnswer(duel, undefined, 'image_1', { trial: 0 }).stored;
    expect(missingRequired(questions, { duel: one })).toEqual(['consent', 'duel']);
    const both = applySiteAnswer(duel, one, 'image_1', { trial: 1 }).stored;
    expect(missingRequired(questions, { consent: false, duel: both })).toEqual([]);
  });
});

describe('site document', () => {
  test('puts the CSP and SDK first in head and drops the preview shim', () => {
    const html = '<!doctype html><html><head><!-- sp-site-preview:start --><script>shim()</script><!-- sp-site-preview:end --><title>x</title></head><body></body></html>';
    const doc = prepareSiteDocument(html);
    expect(doc.startsWith('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain('window.SPSite');
    expect(doc).not.toContain('shim()');
  });

  test('static checks catch pages that cannot record answers', () => {
    const { errors } = checkSiteHtml('<html><body><script src="https://evil.example/x.js"></script><script>fetch("/x")</script></body></html>', ['q1']);
    expect(errors.join('\n')).toMatch(/SPSite\.answer/);
    expect(errors.join('\n')).toMatch(/SPSite\.complete/);
    expect(errors.join('\n')).toMatch(/evil\.example/);
  });

  test('the assistant never receives the page', () => {
    const config = { pages: [], spSite: { html: '<html></html>', id: 'site-1' } };
    expect(withoutSiteHtml(config).spSite).toEqual(expect.objectContaining({ id: 'site-1' }));
    expect(withoutSiteHtml(config).spSite.html).toBeUndefined();
  });
});

test('imagerating labels become the answer options of a one-image rating', () => {
  const [q] = buildSiteQuestions({ pages: [{ name: 'p', elements: [
    { type: 'imagerating', name: 'state', imageCount: 1, rateMin: 0, rateMax: 2, rateLabels: ['Clean', 'Minor issues', 'Vacant'] },
  ] }] });
  expect(q.rateValues).toEqual([{ value: '0', text: 'Clean' }, { value: '1', text: 'Minor issues' }, { value: '2', text: 'Vacant' }]);
});
