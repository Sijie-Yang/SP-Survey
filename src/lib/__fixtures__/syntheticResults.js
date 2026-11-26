/** Deterministic synthetic street-perception project for results-analysis performance tests. */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function syntheticSurveyConfig({ images = 120, urlBase = 'https://media.example.org/street' } = {}) {
  const urls = Array.from({ length: images }, (_, i) => `${urlBase}/set_${i % 4}/img_${String(i).padStart(4, '0')}.jpg`);
  const picker = (name, title) => ({
    name, title, type: 'imagepicker', trialCount: 12, imageCount: 2, selectedImageUrls: urls, choices: [],
  });
  const rating = (name, title) => ({
    name, title, type: 'imagerating', trialCount: 6, rateMin: 1, rateMax: 7, selectedImageUrls: urls,
  });
  return {
    title: 'Synthetic street perception',
    conditions: [{ id: 'A', label: 'Group A' }, { id: 'B', label: 'Group B' }],
    pages: [
      { name: 'consent', elements: [{ name: 'consent', type: 'boolean', title: 'Consent' }] },
      { name: 'pairs', elements: [picker('safe', 'Which place looks safer?'), picker('lively', 'Which place looks livelier?'), picker('beautiful', 'Which place looks more beautiful?')] },
      { name: 'ratings', elements: [rating('comfort', 'Comfort'), rating('greenery', 'Greenery')] },
      {
        name: 'sliders',
        elements: [{
          name: 'feel', title: 'Feelings', type: 'imageslidergroup', trialCount: 4, selectedImageUrls: urls,
          dimensions: [{ id: 'calm', label: 'Calm', min: 0, max: 100 }, { id: 'open', label: 'Open', min: 0, max: 100 }],
        }],
      },
      {
        name: 'about',
        elements: [
          { name: 'gender', type: 'radiogroup', title: 'Gender', choices: ['F', 'M', 'X'] },
          { name: 'age', type: 'dropdown', title: 'Age', choices: ['18-24', '25-34', '35-49', '50+'] },
          { name: 'usage', type: 'matrix', title: 'Usage', columns: [1, 2, 3, 4, 5], rows: ['walk', 'cycle', 'drive'] },
          ...Array.from({ length: 10 }, (_, i) => ({ name: `personality_${i + 1}`, type: 'rating', title: `BFI ${i + 1}`, rateMin: 1, rateMax: 5 })),
          { name: 'comment', type: 'comment', title: 'Comments' },
        ],
      },
    ],
  };
}

export function syntheticResponses(count = 500, { seed = 7, config = syntheticSurveyConfig() } = {}) {
  const r = rng(seed);
  const urls = config.pages[1].elements[0].selectedImageUrls;
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const pair = () => {
    const a = pick(urls);
    let b = pick(urls);
    while (b === a) b = pick(urls);
    return [a, b];
  };
  const contract = {
    title: config.title,
    locale: 'en',
    questions: config.pages.flatMap((p) => p.elements),
  };
  const t0 = Date.parse('2026-09-01T00:00:00Z');
  return Array.from({ length: count }, (_, i) => {
    const pickerAnswer = () => ({
      trials: Array.from({ length: 12 }, (_, t) => {
        const shown = pair();
        return {
          trial_index: t,
          value: r() < 0.05 ? 'no_preference' : shown[r() < 0.5 ? 0 : 1],
          shown_images: shown,
          shown_at: new Date(t0 + i * 3600e3 + t * 5e3).toISOString(),
          answered_at: new Date(t0 + i * 3600e3 + t * 5e3 + 2e3).toISOString(),
        };
      }),
    });
    const ratingAnswer = () => ({
      trials: Array.from({ length: 6 }, (_, t) => ({ trial_index: t, value: 1 + Math.floor(r() * 7), shown_images: [pick(urls)] })),
    });
    const created = new Date(t0 + i * 3600e3).toISOString();
    return {
      id: `resp_${String(i).padStart(5, '0')}`,
      project_id: 'proj_synthetic',
      participant_id: `p_${i}`,
      created_at: created,
      responses: {
        consent: true,
        safe: pickerAnswer(),
        lively: pickerAnswer(),
        beautiful: pickerAnswer(),
        comfort: ratingAnswer(),
        greenery: ratingAnswer(),
        feel: {
          trials: Array.from({ length: 4 }, (_, t) => ({
            trial_index: t, value: { calm: Math.round(r() * 100), open: Math.round(r() * 100) }, shown_images: [pick(urls)],
          })),
        },
        gender: pick(['F', 'M', 'X']),
        age: pick(['18-24', '25-34', '35-49', '50+']),
        usage: { walk: 1 + Math.floor(r() * 5), cycle: 1 + Math.floor(r() * 5), drive: 1 + Math.floor(r() * 5) },
        ...Object.fromEntries(Array.from({ length: 10 }, (_, k) => [`personality_${k + 1}`, 1 + Math.floor(r() * 5)])),
        comment: r() < 0.3 ? `Comment ${i}` : undefined,
      },
      displayed_images: {},
      survey_metadata: {
        session_id: null,
        survey_revision: 'rev_1',
        condition: i % 2 ? 'B' : 'A',
        url_params: { site: pick(['S1', 'S2', 'S3']) },
        browser_id: `b_${i}`,
        completion_time: created,
        timing: { total_seconds: 300 + Math.floor(r() * 600), page_seconds: {} },
        survey_response_contract: contract,
      },
    };
  });
}
