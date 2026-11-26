/**
 * @jest-environment node
 */
import { mediaIdentityKey, resolveMediaAnswerKey } from './mediaIdentity';
import { computeQuestionTrueSkill } from './trueskill';
import { computeQuestionIrr } from './reliability';
import { syntheticResponses, syntheticSurveyConfig } from './__fixtures__/syntheticResults';

test('identity keys drop signatures and hashes and stay stable on repeat calls', () => {
  const signed = 'https://cdn.example.org/a/park.jpg?X-Amz-Signature=abc&v=2&token=t#frag';
  const first = mediaIdentityKey(signed);
  expect(first).toBe('https://cdn.example.org/a/park.jpg?v=2');
  expect(mediaIdentityKey(signed)).toBe(first);
  expect(mediaIdentityKey({ url: signed })).toBe(first);
  expect(mediaIdentityKey('https://cdn.example.org/a/park.jpg?v=2&X-Amz-Expires=1')).toBe(first);
  expect(mediaIdentityKey('/local/park.jpg#x')).toBe('/local/park.jpg');
  expect(resolveMediaAnswerKey('park.jpg', [signed, 'https://cdn.example.org/b/lake.jpg'])).toBe(first);
});

test('analysis over 500 responses parses each distinct media URL once', () => {
  const config = syntheticSurveyConfig();
  const rows = syntheticResponses(500, { config });
  const NativeURL = global.URL;
  let parsed = 0;
  global.URL = class CountingURL extends NativeURL {
    constructor(...args) { super(...args); parsed += 1; }
  };
  try {
    ['safe', 'lively'].forEach((name) => computeQuestionTrueSkill(rows, name));
    config.pages.flatMap((p) => p.elements).forEach((q) => computeQuestionIrr(rows, q));
  } finally {
    global.URL = NativeURL;
  }
  expect(parsed).toBeLessThanOrEqual(config.pages[1].elements[0].selectedImageUrls.length);
});
