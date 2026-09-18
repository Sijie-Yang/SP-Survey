import { applyMediaToElement } from './surveyMediaInjection';

describe('applyMediaToElement preserves text tags for *checkbox', () => {
  test('imagecheckbox keeps existing text choices', () => {
    const element = {
      type: 'imagecheckbox',
      name: 'q1',
      choices: [
        { value: 'green', text: 'Greenery' },
        { value: 'safe', text: 'Safety' },
      ],
    };
    applyMediaToElement(element, [
      { url: 'https://cdn.example/a.jpg', name: 'a.jpg' },
    ]);
    expect(element.imageLinks).toEqual(['https://cdn.example/a.jpg']);
    expect(element.choices).toEqual([
      { value: 'green', text: 'Greenery' },
      { value: 'safe', text: 'Safety' },
    ]);
  });

  test('mediacheckbox keeps existing text choices', () => {
    const element = {
      type: 'mediacheckbox',
      name: 'q2',
      choices: [{ value: 'busy', text: 'Busy' }],
    };
    applyMediaToElement(element, [
      { url: 'https://cdn.example/b.mp4', name: 'b.mp4', type: 'video' },
    ]);
    expect(element.mediaUrl).toContain('b.mp4');
    expect(element.choices).toEqual([{ value: 'busy', text: 'Busy' }]);
  });

  test('imageboolean still overwrites choices with stimulus images', () => {
    const element = {
      type: 'imageboolean',
      name: 'q3',
      choices: [{ value: 'old', text: 'Old' }],
    };
    applyMediaToElement(element, [
      { url: 'https://cdn.example/c.jpg', name: 'c.jpg' },
    ]);
    expect(element.choices).toEqual([
      expect.objectContaining({ value: 'image_0', imageLink: 'https://cdn.example/c.jpg' }),
    ]);
  });
});
