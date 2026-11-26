import { allocationChoiceMax, allocationReadyToAdvance, clampAllocationPoints } from './allocationStats';

test('a point slider stops at the points still left and can be lowered', () => {
  expect(allocationChoiceMax(40, 60)).toBe(100);
  expect(allocationChoiceMax(40, 0)).toBe(40);
  expect(allocationChoiceMax(0, 0)).toBe(0);
  expect(allocationChoiceMax(80, -20)).toBe(80);
  expect(clampAllocationPoints(90, 40)).toBe(40);
  expect(clampAllocationPoints(10, 40)).toBe(10);
  expect(clampAllocationPoints(-5, 40)).toBe(0);
  expect(clampAllocationPoints('80', 30)).toBe(30);
});

test('allocation is ready to advance only when the distribution is finished', () => {
  const question = { type: 'imagepointallocation', budget: 100, choices: ['greenery', 'safety'] };
  expect(allocationReadyToAdvance({ greenery: 40 }, question)).toBe(false);
  expect(allocationReadyToAdvance({ greenery: 100 }, question)).toBe(true);
  expect(allocationReadyToAdvance({ greenery: 20, safety: 0 }, question)).toBe(true);
  expect(allocationReadyToAdvance({ greenery: 120 }, question)).toBe(false);
});
