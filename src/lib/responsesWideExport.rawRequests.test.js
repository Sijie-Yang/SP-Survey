import { buildResponsesWideCsv } from './responsesWideExport';

test('raw page requests become one JSON column', () => {
  const rows = [
    { participant_id: 'p1', responses: { __sp_requests: [{ at: 't', method: 'POST', url: '/api/save', data: { q: 1 } }] } },
    { participant_id: 'p2', responses: {} },
  ];
  const csv = buildResponsesWideCsv(rows, [], null);
  const [header, r1, r2] = csv.trim().split('\n');
  expect(header.split(',').pop()).toBe('__sp_requests');
  expect(r1).toContain('/api/save');
  expect(r2.endsWith(',')).toBe(true);
});

test('no column when no response has raw requests', () => {
  const csv = buildResponsesWideCsv([{ participant_id: 'p1', responses: { a: 1 } }], [{ name: 'a', type: 'text' }], null);
  expect(csv.split('\n')[0]).not.toContain('__sp_requests');
});
