import { resolveQuestionImageChoices } from './questionImageChoices';

describe('resolveQuestionImageChoices', () => {
  test('prefers choices with imageLink', () => {
    expect(resolveQuestionImageChoices({
      choices: [{ value: 'image_0', imageLink: 'https://a.jpg' }],
      imageLinks: ['https://b.jpg'],
    })).toEqual([{ value: 'image_0', imageLink: 'https://a.jpg', imageName: undefined }]);
  });

  test('falls back to imageLinks when choices empty', () => {
    expect(resolveQuestionImageChoices({
      choices: [],
      imageLinks: ['https://a.jpg', 'https://b.jpg'],
      imageNames: ['a.jpg', 'b.jpg'],
    })).toEqual([
      { value: 'image_0', imageLink: 'https://a.jpg', imageName: 'a.jpg' },
      { value: 'image_1', imageLink: 'https://b.jpg', imageName: 'b.jpg' },
    ]);
  });

  test('trialStimulusMedia wins over stale choices', () => {
    expect(resolveQuestionImageChoices(
      { choices: [{ value: 'image_0', imageLink: 'https://old.jpg' }] },
      [{ url: 'https://new.jpg', name: 'new.jpg' }],
    )).toEqual([
      { value: 'image_0', imageLink: 'https://new.jpg', imageName: 'new.jpg' },
    ]);
  });
});
