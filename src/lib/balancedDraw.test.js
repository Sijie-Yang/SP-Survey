import {
  BALANCE_HOLD_MINUTES, balanceResponseMetadata, balancedSlice, createBalancePlan, forgetBalanceNumber,
  localBalanceNumber, recallBalanceNumber, rememberBalanceNumber,
} from './balancedDraw';

const keys = (n) => Array.from({ length: n }, (_, i) => `img${String(i).padStart(3, '0')}.jpg`);

describe('balancedSlice', () => {
  test('after any number of participants every image has been shown equally often, and nobody sees one twice', () => {
    let cases = 0;
    for (const n of [2, 3, 7, 10, 24, 55, 200]) {
      for (const per of [1, 2, 3, 5, 10, 20, 33]) {
        for (const seed of [1, 'projectA']) {
          const shown = new Array(n).fill(0);
          const people = Math.ceil((n * 4) / Math.min(per, n)) + 3;
          for (let k = 0; k < people; k += 1) {
            const slice = balancedSlice(n, per, k, seed);
            expect(slice).toHaveLength(Math.min(per, n));
            expect(new Set(slice).size).toBe(slice.length);
            slice.forEach((i) => { shown[i] += 1; });
            // Balanced at every point, not only at the end.
            expect(Math.max(...shown) - Math.min(...shown)).toBeLessThanOrEqual(1);
          }
          cases += 1;
        }
      }
    }
    expect(cases).toBe(98);
  });

  test('the same number always gets the same images; other numbers get other images', () => {
    expect(balancedSlice(50, 5, 3, 'p')).toEqual(balancedSlice(50, 5, 3, 'p'));
    expect(balancedSlice(50, 5, 3, 'p')).not.toEqual(balancedSlice(50, 5, 4, 'p'));
    expect(balancedSlice(50, 5, 3, 'p')).not.toEqual(balancedSlice(50, 5, 3, 'other project'));
  });

  test('empty and odd inputs', () => {
    expect(balancedSlice(0, 5, 0, 's')).toEqual([]);
    expect(balancedSlice(3, 10, 0, 's').slice().sort()).toEqual([0, 1, 2]);
    expect(balancedSlice(5, 0, -4, 's')).toHaveLength(1);
  });
});

describe('createBalancePlan', () => {
  const group = (over = {}) => ({ id: 'file|shared|streets', keys: keys(200), perPerson: 20, questions: ['safe'], ...over });

  test('200 images, 20 per person, 100 people: every image is shown exactly 10 times', () => {
    const shown = new Map(keys(200).map((k) => [k, 0]));
    for (let k = 0; k < 100; k += 1) {
      const plan = createBalancePlan([group()], { number: k, seed: 'proj' });
      for (let trial = 0; trial < 10; trial += 1) {
        plan.take('safe', 2).forEach((key) => shown.set(key, shown.get(key) + 1));
      }
      expect(plan.take('safe', 2)).toBeNull(); // the queue holds exactly what this person needs
    }
    expect(new Set(shown.values())).toEqual(new Set([10]));
  });

  test('two questions that share a library never give one person the same image, and stay balanced together', () => {
    const shown = new Map(keys(60).map((k) => [k, 0]));
    for (let k = 0; k < 30; k += 1) {
      const plan = createBalancePlan([group({ keys: keys(60), perPerson: 12, questions: ['safe', 'beautiful'] })], { number: k, seed: 'proj' });
      const mine = [...plan.take('safe', 2), ...plan.take('beautiful', 2), ...plan.take('safe', 2), ...plan.take('beautiful', 2), ...plan.take('safe', 2), ...plan.take('beautiful', 2)];
      expect(new Set(mine).size).toBe(12);
      mine.forEach((key) => shown.set(key, shown.get(key) + 1));
    }
    expect(new Set(shown.values())).toEqual(new Set([6]));
  });

  test('questions with their own libraries are balanced independently', () => {
    const groups = [group({ id: 'a', keys: keys(10), perPerson: 5, questions: ['q1'] }), group({ id: 'b', keys: keys(8).map((k) => `park/${k}`), perPerson: 2, questions: ['q2'] })];
    const countA = new Map();
    const countB = new Map();
    for (let k = 0; k < 8; k += 1) {
      const plan = createBalancePlan(groups, { number: k, seed: 'proj' });
      plan.take('q1', 5).forEach((key) => countA.set(key, (countA.get(key) || 0) + 1));
      plan.take('q2', 2).forEach((key) => countB.set(key, (countB.get(key) || 0) + 1));
    }
    expect(new Set(countA.values())).toEqual(new Set([4]));
    expect(new Set(countB.values())).toEqual(new Set([2]));
  });

  test('a question without a queue, or asking for more than its queue holds, gets null (the caller then draws at random)', () => {
    const plan = createBalancePlan([group({ keys: keys(4), perPerson: 4 })], { number: 0, seed: 'p' });
    expect(plan.take('unknown', 2)).toBeNull();
    expect(plan.take('safe', 3)).toHaveLength(3);
    expect(plan.take('safe', 2)).toBeNull();
    expect(createBalancePlan([], { number: 5 }).questions).toEqual([]);
    expect(createBalancePlan([group({ keys: [] })], { number: 5 }).take('safe', 1)).toBeNull();
  });

  test('the order of the library list does not matter', () => {
    const forward = createBalancePlan([group({ keys: keys(30) })], { number: 2, seed: 'p' }).take('safe', 6);
    const backward = createBalancePlan([group({ keys: keys(30).reverse() })], { number: 2, seed: 'p' }).take('safe', 6);
    expect(backward).toEqual(forward);
  });
});

describe('the participant number on this device', () => {
  beforeEach(() => localStorage.clear());

  test('a server number is kept for a reload and forgotten after the hold time or after submitting', () => {
    const now = 1_000_000_000;
    rememberBalanceNumber('p1', { n: 7, claim: 'server', claim_id: 'abc' }, now);
    expect(recallBalanceNumber('p1', now + 60_000)).toEqual({ n: 7, claim: 'server', claim_id: 'abc' });
    expect(recallBalanceNumber('p2', now)).toBeNull();
    expect(recallBalanceNumber('p1', now + (BALANCE_HOLD_MINUTES + 1) * 60_000)).toBeNull();
    forgetBalanceNumber('p1');
    expect(recallBalanceNumber('p1', now)).toBeNull();
  });

  test('a number picked in the browser is never kept', () => {
    rememberBalanceNumber('p1', { n: 3, claim: 'local', claim_id: null });
    expect(recallBalanceNumber('p1')).toBeNull();
    localStorage.setItem('sp_balance_number_p1', 'not json');
    expect(recallBalanceNumber('p1')).toBeNull();
  });

  test('local numbers and response metadata', () => {
    const n = localBalanceNumber(() => 0.5);
    expect(Number.isInteger(n)).toBe(true);
    expect(balanceResponseMetadata({ n: 4, claim: 'server', claim_id: 'x' })).toEqual({ balanced_draw: { n: 4, claim: 'server', claim_id: 'x' } });
    expect(balanceResponseMetadata(null)).toEqual({});
  });
});
