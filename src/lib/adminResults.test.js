/**
 * @jest-environment node
 */
/* global globalThis */
// Self-hosted: the researcher's own Supabase client (URL and key saved on the Media tab).
jest.mock('./supabase', () => ({
  supabase: { supabaseUrl: 'https://own.supabase.co/', supabaseKey: 'own-service-key' },
}));

const contract = { version: 2, title: 'Street', questions: [{ name: 'safe', type: 'imagepicker', selectedImageUrls: ['https://m/1.jpg'] }] };
const fullRow = (i) => ({
  id: `r${i}`,
  created_at: `2026-10-01T00:00:0${9 - i}+00:00`,
  project_id: 'p',
  responses: { safe: 'https://m/1.jpg' },
  survey_metadata: { condition: 'A', survey_revision: 'v1', survey_response_contract: contract },
});
const slim = (row, ref) => {
  const { survey_response_contract: _omit, ...meta } = row.survey_metadata;
  return { ...row, survey_metadata: meta, _contract_ref: ref };
};

const reply = (body, status = 200) => ({
  ok: status < 300, status, statusText: '', headers: { get: () => null },
  json: async () => body, text: async () => JSON.stringify(body),
});

let fetchMock;
beforeEach(() => {
  jest.resetModules();
  fetchMock = jest.fn();
  global.fetch = fetchMock;
  if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto;
});

test('owner results fall back to full rows when the RPC is not installed', async () => {
  const { createResponseLoadSession, fetchOwnerResponsePage } = require('./adminResults');
  const rows = [fullRow(1), fullRow(2)];
  fetchMock.mockImplementation(async (url, init = {}) => {
    const u = new URL(url);
    expect(u.origin).toBe('https://own.supabase.co');
    expect(init.headers.Authorization).toBe('Bearer own-service-key');
    expect(init.headers.apikey).toBe('own-service-key');
    if (u.pathname.endsWith('/rpc/survey_response_rows')) {
      return reply({ code: 'PGRST202', message: 'missing' }, 404);
    }
    if (u.searchParams.get('select') === 'id,created_at,project_id') {
      return reply(u.searchParams.get('or') ? [] : rows.map(({ id, created_at, project_id }) => ({ id, created_at, project_id })));
    }
    return reply(rows);
  });
  const session = createResponseLoadSession();
  const page = await fetchOwnerResponsePage('p', null, session);
  expect(page).toEqual(rows);
  expect(session.mode).toBe('legacy');
  const calls = fetchMock.mock.calls.length;
  expect(await fetchOwnerResponsePage('p', page[1], session)).toEqual([]);
  expect(fetchMock.mock.calls.slice(calls).some(([url]) => String(url).includes('/rpc/'))).toBe(false);
});

test('the platform-admin loader is not part of the self-hosted app', async () => {
  const { fetchAdminResponsePage } = require('./adminResults');
  await expect(fetchAdminResponsePage('p')).rejects.toMatchObject({ code: 'ADMIN_RESULTS_UNAVAILABLE' });
});

test('response count uses the own Supabase', async () => {
  const { countOwnerResponses } = require('./adminResults');
  fetchMock.mockImplementation(async (url, init = {}) => {
    expect(String(url).startsWith('https://own.supabase.co/rest/v1/survey_responses?')).toBe(true);
    expect(init.headers.Authorization).toBe('Bearer own-service-key');
    return { ok: true, status: 206, headers: { get: () => '0-0/7' } };
  });
  expect(await countOwnerResponses('p')).toBe(7);
});
