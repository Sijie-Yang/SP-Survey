import {
  customSurveyShareUrl,
  isPublicSlugPath,
  legacySurveyShareUrl,
  normalizePublicSlug,
  participantLocationKey,
  publicSlugErrorCode,
  publicSlugFromPathname,
  RESERVED_PUBLIC_SLUGS,
  surveyShareUrl,
  validatePublicSlug,
} from './publicSlug';

test('slugs are lowercase, 2–40 characters, and block reserved names', () => {
  expect(normalizePublicSlug('  Campus-Study ')).toBe('campus-study');
  expect(validatePublicSlug('Campus-Study')).toEqual({ ok: true, slug: 'campus-study', code: 'ok' });
  expect(validatePublicSlug('')).toEqual({ ok: true, slug: '', code: 'empty' });
  expect(validatePublicSlug('a').code).toBe('invalid');
  expect(validatePublicSlug('my--study').code).toBe('invalid');
  expect(validatePublicSlug('-study').code).toBe('invalid');
  expect(validatePublicSlug('study-').code).toBe('invalid');
  expect(validatePublicSlug('has_underscore').code).toBe('invalid');
  expect(validatePublicSlug('a'.repeat(41)).code).toBe('invalid');
  RESERVED_PUBLIC_SLUGS.forEach((word) => {
    expect(validatePublicSlug(word).code).toBe('reserved');
    expect(validatePublicSlug(word.toUpperCase()).code).toBe('reserved');
  });
});

test('custom links use /s/{slug} and project-id links stay on /survey', () => {
  expect(customSurveyShareUrl('https://sp-survey.org', 'campus-study')).toBe('https://sp-survey.org/s/campus-study');
  expect(legacySurveyShareUrl('https://sp-survey.org', 'proj_1')).toBe('https://sp-survey.org/survey?project=proj_1');
  expect(surveyShareUrl('https://sp-survey.org', { id: 'proj_1', publicSlug: 'campus-study' }))
    .toBe('https://sp-survey.org/s/campus-study');
  expect(surveyShareUrl('https://sp-survey.org', { id: 'proj_1' }))
    .toBe('https://sp-survey.org/survey?project=proj_1');
});

test('participant location prefers the project id and reads /s/{slug}', () => {
  expect(participantLocationKey({ pathname: '/survey', search: '?project=proj_1' })).toBe('id:proj_1');
  expect(participantLocationKey({ pathname: '/s/campus-study', search: '?project=proj_1' })).toBe('id:proj_1');
  expect(participantLocationKey({ pathname: '/s/campus-study', search: '' })).toBe('slug:campus-study');
  expect(participantLocationKey({ pathname: '/s/Admin', search: '' })).toBe('slug:invalid');
  expect(participantLocationKey({ pathname: '/survey', search: '' })).toBe('default');
  expect(isPublicSlugPath('/s/campus-study')).toBe(true);
  expect(isPublicSlugPath('/survey')).toBe(false);
  expect(publicSlugFromPathname('/s/Campus-Study')).toBe('campus-study');
  expect(publicSlugFromPathname('/s/admin')).toBeNull();
});

test('database errors map to a clear taken or reserved result', () => {
  expect(publicSlugErrorCode({ message: 'slug_taken', code: '23505' })).toBe('taken');
  expect(publicSlugErrorCode({ message: 'duplicate key value violates unique constraint "projects_public_slug_key"' })).toBe('taken');
  expect(publicSlugErrorCode({ message: 'slug_reserved' })).toBe('reserved');
  expect(publicSlugErrorCode({ message: 'slug_invalid' })).toBe('invalid');
  expect(publicSlugErrorCode({ message: 'not_owner' })).toBe('forbidden');
  expect(publicSlugErrorCode({ message: 'Could not find the function public.set_project_public_slug' })).toBe('unavailable');
});
