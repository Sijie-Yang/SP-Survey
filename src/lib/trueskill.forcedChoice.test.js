import {
  matchesFromForcedChoiceAnswer,
  computeForcedChoiceTrueSkill,
  filenameKey,
} from './trueskill';

describe('matchesFromForcedChoiceAnswer', () => {
  const shown = [
    'https://cdn.example/a.jpg',
    'https://cdn.example/b.jpg',
  ];

  test('choice A → A beats B', () => {
    const matches = matchesFromForcedChoiceAnswer({ choice: 'A', chosenIndex: 0 }, shown);
    expect(matches).toEqual([{ winner: 'https://cdn.example/a.jpg', loser: 'https://cdn.example/b.jpg' }]);
  });

  test('choice B → B beats A', () => {
    const matches = matchesFromForcedChoiceAnswer({ choice: 'B', chosenIndex: 1 }, shown);
    expect(matches).toEqual([{ winner: 'https://cdn.example/b.jpg', loser: 'https://cdn.example/a.jpg' }]);
  });

  test('falls back to imageA/imageB when shown empty', () => {
    const matches = matchesFromForcedChoiceAnswer({
      choice: 'B',
      chosenIndex: 1,
      imageA: 'https://cdn.example/left.png',
      imageB: 'https://cdn.example/right.png',
    }, []);
    expect(matches).toEqual([{ winner: 'https://cdn.example/right.png', loser: 'https://cdn.example/left.png' }]);
  });

  test('resolves winner from chosenUrl', () => {
    const matches = matchesFromForcedChoiceAnswer({
      chosenUrl: 'https://cdn.example/b.jpg',
    }, shown);
    expect(matches).toEqual([{ winner: 'https://cdn.example/b.jpg', loser: 'https://cdn.example/a.jpg' }]);
  });
});

describe('computeForcedChoiceTrueSkill', () => {
  test('ranks consistently from multiple trials', () => {
    const responses = [
      {
        responses: {
          q1: {
            answer: { choice: 'A', chosenIndex: 0 },
            shown_images: ['https://x/win.jpg', 'https://x/lose.jpg'],
          },
        },
      },
      {
        responses: {
          q1: {
            answer: { choice: 'A', chosenIndex: 0 },
            shown_images: ['https://x/win.jpg', 'https://x/other.jpg'],
          },
        },
      },
    ];
    const { rankings, matches } = computeForcedChoiceTrueSkill(responses, 'q1');
    expect(matches.length).toBe(2);
    expect(filenameKey(rankings[0].imageKey)).toBe('https://x/win.jpg');
    expect(rankings[0].wins).toBe(2);
  });
});
