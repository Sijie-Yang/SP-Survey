import { irrLevelForQuestion } from './reliability';
import { answerToSelectedKeys } from './trueskill';

describe('image / media parity fixes', () => {
  test('mediaslidergroup uses interval IRR like imageslidergroup', () => {
    expect(irrLevelForQuestion({ type: 'imageslidergroup' })).toBe('interval');
    expect(irrLevelForQuestion({ type: 'mediaslidergroup' })).toBe('interval');
  });

  test('answerToSelectedKeys resolves media_N like image_N', () => {
    const shown = ['https://r2.test/a.jpg', 'https://r2.test/b.jpg'];
    expect(answerToSelectedKeys('image_0', shown)).toEqual([shown[0]]);
    expect(answerToSelectedKeys('media_1', shown)).toEqual([shown[1]]);
    expect(answerToSelectedKeys(['media_0', 'media_1'], shown)).toEqual(shown);
  });
});
