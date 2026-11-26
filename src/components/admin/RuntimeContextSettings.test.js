import { conditionIdFromLabel, rowsToConditions } from './RuntimeContextSettings';

test('condition rows keep ids and derive new ones from names', () => {
  expect(rowsToConditions([{ id: 'safe', label: 'Looks safe' }, { id: '', label: 'Looks less safe' }, { id: '', label: '' }]))
    .toEqual([{ id: 'safe', label: 'Looks safe' }, { id: 'looks_less_safe', label: 'Looks less safe' }]);
  expect(rowsToConditions([{ id: '', label: '正向' }, { id: '', label: '反向' }]).map((c) => c.id)).toEqual(['condition', 'condition_2']);
  expect(rowsToConditions([{ id: '', label: ' ' }])).toBeUndefined();
  expect(conditionIdFromLabel('2 colours')).toBe('c_2_colours');
});
