import { countCollectingSurveys, isCollectingSurvey } from './collectingSurveys';

const ME = 'user-me';

test('counts this user\'s published surveys that are not closed', () => {
  const projects = [
    { id: 'released', userId: ME, accessRole: 'owner', publishedVersion: 2 },
    { id: 'stamped', userId: ME, publishedAt: '2026-09-01T00:00:00.000Z', publishedVersion: 0 },
    { id: 'snake', user_id: ME, published_version: 1 },
    { id: 'draft', userId: ME, publishedVersion: 0, publishedAt: null, releaseManaged: false, _surveyConfig: { pages: [{ elements: [{ type: 'text' }] }] } },
    { id: 'closed', userId: ME, publishedVersion: 3, closed: true },
    { id: 'paused', userId: ME, publishedAt: '2026-08-01T00:00:00.000Z', status: 'paused' },
    { id: 'not-collecting', userId: ME, publishedVersion: 1, metadata: { collecting: false } },
    { id: 'quota-still-open', userId: ME, publishedVersion: 1, _surveyConfig: { responseQuota: 10 } },
    { id: 'explicit', userId: ME, publishedVersion: 0, collecting: true },
    { id: 'shared', userId: 'user-other', accessRole: 'collaborator', publishedVersion: 4 },
    { id: 'someone-else', userId: 'user-other', accessRole: 'owner', publishedVersion: 1 },
    { id: 'bad-stamp', userId: ME, publishedAt: 'not-a-date', publishedVersion: 0 },
  ];

  expect(countCollectingSurveys(projects, { userId: ME })).toBe(5);
  expect(isCollectingSurvey(projects[3])).toBe(false);
  expect(isCollectingSurvey(projects[7])).toBe(true);
  expect(countCollectingSurveys(null)).toBe(0);
});

test('a closed flag on the published config wins over a publish stamp', () => {
  expect(isCollectingSurvey({
    publishedVersion: 2,
    survey_config_published: { status: 'closed' },
  })).toBe(false);
  expect(isCollectingSurvey({
    publishedVersion: 0,
    surveyConfig: { status: 'open' },
  })).toBe(true);
  expect(isCollectingSurvey({
    publishedVersion: 2,
    collecting: true,
    acceptingResponses: false,
  })).toBe(false);
});

test('does not count collaborator projects even without a viewer id', () => {
  expect(countCollectingSurveys([
    { id: 'mine', publishedVersion: 1, accessRole: 'owner' },
    { id: 'shared', publishedVersion: 9, accessRole: 'collaborator' },
  ])).toBe(1);
});
