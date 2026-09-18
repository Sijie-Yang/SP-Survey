import { readAllResponsePages, responseCursorFilter } from './responsePagination';
test('loads beyond a lower server cap, including more than 1000 responses', async () => {
  const records = Array.from({ length: 2407 }, (_, i) => ({ id: String(9999 - i), created_at: '2026-09-10T00:00:00Z' }));
  const fetchPage = jest.fn(async (offset, after) => {
    const start = after ? records.findIndex((r) => r.id === after.id) + 1 : 0;
    return records.slice(start, start + 237);
  });
  expect(await readAllResponsePages(fetchPage)).toEqual(records);
  expect(fetchPage.mock.calls.length).toBeGreaterThan(10);
});
test('does not skip remaining records when an earlier row is deleted between cursor pages', async () => {
  let records = [{id:'3'}, {id:'2'}, {id:'1'}];
  const result = await readAllResponsePages(async (_, after) => {
    if (!after) return records.slice(0, 1);
    records = records.filter((r) => r.id !== '3');
    return records.filter((r) => r.id < after.id).slice(0, 1);
  });
  expect(result.map((r) => r.id)).toEqual(['3','2','1']);
});
test('fails explicitly on a repeated page, partial failure or safety limit', async () => {
  await expect(readAllResponsePages(async () => [{id:'same'}])).rejects.toThrow('changed while loading');
  await expect(readAllResponsePages(jest.fn().mockResolvedValueOnce([{id:'a'}]).mockRejectedValueOnce(new Error('offline')))).rejects.toThrow('offline');
  await expect(readAllResponsePages(async () => [{id:'1'},{id:'2'}], {maxRows:1})).rejects.toThrow('No partial results');
  expect(responseCursorFilter({id:'x',created_at:null})).toBe('and(created_at.is.null,id.lt."x")');
});
