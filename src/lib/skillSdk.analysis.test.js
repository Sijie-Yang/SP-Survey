import {
  shapeAnalysisResponses,
  buildSyntheticAnalysisResponses,
  buildAnalysisSrcdoc,
  ANALYSIS_RESPONSES_CAP,
} from './skillSdk';

describe('SPAnalysis helpers', () => {
  it('shapes and caps analysis responses', () => {
    const big = Array.from({ length: ANALYSIS_RESPONSES_CAP + 10 }, (_, i) => ({
      answer: { n: i },
      shown_images: [],
      participant_id: `p${i}`,
    }));
    const shaped = shapeAnalysisResponses(big);
    expect(shaped).toHaveLength(ANALYSIS_RESPONSES_CAP);
    expect(shaped[0]).toHaveProperty('answer');
    expect(shaped[0]).toHaveProperty('participant_id');
  });

  it('builds synthetic responses from resultSchema', () => {
    const schema = [
      { key: 'marks', type: 'points' },
      { key: 'order', type: 'rankedList' },
      { key: 'score', type: 'number' },
    ];
    const synth = buildSyntheticAnalysisResponses(schema, [{ url: 'https://x/a.jpg' }], 3);
    expect(synth).toHaveLength(3);
    expect(Array.isArray(synth[0].answer.marks)).toBe(true);
    expect(Array.isArray(synth[0].answer.order)).toBe(true);
    expect(typeof synth[0].answer.score).toBe('number');
    expect(synth[0].answer.imageUrl).toContain('a.jpg');
  });

  it('buildAnalysisSrcdoc injects SPAnalysis SDK', () => {
    const html = buildAnalysisSrcdoc('<div id="app">hi</div>', null);
    expect(html).toContain('SPAnalysis');
    expect(html).toContain('spanalysis-init');
    expect(html).toContain('getResponses');
  });
});
