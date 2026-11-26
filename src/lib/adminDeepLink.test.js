import {
  ADMIN_DEEP_LINK_TABS,
  adminProjectPath,
  isAdminDeepLinkProjectId,
  parseAdminDeepLink,
  savedAdminTab,
  stripAdminDeepLink,
  studioPathForProject,
} from './adminDeepLink';

describe('parseAdminDeepLink', () => {
  test('reads the project and maps tab names to workspace tab indices', () => {
    expect(parseAdminDeepLink('?project=proj_1732_abc123&tab=media')).toEqual({
      projectId: 'proj_1732_abc123',
      tab: 1,
      present: true,
    });
    expect(parseAdminDeepLink('?project=p1&tab=builder').tab).toBe(2);
    expect(parseAdminDeepLink('?project=p1&tab=host').tab).toBe(3);
    expect(parseAdminDeepLink('?project=p1&tab=share').tab).toBe(4);
    expect(parseAdminDeepLink('project=p1&tab=Results').tab).toBe(5);
    expect(ADMIN_DEEP_LINK_TABS).toEqual({ media: 1, builder: 2, host: 3, share: 4, results: 5 });
  });

  test('a project without a tab keeps the remembered tab', () => {
    expect(parseAdminDeepLink('?project=proj_1')).toEqual({ projectId: 'proj_1', tab: null, present: true });
  });

  test('plain /admin carries no deep link', () => {
    expect(parseAdminDeepLink('')).toEqual({ projectId: null, tab: null, present: false });
    expect(parseAdminDeepLink(undefined)).toEqual({ projectId: null, tab: null, present: false });
    expect(parseAdminDeepLink('?foo=1')).toEqual({ projectId: null, tab: null, present: false });
  });

  test('unknown tabs and unsafe project ids are ignored but still cleaned up', () => {
    expect(parseAdminDeepLink('?project=p1&tab=practice')).toEqual({ projectId: 'p1', tab: null, present: true });
    expect(parseAdminDeepLink('?tab=constructor')).toEqual({ projectId: null, tab: null, present: true });
    ['../secrets', '..', '.hidden', 'a/b', 'a b', '<script>', `p${'x'.repeat(200)}`].forEach((id) => {
      expect(parseAdminDeepLink(`?project=${encodeURIComponent(id)}`)).toEqual({ projectId: null, tab: null, present: true });
    });
    expect(parseAdminDeepLink('?project=')).toEqual({ projectId: null, tab: null, present: true });
  });
});

test('isAdminDeepLinkProjectId accepts generated and legacy ids only', () => {
  expect(isAdminDeepLinkProjectId('proj_1732000000000_k3j4h5g6f')).toBe(true);
  expect(isAdminDeepLinkProjectId('3f2b7c1e-1d2c-4b8a-9f00-123456789abc')).toBe(true);
  expect(isAdminDeepLinkProjectId('default')).toBe(true);
  expect(isAdminDeepLinkProjectId('')).toBe(false);
  expect(isAdminDeepLinkProjectId(null)).toBe(false);
  expect(isAdminDeepLinkProjectId(42)).toBe(false);
});

test('stripAdminDeepLink removes only the deep-link parameters', () => {
  expect(stripAdminDeepLink('?project=p1&tab=media')).toBe('');
  expect(stripAdminDeepLink('?project=p1&debug=1&tab=share')).toBe('?debug=1');
  expect(stripAdminDeepLink('')).toBe('');
});

test('adminProjectPath and studioPathForProject build in-app paths', () => {
  expect(adminProjectPath('proj_1')).toBe('/admin?project=proj_1');
  expect(adminProjectPath('proj_1', 'media')).toBe('/admin?project=proj_1&tab=media');
  expect(adminProjectPath('proj_1', 'nope')).toBe('/admin?project=proj_1');
  expect(adminProjectPath('../x', 'media')).toBe('/admin');
  expect(parseAdminDeepLink(adminProjectPath('proj_9', 'results').slice('/admin'.length)))
    .toEqual({ projectId: 'proj_9', tab: 5, present: true });
  expect(studioPathForProject('proj_1')).toBe('/studio/proj_1');
  expect(studioPathForProject(null)).toBe('/studio');
  expect(studioPathForProject('a b')).toBe('/studio/a%20b');
});

describe('savedAdminTab', () => {
  const options = { tabsVersion: 2, maxTab: 6 };

  test('returns the remembered tab for current states', () => {
    expect(savedAdminTab({ tabValue: 4, tabsVersion: 2 }, options)).toBe(4);
    expect(savedAdminTab({ tabValue: 6, tabsVersion: 2 }, options)).toBe(6);
  });

  test('shifts version 1 states that had no Introduction tab', () => {
    expect(savedAdminTab({ tabValue: 0 }, options)).toBe(1);
    expect(savedAdminTab({ tabValue: 4, tabsVersion: 1 }, options)).toBe(5);
  });

  test('falls back to the Introduction tab for missing or broken values', () => {
    expect(savedAdminTab(null, options)).toBe(0);
    expect(savedAdminTab({}, options)).toBe(0);
    expect(savedAdminTab({ tabValue: 'x', tabsVersion: 2 }, options)).toBe(0);
    expect(savedAdminTab({ tabValue: -1, tabsVersion: 2 }, options)).toBe(0);
    expect(savedAdminTab({ tabValue: 99, tabsVersion: 2 }, options)).toBe(6);
  });
});
