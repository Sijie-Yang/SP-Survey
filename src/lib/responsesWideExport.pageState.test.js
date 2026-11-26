import { buildResponsesWideCsv } from './responsesWideExport';

test('what an SP-Scheme page saved in its own storage is exported as one JSON column', () => {
  const rows = [{ participant_id: 'p1', responses: { __sp_page_state: { survey: { step: 3, consent: true } } } }];
  const csv = buildResponsesWideCsv(rows, [], { pages: [] });
  const [header, line] = csv.replace(/^﻿/, '').trim().split(/\r?\n/);
  expect(header.split(',')).toContain('__sp_page_state');
  expect(line).toContain('""consent"":true');
});
