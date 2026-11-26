import { hashSeed, seededRandom, shuffled } from './shuffle';

test('shuffled keeps every item and leaves the input alone', () => {
  const input = [1, 2, 3, 4, 5];
  const out = shuffled(input, seededRandom(7));
  expect(out.slice().sort()).toEqual([1, 2, 3, 4, 5]);
  expect(input).toEqual([1, 2, 3, 4, 5]);
  expect(shuffled(null)).toEqual([]);
});

test('every item is equally likely to be drawn (the old sort trick favoured the first items)', () => {
  const rand = seededRandom(20261117);
  const picked = new Array(10).fill(0);
  const rounds = 40000;
  for (let i = 0; i < rounds; i += 1) {
    shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], rand).slice(0, 2).forEach((x) => { picked[x] += 1; });
  }
  // Expected share 20% each; the sort trick gave the first item about 33% and the last about 12%.
  picked.forEach((count) => {
    expect(count / rounds).toBeGreaterThan(0.19);
    expect(count / rounds).toBeLessThan(0.21);
  });
});

test('seeded random numbers repeat for the same seed and differ between seeds', () => {
  const a = seededRandom(hashSeed('project', 'q1'));
  const b = seededRandom(hashSeed('project', 'q1'));
  const c = seededRandom(hashSeed('project', 'q2'));
  const first = [a(), a(), a()];
  expect([b(), b(), b()]).toEqual(first);
  expect([c(), c(), c()]).not.toEqual(first);
  first.forEach((x) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); });
});
