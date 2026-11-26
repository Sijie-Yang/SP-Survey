import {
  normalizeRecruitment, readRecruitmentContext, recruitmentReturnUrl, recruitmentMissing,
  platformStudyLink, recruitmentMetadata, cleanReturnUrl, rememberRecruitmentDone, recruitmentDoneHere,
  recruitmentCodeFor,
} from './recruitment';

const prolific = { recruitment: { platform: 'prolific', completionCode: 'C1ABC', quotaFullCode: 'FULL1' } };

test('no platform → no setting, no context, no redirect', () => {
  expect(normalizeRecruitment({})).toBeNull();
  expect(normalizeRecruitment({ recruitment: { platform: 'mturk' } })).toBeNull();
  expect(readRecruitmentContext(null, '?PROLIFIC_PID=x')).toBeNull();
  expect(recruitmentReturnUrl(null, { id: 'x' })).toBe('');
});

test('Prolific: reads PID/STUDY/SESSION and returns with the completion or quota code', () => {
  const s = normalizeRecruitment(prolific);
  const ctx = readRecruitmentContext(s, '?project=p1&PROLIFIC_PID=5f1a&STUDY_ID=st9&SESSION_ID=se3&country=UK');
  expect(ctx).toEqual({ platform: 'prolific', id: '5f1a', study: 'st9', session: 'se3' });
  expect(recruitmentReturnUrl(s, ctx)).toBe('https://app.prolific.com/submissions/complete?cc=C1ABC');
  expect(recruitmentReturnUrl(s, ctx, 'quota_full')).toBe('https://app.prolific.com/submissions/complete?cc=FULL1');
  expect(recruitmentCodeFor(s, 'complete')).toBe('C1ABC');
  expect(recruitmentMetadata(ctx)).toEqual({ recruitment: { ...ctx, outcome: 'complete' } });
});

test('Prolific without a code is incomplete and never redirects', () => {
  const s = normalizeRecruitment({ recruitment: { platform: 'prolific', completionCode: 'bad code!' } });
  expect(s.completionCode).toBe('');
  expect(recruitmentMissing(s)).toEqual(['completionCode']);
  expect(recruitmentReturnUrl(s, { platform: 'prolific', id: 'a' })).toBe('');
});

test('plain link (no platform id) → no context, so nobody is sent away', () => {
  const s = normalizeRecruitment(prolific);
  expect(readRecruitmentContext(s, '?project=p1')).toBeNull();
  expect(readRecruitmentContext(s, '?PROLIFIC_PID=%20%20')).toBeNull();
  expect(readRecruitmentContext(s, `?PROLIFIC_PID=${'x'.repeat(200)}`)).toBeNull();
  expect(recruitmentMetadata(null)).toEqual({});
});

test('Connect: participantId in, the pasted redirect link out', () => {
  const s = normalizeRecruitment({ recruitment: { platform: 'connect', returnUrl: 'https://connect.cloudresearch.com/participant/project/ABC/complete' } });
  const ctx = readRecruitmentContext(s, '?participantId=w1&assignmentId=a1&projectId=pr1');
  expect(ctx).toEqual({ platform: 'connect', id: 'w1', study: 'pr1', session: 'a1' });
  expect(recruitmentReturnUrl(s, ctx)).toBe('https://connect.cloudresearch.com/participant/project/ABC/complete');
  expect(recruitmentReturnUrl(s, ctx, 'quota_full')).toBe('');
  expect(recruitmentMissing(normalizeRecruitment({ recruitment: { platform: 'connect' } }))).toEqual(['returnUrl']);
});

test('other platform: researcher names the id parameter; {id} is filled in and encoded', () => {
  const s = normalizeRecruitment({ recruitment: { platform: 'other', idParam: 'uid', returnUrl: 'https://www.credamo.com/back?u={id}&s=1' } });
  const ctx = readRecruitmentContext(s, '?uid=a%26b');
  expect(ctx).toEqual({ platform: 'other', id: 'a&b' });
  expect(recruitmentReturnUrl(s, ctx)).toBe('https://www.credamo.com/back?u=a%26b&s=1');
  const noReturn = normalizeRecruitment({ recruitment: { platform: 'other', idParam: 'uid' } });
  expect(recruitmentReturnUrl(noReturn, ctx)).toBe('');
  expect(recruitmentMissing(normalizeRecruitment({ recruitment: { platform: 'other', idParam: '1bad' } }))).toEqual(['idParam']);
});

test('only http(s) return links are kept', () => {
  expect(cleanReturnUrl('javascript:alert(1)')).toBe('');
  expect(cleanReturnUrl('data:text/html,hi')).toBe('');
  expect(cleanReturnUrl('not a url')).toBe('');
  expect(cleanReturnUrl(' https://x.org/a?id={id} ')).toBe('https://x.org/a?id={id}');
});

test('study link keeps Prolific placeholders literal and joins with ? or &', () => {
  const s = normalizeRecruitment(prolific);
  expect(platformStudyLink('https://sp-survey.org/s/park', s))
    .toBe('https://sp-survey.org/s/park?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}');
  expect(platformStudyLink('https://sp-survey.org/survey?project=p1&country=UK', s))
    .toMatch(/country=UK&PROLIFIC_PID=\{\{%PROLIFIC_PID%\}\}/);
  const connect = normalizeRecruitment({ recruitment: { platform: 'connect' } });
  expect(platformStudyLink('https://sp-survey.org/s/park', connect)).toBe('https://sp-survey.org/s/park');
});

test('a finished platform participant is remembered per project in this browser', () => {
  localStorage.clear();
  const ctx = { platform: 'prolific', id: 'p9' };
  expect(recruitmentDoneHere('proj', ctx)).toBe(false);
  rememberRecruitmentDone('proj', ctx);
  expect(recruitmentDoneHere('proj', ctx)).toBe(true);
  expect(recruitmentDoneHere('other', ctx)).toBe(false);
  expect(recruitmentDoneHere('proj', { platform: 'connect', id: 'p9' })).toBe(false);
});
