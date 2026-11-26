import { adminI18n } from '../contexts/adminI18n';
import {
  countMatchingProjectResponses,
  countStoredProjectResponses,
  formatSurveyAgeLabel,
  responseCountFromPayload,
  surveyAgeSource,
} from './surveyAge';

const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const daysAgo = (days) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const minutesAgo = (minutes) => new Date(NOW - minutes * 60 * 1000).toISOString();

function label(project, responseCount, t = adminI18n.en) {
  return formatSurveyAgeLabel({ project, responseCount, now: NOW, t });
}

test('survey age strings exist in English and Chinese', () => {
  const keys = Object.keys(adminI18n.en).filter((key) => key.startsWith('surveyAge'));
  expect(keys.length).toBeGreaterThan(0);
  keys.forEach((key) => expect(adminI18n.zh[key]).toBeTruthy());
});

test('uses publish time when the survey has been published', () => {
  const project = { publishedAt: daysAgo(12), createdAt: daysAgo(40) };
  expect(surveyAgeSource(project).kind).toBe('published');
  expect(label(project, 4)).toBe('Published 12 days ago · 4 answers');
  expect(label(project, 4, adminI18n.zh)).toBe('已发布 12 天前 · 4 份回答');
});

test('uses created time and says created when there is no publish time', () => {
  const project = { publishedAt: null, createdAt: daysAgo(12) };
  expect(surveyAgeSource(project).kind).toBe('created');
  expect(label(project, 4)).toBe('Created 12 days ago · 4 answers');
  expect(label(project, 4, adminI18n.zh)).toBe('创建于 12 天前 · 4 份回答');
  expect(label({ publishedAt: 'not-a-date', created_at: daysAgo(2) }, 0)).toBe('Created 2 days ago · 0 answers');
});

test('formats short durations and a single answer', () => {
  expect(label({ publishedAt: minutesAgo(0.2) }, 1)).toBe('Published just now · 1 answer');
  expect(label({ createdAt: minutesAgo(1) }, 2)).toBe('Created 1 minute ago · 2 answers');
  expect(label({ createdAt: minutesAgo(5) }, 3)).toBe('Created 5 minutes ago · 3 answers');
  expect(label({ publishedAt: minutesAgo(60) }, 1)).toBe('Published 1 hour ago · 1 answer');
  expect(label({ publishedAt: minutesAgo(180) }, 8)).toBe('Published 3 hours ago · 8 answers');
  expect(label({ publishedAt: daysAgo(1) }, 1)).toBe('Published 1 day ago · 1 answer');
  expect(label({ publishedAt: new Date(NOW + 60 * 60 * 1000).toISOString() }, 0)).toBe('Published just now · 0 answers');
});

test('shows a placeholder while the count loads and an honest fallback when it cannot', () => {
  const project = { publishedAt: daysAgo(3) };
  expect(label(project, undefined)).toBe('Published 3 days ago · …');
  expect(label(project, null)).toBe('Published 3 days ago · answers unavailable');
  expect(label(project, null, adminI18n.zh)).toBe('已发布 3 天前 · 回答数暂不可用');
  expect(label({}, 6)).toBe('6 answers');
  expect(label({}, undefined)).toBe('');
});

test('counts only stored responses for the requested project', () => {
  const rows = [
    { project_id: 'proj-a' },
    { project_id: 'proj-b' },
    { project_id: 'proj-a' },
    { project_id: null },
  ];
  expect(countMatchingProjectResponses(rows, 'proj-a')).toBe(2);
  expect(responseCountFromPayload({ responses: rows }, 'proj-b')).toBe(1);
  expect(responseCountFromPayload({ success: true, count: 7 }, 'proj-a')).toBe(7);
});

test('asks the local file server for this project count', async () => {
  const fetchImpl = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, count: 4 }),
  }));
  const count = await countStoredProjectResponses('proj-a', {
    platform: false,
    fetchImpl,
    fileServer: 'http://localhost:3001',
  });
  expect(count).toBe(4);
  expect(fetchImpl).toHaveBeenCalledWith(
    'http://localhost:3001/api/responses?countOnly=1&projectId=proj-a',
    { cache: 'no-store' },
  );
});

test('filters a full local response list down to this project', async () => {
  const fetchImpl = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      responses: [{ project_id: 'proj-a' }, { project_id: 'other' }, { project_id: 'proj-a' }],
    }),
  }));
  const count = await countStoredProjectResponses('proj-a', { platform: false, fetchImpl, fileServer: '' });
  expect(count).toBe(2);
});

test('uses the stored owner count in platform mode', async () => {
  const countOwner = jest.fn(async () => 15);
  const fetchImpl = jest.fn();
  const count = await countStoredProjectResponses('proj-a', { platform: true, countOwner, fetchImpl });
  expect(count).toBe(15);
  expect(countOwner).toHaveBeenCalledWith('proj-a');
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('returns null when the local count cannot be read', async () => {
  const fetchImpl = jest.fn(async () => { throw new Error('offline'); });
  expect(await countStoredProjectResponses('proj-a', { platform: false, fetchImpl, fileServer: '' })).toBeNull();
  expect(await countStoredProjectResponses('', { platform: false, fetchImpl })).toBeNull();
});
