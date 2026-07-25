import { summarizeSkillAnswer, summarizeSkillAnswerOneLine } from './skillAnswerSummary';

describe('summarizeSkillAnswer', () => {
  test('empty (en default)', () => {
    expect(summarizeSkillAnswer(null)[0]).toMatch(/no answer/i);
  });

  test('empty (zh)', () => {
    expect(summarizeSkillAnswer(null, 'zh')[0]).toMatch(/未作答/);
  });

  test('cue_detective en', () => {
    const lines = summarizeSkillAnswer({
      mode: 'cue_detective',
      rankedCues: ['green', 'lighting'],
      elapsedMs: 12000,
    }, 'en');
    expect(lines.some((l) => l.includes('Cue order'))).toBe(true);
    expect(lines.some((l) => l.includes('Task'))).toBe(true);
    expect(summarizeSkillAnswerOneLine({
      mode: 'cue_detective',
      rankedCues: ['a', 'b'],
    }, 'en')).toContain('Cue order');
  });

  test('cue_detective zh', () => {
    const lines = summarizeSkillAnswer({
      mode: 'cue_detective',
      rankedCues: ['绿化', '照明'],
    }, 'zh');
    expect(lines.some((l) => l.includes('线索顺序'))).toBe(true);
  });

  test('budget_lab en', () => {
    const lines = summarizeSkillAnswer({
      mode: 'budget_lab',
      allocations: { lighting: 40, trees: 60 },
      total: 100,
      priority: 'trees',
    }, 'en');
    expect(lines.some((l) => l.includes('Budget'))).toBe(true);
    expect(lines.some((l) => l.includes('Total'))).toBe(true);
  });
});
