import { isLocalhostSurveyUrl, localSurveyUrl, resolveShareSurveyUrl } from './shareSurveyUrl';

test('falls back to the local Live Survey link when the saved URL is empty or invalid', () => {
  const origin = 'http://localhost:3000';
  const projectId = 'proj_1';
  const local = 'http://localhost:3000/survey?project=proj_1';
  expect(localSurveyUrl(origin, projectId)).toBe(local);
  expect(resolveShareSurveyUrl({ projectId, origin })).toEqual({ url: local, isDeployed: false });
  expect(resolveShareSurveyUrl({ deployedParticipantUrl: '   ', projectId, origin })).toEqual({
    url: local,
    isDeployed: false,
  });
  expect(resolveShareSurveyUrl({ deployedParticipantUrl: 'not-a-url', projectId, origin })).toEqual({
    url: local,
    isDeployed: false,
  });
  expect(resolveShareSurveyUrl({ deployedParticipantUrl: 'ftp://example.com', projectId, origin })).toEqual({
    url: local,
    isDeployed: false,
  });
});

test('uses a saved http(s) URL as-is when it already has a path', () => {
  expect(resolveShareSurveyUrl({
    deployedParticipantUrl: 'https://study.vercel.app/survey?project=proj_1',
    projectId: 'proj_1',
    origin: 'http://localhost:3000',
  })).toEqual({
    url: 'https://study.vercel.app/survey?project=proj_1',
    isDeployed: true,
  });
  expect(resolveShareSurveyUrl({
    deployedParticipantUrl: 'https://study.vercel.app/live',
    projectId: 'proj_1',
    origin: 'http://localhost:3000',
  })).toEqual({
    url: 'https://study.vercel.app/live',
    isDeployed: true,
  });
});

test('appends /survey?project= to a bare deployed origin', () => {
  expect(resolveShareSurveyUrl({
    deployedParticipantUrl: 'https://study.vercel.app',
    projectId: 'proj_1',
    origin: 'http://localhost:3000',
  })).toEqual({
    url: 'https://study.vercel.app/survey?project=proj_1',
    isDeployed: true,
  });
  expect(resolveShareSurveyUrl({
    deployedParticipantUrl: 'https://study.vercel.app/',
    projectId: 'proj_1',
    origin: 'http://localhost:3000',
  })).toEqual({
    url: 'https://study.vercel.app/survey?project=proj_1',
    isDeployed: true,
  });
});

test('detects localhost-only survey links', () => {
  expect(isLocalhostSurveyUrl('http://localhost:3000/survey?project=proj_1')).toBe(true);
  expect(isLocalhostSurveyUrl('http://127.0.0.1:3000/survey?project=proj_1')).toBe(true);
  expect(isLocalhostSurveyUrl('https://study.vercel.app/survey')).toBe(false);
  expect(isLocalhostSurveyUrl('not-a-url')).toBe(false);
});
